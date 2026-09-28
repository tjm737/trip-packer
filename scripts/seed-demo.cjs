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
  --reset-geocache      Also empty the whole geocache table. The default purge
                        only drops the keys the deleted trips owned, which
                        cannot reach entries orphaned by an earlier fixture (the
                        rows are keyed by location text, not by trip, so once
                        the trip is gone nothing points at them). Use this after
                        changing a fixture location and seeing the map still
                        draw the old coordinates. Affects every account, since
                        the table is shared -- harmless, just slower next load.
  -h, --help            This text.

Environment:
  TRIP_PACKER_DB        Database to write. Defaults to data/trip-packer.db.
  TRIP_PACKER_DEMO_PASSWORD
                        Same as --password, but keeps the value out of argv.
                        Prefer this: an argument is visible to every user on
                        the box via the process table and is written to shell
                        history.

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
      case "--reset-geocache": out.resetGeocache = true; break;
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
  /*
   * Bags are created BEFORE the items so each item can be assigned as it is
   * inserted. Creating the bag rows in a second pass would mean either an
   * update per item or a NULL bagId on everything, and a reviewer opening the
   * packing list would then see a Bags section with items sitting outside it.
   *
   * This is a review-visibility requirement, not decoration: the submission doc
   * calls an empty Bags section a release blocker, because bags are a visible
   * 1.0 feature and guideline 4.2 (minimum functionality) is the primary
   * rejection risk for a shell app. A demo account with no bags would show the
   * reviewer the one screen that looks unfinished.
   */
  const bagSpecs = spec.bags ?? [];
  const bagIds = bagSpecs.map((bag) => {
    const bagId = crypto.randomUUID();
    db.tx.insertBag({
      id: bagId,
      tripId,
      name: bag.name,
      kind: bag.kind,
      tagNumber: bag.tagNumber ?? "",
      notes: bag.notes ?? "",
      createdAt: now,
      updatedAt: now,
    });
    return bagId;
  });

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
      /*
       * bagIndex assigns an item to one of this trip's bags. Round-robin would
       * scatter a category across bags and read as random, so the spec names
       * the bag explicitly and every item without one stays unassigned -- which
       * is also the honest default, since most packing is decided later.
       */
      const bagId =
        typeof item.bagIndex === "number" ? bagIds[item.bagIndex] ?? null : null;
      db.tx.insertItem({
        id: crypto.randomUUID(),
        tripId,
        categoryId,
        name: item.name,
        quantity: item.quantity ?? 1,
        checked: Boolean(item.checked),
        icon: item.icon ?? "package",
        order: itemIndex,
        bagId,
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

  return { tripId, itemCount, reservationCount, bagCount: bagIds.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || DEFAULT_EMAIL).trim().toLowerCase();
  const name = String(args.name || DEFAULT_NAME).trim();
  const password = args.password || process.env.TRIP_PACKER_DEMO_PASSWORD || generatePassword();
  const generated = !args.password && !process.env.TRIP_PACKER_DEMO_PASSWORD;

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
    /*
     * Drop the geocache rows these trips created, before deleting them.
     *
     * `geocache` is keyed by the location *string*, not by trip or reservation,
     * and is deliberately shared across trips -- "Lisbon" resolves the same way
     * for everyone. The consequence is that deleting a trip does not delete its
     * cached coordinates, and `deleteTrip` does not touch this table. So a
     * re-seed that changes a fixture location keeps serving the OLD coordinates
     * for the new text until something happens to overwrite the row.
     *
     * That bit me for real: the fixture flew LIS -> LGW, and after editing it to
     * a Lisbon-only itinerary the map still drew a pin in London, because
     * "gatwick (lgw)" was still cached from the previous seed. The map looked
     * correct and was stale, which is the worst way for a cache to fail.
     *
     * Only the keys belonging to the trips being deleted are purged, so a real
     * account's cached lookups survive a demo re-seed. The key format is the one
     * `geocode.ts` uses -- see `normaliseQuery` and the `dedupeKey` comment in
     * `geocodeMany`:
     *
     *   no context:  normaliseQuery(location)
     *   context:     normaliseQuery(location) + "\0" + normaliseQuery(title)
     *
     * Both forms are purged because `/api/geo` sends a title as context for
     * every reservation that has one, while a bare location can still be cached
     * from an earlier run that had no title.
     */
    const normalise = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    const keys = new Set();
    for (const t of owned) {
      for (const r of (state.reservations ?? []).filter((r) => r.tripId === t.id)) {
        for (const loc of [r.location, r.locationTo]) {
          if (!loc || !normalise(loc)) continue;
          const q = normalise(loc);
          keys.add(q);
          if (r.title && normalise(r.title)) keys.add(`${q}\u0000${normalise(r.title)}`);
        }
      }
    }
    if (keys.size > 0) {
      const del = db.getDb().prepare("DELETE FROM geocache WHERE query = ?");
      db.getDb().transaction(() => {
        for (const k of keys) del.run(k);
      })();
    }

    /*
     * The targeted purge above cannot help with a location that an EARLIER
     * fixture wrote: by the time this runs, that trip is already deleted and
     * nothing in the database records which cache keys it produced. `--reset-geocache`
     * is the escape hatch for exactly that case, and it is opt-in because it
     * is the one code path here that touches rows belonging to other accounts.
     */
    if (args.resetGeocache) {
      const n = db.getDb().prepare("DELETE FROM geocache").run();
      console.log(`  geocache  cleared (${n.changes} row(s), all accounts)`);
    }

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

  /*
   * Bags are reported because they are the 1.0 feature App Review sees first,
   * and because their absence is the one seeding outcome that must not pass
   * quietly -- an empty Bags section is a guideline 4.2 risk (see the comment
   * above `bagSpecs`).
   *
   * Without this line the deploy log could not answer "did the bags seed?",
   * which is exactly what it needed to answer: `update.sh` greps this output
   * for a summary, and a summary that omits the field being fixed cannot
   * verify the fix. Report the count, and mark zero as a problem rather than
   * printing "0 bags" in the same tone as success.
   */
  const bagTotal = active.bagCount + archived.bagCount;
  console.log(
    `  bags      ${bagTotal}` +
      (bagTotal === 0 ? "   ← PROBLEM: reviewers would see an empty Bags section" : "")
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
