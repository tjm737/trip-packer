#!/usr/bin/env node
/*
 * state.replace must be able to CREATE a trip, and must never be able to adopt
 * or damage someone else's.
 *
 * Why this file exists
 * --------------------
 * state.replace is the only path that creates a trip -- createTrip() pushes the
 * whole tree as one snapshot. The multi-user hardening that scoped the write to
 * "the actor's own rows" derived that scope from the trips table:
 *
 *     const ownedTripIds = SELECT id FROM trips WHERE userId = ?
 *     if (ownedTripIds.length === 0) return
 *     ... for (const t of s.trips) if (ownedSet.has(t.id)) insertTrip(t)
 *
 * A brand-new trip cannot exist in the trips table, so it was never in
 * ownedSet, so it was never inserted. Every create committed nothing while the
 * route still answered ok: true. A user with zero trips could never create
 * their first one -- total and completely silent.
 *
 * The fix widens the scope to the actor's DB trips PLUS the snapshot's
 * genuinely-new trip ids. The first attempt at that fix filtered the payload
 * side by `t.userId === uid`, which is client-supplied and therefore let a
 * snapshot adopt any trip id by claiming to own it -- an account takeover. The
 * security tests below exist because that hole was real and was caught only by
 * attacking a live server, not by reasoning.
 *
 * Both halves are load-bearing and pull in opposite directions:
 *   - too narrow   -> creation silently fails (the original bug)
 *   - too trusting -> adoption / cross-account writes (the fix's first version)
 * Every assertion here guards one of those two directions.
 *
 * Two harness facts this file depends on, both verified by experiment:
 *
 *   1. Fixtures need a real `users` row. trips.userId is
 *      `REFERENCES users(id)`, so a trip for a non-existent user dies with
 *      SQLITE_CONSTRAINT_FOREIGNKEY before any assertion runs.
 *
 *   2. Isolation needs BOTH a fresh TRIP_PACKER_DB and `delete
 *      globalThis.__tripPackerDb`. getDb() caches its handle on globalThis
 *      (deliberately, to survive dev-mode HMR), so it outlives a module reload
 *      entirely; reloading the module alone would silently share one database
 *      across cases and make the ownership tests pass for the wrong reason.
 *
 * Assertions read the tables directly rather than via readState(), because
 * readState() returns null unless an active user is set and it re-derives the
 * same client-shaped view the bug lived in -- the point here is what actually
 * landed in SQLite.
 */
const h = require("./harness.cjs");

(async () => {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-replace-"));
  let counter = 0;

  const now = () => new Date().toISOString();

  /**
   * A fresh, isolated database with its migrations applied.
   *
   * Returns helpers that query SQLite directly, so an assertion cannot be
   * satisfied by an in-memory projection.
   */
  async function freshDb() {
    const file = path.join(dir, `case-${++counter}.db`);
    process.env.TRIP_PACKER_DB = file;
    delete globalThis.__tripPackerDb;
    const db = await h.loadModule("src/lib/db.ts");

    const addUser = (id) =>
      db
        .getDb()
        .prepare("INSERT INTO users (id,name,avatarColor,createdAt) VALUES (?,?,?,?)")
        .run(id, id, "#3b82f6", now());

    return {
      db,
      addUser,
      trips: () => db.getDb().prepare("SELECT id,userId,name FROM trips ORDER BY id").all(),
      categories: () =>
        db.getDb().prepare("SELECT id,tripId FROM categories ORDER BY id").all(),
      items: () => db.getDb().prepare("SELECT id,tripId FROM items ORDER BY id").all(),
      tripIds: () => db.getDb().prepare("SELECT id FROM trips").all().map((r) => r.id),
    };
  }

  const trip = (id, userId, name = "Trip") => ({
    id,
    userId,
    name,
    destination: "Nowhere",
    startDate: "2026-11-01",
    endDate: "2026-11-07",
    notes: "",
    icon: "plane",
    archived: 0,
    createdAt: now(),
    updatedAt: now(),
  });

  const category = (id, tripId, name = "Clothing") => ({
    id,
    tripId,
    name,
    icon: "shirt",
    order: 0,
  });

  const item = (id, tripId, categoryId, name = "T-shirts") => ({
    id,
    tripId,
    categoryId,
    name,
    quantity: 3,
    checked: 0,
    icon: "shirt",
    order: 0,
  });

  const snapshot = (over = {}) => ({
    trips: [],
    categories: [],
    items: [],
    tasks: [],
    reservations: [],
    bags: [],
    ...over,
  });

  await h.test("creates a first trip for a user who has NONE", async () => {
    // The headline regression. A zero-trip account is not an edge case: it is
    // every new account, and it is where the bug reproduced 100% of the time.
    const t = await freshDb();
    const uid = "user-alone";
    t.addUser(uid);

    const written = t.db.tx.replaceOwnedRows(
      uid,
      snapshot({ trips: [trip("t-new", uid, "First Trip")] })
    );

    h.assert(
      Array.isArray(written) && written.includes("t-new"),
      `a snapshot-only trip must be reported written, got ${JSON.stringify(written)}`
    );
    h.assert(
      t.tripIds().includes("t-new"),
      `the first trip must reach the database, got ${JSON.stringify(t.tripIds())}`
    );
  });

  await h.test("creates a trip together with its children", async () => {
    // A create is trip + categories + items. A trip landing without them would
    // be a half-built trip, which the single-snapshot design exists to prevent.
    const t = await freshDb();
    const uid = "user-parent";
    t.addUser(uid);

    t.db.tx.replaceOwnedRows(
      uid,
      snapshot({
        trips: [trip("t1", uid, "Lisbon")],
        categories: [category("c1", "t1")],
        items: [item("i1", "t1", "c1")],
      })
    );

    h.assert(
      t.categories().some((c) => c.tripId === "t1"),
      "a category must land with its trip"
    );
    h.assert(t.items().some((i) => i.tripId === "t1"), "an item must land with its trip");
  });

  await h.test("does NOT adopt an existing trip by claiming userId", async () => {
    /*
     * The account-takeover case. The victim's trip exists; the attacker sends a
     * snapshot containing that trip id with userId set to themselves. Trusting
     * the payload's userId adopted the row and rewrote its owner.
     */
    const t = await freshDb();
    const victim = "user-victim";
    const attacker = "user-attacker";
    t.addUser(victim);
    t.addUser(attacker);

    t.db.tx.replaceOwnedRows(
      victim,
      snapshot({ trips: [trip("t-victim", victim, "Victim Private Trip")] })
    );

    const written = t.db.tx.replaceOwnedRows(
      attacker,
      snapshot({ trips: [trip("t-victim", attacker, "STOLEN")] })
    );

    h.assert(
      !(written || []).includes("t-victim"),
      `an existing trip must never enter the attacker's write set, got ${JSON.stringify(written)}`
    );

    const row = t.trips().find((r) => r.id === "t-victim");
    h.assert(!!row, "the victim's trip must still exist");
    h.assert(row.userId === victim, `ownership must not move, got ${row.userId}`);
    h.assert(
      row.name === "Victim Private Trip",
      `the victim's trip must not be renamed, got ${row.name}`
    );
  });

  await h.test("does NOT delete a trip the snapshot simply omits", async () => {
    // Deletion-by-absence is the other way to destroy another account's data:
    // send a snapshot containing only your own trips.
    const t = await freshDb();
    const victim = "user-victim2";
    const attacker = "user-attacker2";
    t.addUser(victim);
    t.addUser(attacker);

    t.db.tx.replaceOwnedRows(
      victim,
      snapshot({ trips: [trip("t-victim2", victim, "Victim Trip 2")] })
    );
    t.db.tx.replaceOwnedRows(
      attacker,
      snapshot({ trips: [trip("t-attacker", attacker, "Mine")] })
    );

    h.assert(
      t.tripIds().includes("t-victim2"),
      "omitting a trip from your own snapshot must not delete another account's"
    );
  });

  await h.test("does NOT inject a child row into another account's trip", async () => {
    // Categories and items are gated on the same ownership set as their parent
    // trip, so this is the cross-account reference leak the design warns about.
    const t = await freshDb();
    const victim = "user-victim3";
    const attacker = "user-attacker3";
    t.addUser(victim);
    t.addUser(attacker);

    t.db.tx.replaceOwnedRows(
      victim,
      snapshot({ trips: [trip("t-victim3", victim, "Victim Trip 3")] })
    );
    t.db.tx.replaceOwnedRows(
      attacker,
      snapshot({
        trips: [trip("t-attacker3", attacker, "Mine")],
        categories: [category("evil", "t-victim3", "INJECTED")],
        items: [item("evil-i", "t-victim3", "evil", "INJECTED")],
      })
    );

    h.assert(
      t.categories().every((c) => c.tripId !== "t-victim3"),
      "a category must not be injectable into another account's trip"
    );
    h.assert(
      t.items().every((i) => i.tripId !== "t-victim3"),
      "an item must not be injectable into another account's trip"
    );
  });

  await h.test("replaces the actor's OWN trip set on a later push", async () => {
    // Replace semantics must still hold: a second push is the authoritative view
    // of the actor's own data, so removing a trip from it does delete that trip.
    const t = await freshDb();
    const uid = "user-replace";
    t.addUser(uid);

    t.db.tx.replaceOwnedRows(
      uid,
      snapshot({ trips: [trip("keep", uid, "Keep"), trip("drop", uid, "Drop")] })
    );
    h.assert(t.tripIds().length === 2, `both trips land first, got ${t.tripIds()}`);

    t.db.tx.replaceOwnedRows(uid, snapshot({ trips: [trip("keep", uid, "Keep")] }));

    const ids = t.tripIds();
    h.assert(ids.includes("keep"), "a trip still in the snapshot survives");
    h.assert(
      !ids.includes("drop"),
      "a trip the owner removed from their OWN snapshot is deleted"
    );
  });

  await h.test("an empty snapshot clears only the actor's own trips", async () => {
    /*
     * Replace semantics are per-actor, so "empty" means "this actor has no
     * trips" rather than "delete everything". Worth pinning because the old
     * early `return` on an empty scope was half the create bug, and because a
     * careless fix could turn an empty snapshot into a global wipe.
     */
    const t = await freshDb();
    const uid = "user-empty";
    const other = "user-other";
    t.addUser(uid);
    t.addUser(other);

    t.db.tx.replaceOwnedRows(
      other,
      snapshot({ trips: [trip("t-other", other, "Not Yours")] })
    );
    t.db.tx.replaceOwnedRows(uid, snapshot({ trips: [trip("t-mine", uid, "Mine")] }));

    t.db.tx.replaceOwnedRows(uid, snapshot({ trips: [] }));

    const ids = t.tripIds();
    h.assert(!ids.includes("t-mine"), "an empty snapshot clears the actor's own trips");
    h.assert(
      ids.includes("t-other"),
      "an empty snapshot must not touch another account's trips"
    );
  });

  h.summary();
})();
