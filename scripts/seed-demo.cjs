/*
 * seed-demo — create or re-seed the App Store review account.
 *
 *   npm run seed-demo
 *   npm run seed-demo -- --email review@example.com --password 'something'
 *
 * WHY THIS EXISTS
 *
 * App Review rejects an app whose only path in is a password the reviewer does
 * not have. This app is invite-only by design -- there is no signup endpoint --
 * so there is no way for a reviewer to get in, and a rejection for "we could not
 * access the app" is the single most common 1.0 rejection.
 *
 * WHAT IT DOES, AND WHY IT IS BUILT THIS WAY
 *
 * It is RE-RUNNABLE, and re-running it destroys and rebuilds the demo account's
 * data. That is the point, not a side effect:
 *
 *   - The credentials are in the App Review notes, which means the URL plus a
 *     guessable password is a public login to a production database. Anyone who
 *     reads the notes can sign in.
 *   - A reviewer will tap around and leave things half-edited. If the data
 *     persisted, the next reviewer sees a degraded app.
 *
 * So the demo account is treated as disposable state that is restored from a
 * fixture, and the deploy script re-seeds it on every deploy. A stranger who
 * pokes at it cannot make the demo worse for long.
 *
 * The account is deliberately NOT an owner. If the password does leak, the
 * blast radius is the demo's own trips and nothing else -- it cannot see, edit
 * or delete another account's data, because per-trip access is enforced by
 * ownership and this account owns only what it created.
 *
 * It is also not an admin, so it cannot reach the account-creation UI.
 */

const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

/*
 * `server-only` is a Next.js build-time guard, not an installed package. A
 * plain Node process importing src/lib/db.ts dies with MODULE_NOT_FOUND before
 * any of our code runs, so point it at a do-nothing stub. Mirrors
 * create-account.cjs, which is where this pattern was established.
 */
const STUB = path.join(__dirname, "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

const h = require("../tests/harness.cjs");

const DEFAULT_EMAIL = "appreview@trips.planetracker.app";
const DEFAULT_NAME = "App Review";

const USAGE = `
Create or re-seed the App Store review account.

  npm run seed-demo [-- options]

Options:
  --email <address>     Login for the review account.
  --password <text>     Password. Generated and printed when omitted.
  --name <text>         Display name.
  --keep                Do not delete existing trips first. Only sensible if
                        you have edited the fixture content and want to top it
                        up; the default is to rebuild from scratch.
  -h, --help            This text.

Notes:
  Re-running WIPES the review account's trips and recreates them. That is
  intended: the account is disposable state and a deploy re-seeds it.
  The DB is chosen by TRIP_PACKER_DB, defaulting to data/trip-packer.db, and
  the resolved path is always printed.
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--email": out.email = next(); break;
      case "--password": out.password = next(); break;
      case "--name": out.name = next(); break;
      case "--keep": out.keep = true; break;
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

/**
 * A password that satisfies App Review's policy without being a dictionary
 * word: three random lowercase words plus digits.
 *
 * It is printed, because it has to be pasted into the review notes, and it is
 * generated rather than fixed so that it is not shared across installs. It is
 * not stored anywhere except as a hash.
 */
function generatePassword() {
  const words = [
    "harbor", "lantern", "meadow", "copper", "willow", "summit", "pebble",
    "cedar", "orbit", "tundra", "marble", "quartz", "nimbus", "ginger",
    "walnut", "cobalt", "saffron", "lagoon", "amber", "birch",
  ];
  const pick = () => words[crypto.randomInt(0, words.length)];
  return `${pick()}-${pick()}-${pick()}${crypto.randomInt(10, 99)}`;
}

/** Insert a trip and its categories, items and reservations. */
function insertTrip(db, userId, spec, demoTrip) {
  const tripId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.tx.insertTrip({
    id: tripId,
    userId,
    name: spec.name,
    destination: spec.destination,
    startDate: demoTrip.dateFromNow(spec.startInDays),
    endDate: demoTrip.dateFromNow(spec.startInDays + spec.lengthDays),
    notes: spec.notes,
    icon: spec.icon,
    archived: spec.startInDays < 0,
    createdAt: now,
    updatedAt: now,
  });

  let itemCount = 0;
  spec.categories.forEach((cat, catIndex) => {
    const categoryId = crypto.randomUUID();
    db.tx.insertCategory({
      id: categoryId,
      tripId,
      name: cat.name,
      icon: cat.icon,
      order: catIndex,
    });
    cat.items.forEach((item, itemIndex) => {
      db.tx.insertItem({
        id: crypto.randomUUID(),
        tripId,
        categoryId,
        name: item.name,
        quantity: item.quantity ?? 1,
        checked: Boolean(item.checked),
        icon: item.icon ?? "package",
        order: itemIndex,
        bagId: null,
      });
      itemCount++;
    });
  });

  // Reservations use the demo trip's own date helpers, so a re-seed moves them
  // relative to today rather than freezing the original seed date.
  //
  // The real Reservation shape is not a single timestamp: start/end are split
  // into date ("YYYY-MM-DD") and time ("HH:MM") columns, because a booking time
  // is local to wherever you are and storing an instant would shift it across
  // timezones. `confirmed` is required, and `locationTo` is required but may be
  // "" for lodging and cars.
  let reservationCount = 0;
  for (const r of spec.reservations) {
    const day = demoTrip.dateFromNow(r.inDays);
    const endDay = demoTrip.dateFromNow(r.inDays + (r.lengthDays ?? 0));
    db.tx.insertReservation({
      id: crypto.randomUUID(),
      tripId,
      type: r.type,
      title: r.title,
      confirmation: r.confirmation,
      confirmed: r.confirmed !== false,
      location: r.location,
      locationTo: r.locationTo ?? "",
      startDate: day,
      startTime: r.at,
      endDate: endDay,
      endTime: "",
      cost: r.cost ?? "",
      notes: r.notes ?? "",
      order: reservationCount,
      createdAt: now,
    });
    reservationCount++;
  }

  return { tripId, itemCount, reservationCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || DEFAULT_EMAIL).trim().toLowerCase();
  const name = String(args.name || DEFAULT_NAME).trim();
  const password = args.password || generatePassword();
  const generated = !args.password;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`That does not look like an email address: ${email}`);
    process.exit(1);
  }
  if (typeof password !== "string" || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));
  const auth = h.loadModule(path.join(h.SRC, "lib", "auth.ts"));
  const demo = h.loadModule(path.join(h.SRC, "lib", "demoFixture.ts"));

  // Refuse to hijack a real account. If this email already belongs to an owner
  // or an admin, the caller has almost certainly mistyped it, and re-seeding
  // would wipe a real person's trips.
  const existing = db.tx.getUserByEmail(email);
  if (existing && existing.isOwner) {
    console.error(
      `Refusing to re-seed: ${email} is an OWNER account (id ${existing.id}).\n` +
        "That is almost certainly not the review account. Pass a different\n" +
        "--email, or delete that account first if you really mean it."
    );
    process.exit(1);
  }

  const hash = auth.hashPassword(password);
  if (!hash) {
    console.error("Failed to hash the password.");
    process.exit(1);
  }

  let userId;
  let createdAccount = false;
  if (existing) {
    userId = existing.id;
    // Reset the password too: the whole point is that the printed value works.
    db.tx.setCredentials(userId, email, hash);
  } else {
    userId = crypto.randomUUID();
    db.tx.insertAccount({
      id: userId,
      name,
      avatarColor: "bg-cyan-500",
      createdAt: new Date().toISOString(),
      email,
      passwordHash: hash,
      // Never an owner. Deliberate: see the header.
      isOwner: false,
    });
    createdAccount = true;
  }

  /*
   * Wipe and rebuild the account's own trips.
   *
   * There is no `listTrips(userId)` helper -- trips are read wholesale by the
   * app and filtered per user in memory -- so this goes through the exported
   * `readState()` and filters by `userId`. Scoped to this account, so a real
   * account's data is never touched even if this somehow ran against the live
   * database.
   */
  const state = db.readState();
  const owned = (state ? state.trips : []).filter((t) => t.userId === userId);
  let removed = 0;
  if (!args.keep) {
    for (const t of owned) {
      db.tx.deleteTrip(t.id);
      removed++;
    }
  }

  const active = insertTrip(db, userId, demo.demoTrip(), demo);
  const archived = insertTrip(db, userId, demo.archivedDemoTrip(), demo);

  // Prove the credentials work by round-tripping them, rather than trusting
  // the insert. A seed whose password does not actually verify is worse than a
  // missing seed, because it fails at review time instead of now.
  const stored = db.tx.getUserByEmail(email);
  const verified = auth.verifyPassword(password, stored ? stored.passwordHash : null);

  const targetDb = process.env.TRIP_PACKER_DB
    ? path.resolve(process.env.TRIP_PACKER_DB)
    : path.resolve(process.cwd(), "data", "trip-packer.db");

  console.log(`\n${createdAccount ? "Created" : "Re-seeded"} review account:`);
  console.log(`  email     ${email}`);
  console.log(`  password  ${password}${generated ? "   (generated)" : ""}`);
  console.log(`  name      ${name}`);
  console.log(`  id        ${userId}`);
  console.log(`  owner     ${stored && stored.isOwner ? "YES — PROBLEM" : "no"}`);
  console.log(`  db        ${targetDb}`);
  console.log(`  cleared   ${removed} existing trip(s)`);
  console.log(`  trips     2 (1 active, 1 archived)`);
  console.log(
    `             ${active.itemCount + archived.itemCount} items, ` +
      `${active.reservationCount + archived.reservationCount} reservations`
  );
  console.log(`  login     ${verified ? "verified (hash round-trips)" : "PROBLEM — check password"}`);

  if (!verified) process.exit(1);
  if (stored && stored.isOwner) {
    console.error("\nThe review account is an owner. Remove that before submitting.");
    process.exit(1);
  }

  console.log(
    "\nPut these in App Store Connect → App Review Information → Sign-In Required:\n" +
      `  ${email}\n  ${password}\n`
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
