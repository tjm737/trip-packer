/*
 * delete-account — remove a login-capable account and its data, from the shell.
 *
 *   npm run delete-account -- --email someone@example.com --dry-run
 *   npm run delete-account -- --email someone@example.com --yes
 *
 * Why this is a .cjs file that borrows the test harness's loader: see the header
 * of create-account.cjs. Short version — the repo has no local TypeScript
 * runner, `tsx` only resolves through npx (which needs outbound network, absent
 * on the server), and the harness already has a zero-dependency loader that
 * understands the `@/` alias. Same reasoning, same mechanism.
 *
 * WHY THIS REFUSES TO DELETE THE LAST OWNER
 *
 * `isOwner` is not cosmetic: mutate/route.ts gates the "admin" op class on it,
 * and account creation lives in that class. Removing the final owner therefore
 * removes the ability to mint accounts *permanently* — there is no endpoint that
 * can restore it, because restoring it is itself an admin op. The
 * promoteToOwnerIfNone() helper in db.ts only runs on the account-creation path,
 * so it cannot rescue a database that can no longer create accounts.
 *
 * That failure is unrecoverable through the app and is reachable by a single
 * mistyped command, so the check is not a warning — it is a hard stop, and
 * --force does not bypass it. Promote someone else first, then delete.
 *
 * Deletion cascades: db.ts sets `foreign_keys = ON` and the trips/categories/
 * items/members tables all reference users with ON DELETE CASCADE. So this
 * removes the user's trips too, in the database, not by JS-side filtering. That
 * is the correct behaviour for "delete this account", and it is also why the
 * dry run reports row counts before anything is written.
 */

const path = require("node:path");
const readline = require("node:readline");
const Module = require("node:module");

/*
 * `server-only` is a Next.js build-time guard, not an installed package. A plain
 * Node process importing src/lib/db.ts dies with MODULE_NOT_FOUND before any of
 * our code runs. Point it at a do-nothing stub at the module-loader level, so
 * this needs no install step and no change to app source.
 */
const STUB = path.join(__dirname, "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

const h = require("../tests/harness.cjs");

const USAGE = `
Delete an account for trip-packer, along with the data it owns.

  npm run delete-account -- --email <address> [--dry-run] [--yes]

Options:
  --email <address>   Required. Matched case-insensitively; must exist.
  --id <uuid>         Alternate selector, if the email is unknown.
  --dry-run           Report what would be deleted and exit without writing.
                      Always safe: this branch contains no write calls.
  --yes               Skip the interactive confirmation prompt.

Notes:
  The DB is chosen by TRIP_PACKER_DB, defaulting to data/trip-packer.db.
  The resolved path is always printed, so the target is never ambiguous.
  The last remaining owner cannot be deleted, by design. See the header.
  Deletion cascades to the account's trips (and their categories and items),
  because trips.userId is a foreign key with ON DELETE CASCADE. To change an
  account's login while keeping its trips, use instead:
    npm run create-account -- --upgrade-user <id> --email <new> --name <name>
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--email": out.email = next(); break;
      case "--id": out.id = next(); break;
      case "--yes": out.yes = true; break;
      case "--dry-run": out.dryRun = true; break;
      case "--keep-trips": out.keepTrips = true; break;
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown option: ${arg}`);
          console.error(USAGE);
          process.exit(1);
        }
    }
  }
  return out;
}

/** Ask a yes/no question. Returns false when there is no TTY, so a piped or
 *  non-interactive run fails closed rather than deleting on a default. */
function confirm(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email ? String(args.email).trim().toLowerCase() : "";
  const id = args.id ? String(args.id).trim() : "";

  if (!email && !id) {
    console.error("Either --email or --id is required.\n");
    console.error(USAGE);
    process.exit(1);
  }
  if (email && id) {
    console.error("Pass only one of --email or --id, so the target is unambiguous.\n");
    console.error(USAGE);
    process.exit(1);
  }

  const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));
  const { tx, readState } = db;

  // Resolve the target through the store layer rather than raw SQL, so this
  // behaves exactly like the app does (case-insensitive email, same row shape).
  const user = email ? tx.getUserByEmail(email) : tx.getUserById(id);
  if (!user) {
    console.error(`No account found for ${email || id} in this database.`);
    process.exit(1);
  }

  // Resolved here rather than imported, because db.ts keeps DB_PATH private.
  // Must stay in step with db.ts: TRIP_PACKER_DB, else <cwd>/data/trip-packer.db.
  const targetDb = process.env.TRIP_PACKER_DB
    ? path.resolve(process.env.TRIP_PACKER_DB)
    : path.resolve(process.cwd(), "data", "trip-packer.db");

  /*
   * Count what a cascade would take, so the dry run and the confirmation prompt
   * both state the consequence concretely instead of asserting "this is fine".
   *
   * readState() is the app's own read path (the same one /api/state and
   * mutate/route.ts use), so these counts describe what the app sees rather than
   * what a hand-written query happens to return. It is a full-state read: fine
   * at this database's size, and clearer than reaching for a bespoke COUNT.
   */
  const state = readState();
  const allUsers = state && Array.isArray(state.users) ? state.users : [];
  const allTrips = state && Array.isArray(state.trips) ? state.trips : [];
  const tripCount = allTrips.filter((t) => t.userId === user.id).length;
  const ownerCount = allUsers.filter((u) => u.isOwner).length;

  console.log(`\nAccount:`);
  console.log(`  id       ${user.id}`);
  console.log(`  email    ${user.email || "(no login)"}`);
  console.log(`  name     ${user.name}`);
  console.log(`  owner    ${user.isOwner ? "yes" : "no"}`);
  console.log(`  db       ${targetDb}`);
  console.log(`\nWould remove:`);
  console.log(`  account   1 row`);
  console.log(`  sessions  all of this user's`);
  console.log(`  trips     ${tripCount} — with their categories and items (cascade)`);

  /*
   * The load-bearing guard. Refuse when this account is the only owner, because
   * deleting it makes account creation impossible with no in-app recovery path.
   * Deliberately not bypassable by --force or --yes: the point is that no flag
   * should let a mistyped command strand the deployment.
   */
  if (user.isOwner && ownerCount <= 1) {
    console.error(
      `\nRefusing: ${user.email || user.id} is the only owner in this database.`
    );
    console.error(
      "Owner rights gate account creation (mutate/route.ts, the \"admin\" op class),\n" +
        "so removing the last owner makes it impossible to create any further account,\n" +
        "and no endpoint can restore the flag — restoring it is itself an owner-gated\n" +
        "operation. This is unrecoverable through the app.\n"
    );
    console.error("Promote a different account to owner first, then re-run:");
    console.error(
      `  sqlite3 ${targetDb} "UPDATE users SET isOwner=1 WHERE email='<other>';"\n`
    );
    process.exit(1);
  }

  if (args.dryRun) {
    console.log("\nDry run — nothing was written.");
    process.exit(0);
  }

  // Everything below this point writes. Kept after the guard and after the
  // dry-run branch so --dry-run cannot reach a write call even by accident.
  // --yes is the non-interactive path: it must not require a TTY, or a scripted
  // run on the server would fail closed forever with no way to proceed. Without
  // it, an interactive confirm is required, and confirm() returns false when
  // there is no TTY so a piped run cannot delete on an unanswered prompt.
  const prompt = args.yes
    ? Promise.resolve(true)
    : confirm(`Delete ${user.email || user.id} and its trips? [y/N] `);

  return prompt.then((ok) => {
    if (!ok) {
      console.log("Aborted — nothing was written.");
      process.exit(1);
    }

    // Sessions first: they reference the user, and clearing them means any
    // browser holding a cookie for this account stops being authenticated the
    // moment the row is gone rather than erroring on a dangling userId.
    tx.deleteSessionsForUser(user.id);

    /*
     * --keep-trips is not implemented, and says so rather than pretending.
     *
     * Orphaning trips means re-pointing trips.userId at something that is not a
     * user row, which the schema does not allow: userId is a NOT NULL foreign key
     * with ON DELETE CASCADE. The supported way to preserve trips across an
     * account change is create-account.cjs --upgrade-user, which keeps the
     * profile row (and therefore its id) and replaces only the credentials.
     * Deleting the user and re-attaching the trips afterwards is not a real
     * option, so --keep-trips fails loudly instead of silently cascading.
     */
    if (args.keepTrips) {
      console.error(
        "--keep-trips is not supported: trips.userId is a NOT NULL foreign key,\n" +
          "so trips cannot outlive their owning account. Use\n" +
          "  npm run create-account -- --upgrade-user <id> ...\n" +
          "to change an account's login while keeping its trips.\n" +
          "Nothing was written."
      );
      process.exit(1);
    }

    tx.deleteUser(user.id);

    // Read back to prove it landed, rather than trusting the call's return.
    const gone = email ? tx.getUserByEmail(email) : tx.getUserById(id);
    if (gone) {
      console.error(`\nFailed: ${user.email || user.id} is still present.`);
      process.exit(1);
    }

    console.log(`\nDeleted ${user.email || user.id}.`);
    console.log(`  db       ${targetDb}`);
    console.log(`  verified absent on re-read`);
  });
}

Promise.resolve()
  .then(main)
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
