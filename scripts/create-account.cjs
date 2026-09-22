/*
 * create-account — add a login-capable account from the server shell.
 *
 *   npm run create-account -- --email you@example.com --name "Tyler"
 *
 * Why this is a .cjs file that borrows the test harness's loader, rather than a
 * normal .ts script run under a TypeScript runner:
 *
 * The repo has no TypeScript runner installed. `tsx` resolves only through npx,
 * which downloads it on demand — so a script depending on it would fail on a
 * server with no outbound network, which is exactly the machine this has to
 * work on. The test harness already contains a zero-dependency loader that
 * transpiles the real source with the project's own `typescript` package and
 * understands the `@/` alias. Reusing it keeps this working offline and avoids
 * a second, subtly different module-loading path.
 *
 * Registration is closed: there is no signup endpoint, because this app is for
 * a handful of known people rather than open signups.
 */

const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const Module = require("node:module");

/*
 * `server-only` is a Next.js build-time guard: it is not an installed package,
 * and Next resolves it through its own bundler. A plain Node process importing
 * src/lib/db.ts therefore dies with MODULE_NOT_FOUND before any of our code
 * runs. Point it at a do-nothing stub.
 *
 * Patched at the module loader rather than by adding a dependency, so this
 * script keeps working with no install step and no changes to the app source.
 */
const STUB = path.join(__dirname, "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

const h = require("../tests/harness.cjs");

const USAGE = `
Create an account for trip-packer.

  npm run create-account -- --email <address> --name <display name> [options]

Options:
  --email <address>    Required. Stored lowercased; used to log in.
  --name <text>        Required. Shown in the UI.
  --password <text>    Optional. Prompted for (hidden) when omitted.
  --avatar <class>     Optional. Tailwind background class, e.g. bg-emerald-500.
  --owner              Optional. Grant owner (admin) rights.

Notes:
  The DB is chosen by TRIP_PACKER_DB, defaulting to data/trip-packer.db.
  Passing --password puts it in shell history and in ps output; prefer the
  hidden prompt on a shared machine.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--email": out.email = next(); break;
      case "--name": out.name = next(); break;
      case "--password": out.password = next(); break;
      case "--avatar": out.avatarColor = next(); break;
      case "--owner": out.owner = true; break;
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

/** Read a line without echoing it. Resolves null when there is no TTY. */
function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(null);
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const original = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => {
      // Echo the prompt itself, but not the characters typed after it.
      if (s.includes(question)) original(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const email = args.email ? String(args.email).trim().toLowerCase() : "";
  const name = args.name ? String(args.name).trim() : "";

  if (!email || !name) {
    console.error("Both --email and --name are required.\n");
    console.error(USAGE);
    process.exit(1);
  }

  // Deliberately not a full RFC 5322 validator. The goal is to catch a typo
  // like "user@localhost" or a missing @, not to litigate deliverability — an
  // over-strict regex rejects addresses that are actually valid.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`That does not look like an email address: ${email}`);
    process.exit(1);
  }

  const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));
  const auth = h.loadModule(path.join(h.SRC, "lib", "auth.ts"));

  const existing = db.tx.getUserByEmail(email);
  if (existing) {
    console.error(`An account with that email already exists (id ${existing.id}).`);
    process.exit(1);
  }

  let password = args.password;
  if (!password) {
    password = await promptHidden("Password: ");
    if (password === null) {
      console.error(
        "No TTY available to prompt for a password. Pass --password instead."
      );
      process.exit(1);
    }
  }

  if (typeof password !== "string" || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  // Confirm only when prompted interactively; a scripted run passes the value
  // once and should not have to supply it twice.
  if (!args.password) {
    const again = await promptHidden("Confirm password: ");
    if (again !== password) {
      console.error("Passwords did not match.");
      process.exit(1);
    }
  }

  const hash = auth.hashPassword(password);
  if (!hash) {
    console.error("Failed to hash the password.");
    process.exit(1);
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    avatarColor: args.avatarColor || "bg-emerald-500",
    createdAt: new Date().toISOString(),
    email,
    passwordHash: hash,
    isOwner: Boolean(args.owner),
  };

  db.tx.insertUser(user);

  // The first account becomes the owner automatically, so a fresh install has
  // an admin without anyone having to remember --owner.
  let isOwner = user.isOwner;
  if (!isOwner && db.tx.promoteToOwnerIfNone(user.id)) {
    isOwner = true;
    console.log("No owner existed yet — this account was made the owner.");
  }

  // Read the row back rather than trusting the in-memory object: this proves
  // the insert actually landed, including the credential columns.
  const stored = db.tx.getUserByEmail(email);
  const canLogIn = Boolean(stored && stored.passwordHash);
  const verified = auth.verifyPassword(password, stored ? stored.passwordHash : null);

  console.log(`\nCreated account:`);
  console.log(`  id       ${user.id}`);
  console.log(`  email    ${email}`);
  console.log(`  name     ${name}`);
  console.log(`  owner    ${isOwner ? "yes" : "no"}`);
  console.log(`  login    ${canLogIn && verified ? "verified (hash round-trips)" : "PROBLEM — check password"}`);

  if (!canLogIn || !verified) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
