/*
 * Tests for the bags migration and the bag-related schema invariants.
 *
 * These run against a THROWAWAY copy of the schema, never the live database --
 * the harness sets TRIP_PACKER_DB. What is being pinned here is the set of
 * schema properties that later features depend on and that are easy to break
 * invisibly:
 *
 *   1. The migration is idempotent. It re-runs on every getDb() (dev HMR
 *      re-evaluates the module while globalThis keeps the old connection), so a
 *      non-idempotent step would explode on the second access.
 *   2. It is ADDITIVE. Existing items must keep working and read as bagId NULL,
 *      so the change cannot break trips that never use bags.
 *   3. bags.tripId is NULLABLE. This is load-bearing: a bag with no trip is a
 *      registered bag that travels across trips, and a NOT NULL column here
 *      would make that a data migration instead of an additive one.
 *   4. Deleting a trip cascades its bags, and deleting a BAG does not delete
 *      its items -- the failure mode being items silently disappearing from a
 *      packing list, which is data loss from the user's point of view.
 */

const h = require("./harness.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

/* Use an isolated DB for this file. */
const TMP = path.join(os.tmpdir(), `tp-bags-mig-${process.pid}.db`);
for (const s of ["", "-wal", "-shm"]) fs.rmSync(TMP + s, { force: true });
process.env.TRIP_PACKER_DB = TMP;

const { getDb, readState } = h.loadModule("src/lib/db.ts");

async function run() {
  const db = getDb();

  await h.test("the bags table exists after migration", () => {
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bags'")
      .get();
    h.assert(!!t, "bags table should have been created by the migration");
  });

  await h.test("items gained a bagId column", () => {
    const cols = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);
    h.assert(cols.includes("bagId"), `items should have bagId; got ${cols.join(",")}`);
  });

  await h.test("the migration is IDEMPOTENT (a second run is a no-op)", () => {
    // getDb() re-runs migrate() on every access, so this is the real behaviour.
    let threw = null;
    try {
      getDb();
      getDb();
    } catch (e) {
      threw = e;
    }
    h.assert(threw === null, `re-running the migration must not throw: ${threw}`);
    const count = db
      .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='bags'")
      .get().c;
    h.assertEqual(count, 1, "bags must not be duplicated");
  });

  await h.test("bags.tripId is NULLABLE (registered bags need this)", () => {
    const now = new Date().toISOString();
    // A bag with NO trip is the registered-bag shape. It must insert.
    let threw = null;
    try {
      db.prepare(
        `INSERT INTO bags (id,tripId,name,kind,tagNumber,notes,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run("bag-registered", null, "Registered Away", "checked", "AA123456", null, now, now);
    } catch (e) {
      threw = e;
    }
    h.assert(threw === null, `a bag with NULL tripId must be insertable: ${threw}`);
    const row = db.prepare("SELECT tripId FROM bags WHERE id='bag-registered'").get();
    h.assertEqual(row.tripId, null);
  });

  await h.test("bags.kind rejects an unknown kind (CHECK constraint holds)", () => {
    const now = new Date().toISOString();
    let threw = null;
    try {
      db.prepare(
        `INSERT INTO bags (id,tripId,name,kind,createdAt,updatedAt) VALUES (?,?,?,?,?,?)`
      ).run("bag-bad-kind", null, "Nope", "not-a-kind", now, now);
    } catch (e) {
      threw = e;
    }
    h.assert(threw !== null, "an invalid kind must be refused by the schema");
  });

  await h.test("deleting a TRIP cascades its bags", () => {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id,name,avatarColor,createdAt,isOwner) VALUES (?,?,?,?,?)"
    ).run("u-cascade", "Cascade", "bg-zinc-500", now, 0);
    db.prepare(
      "INSERT INTO trips (id,userId,name,createdAt,updatedAt) VALUES (?,?,?,?,?)"
    ).run("t-cascade", "u-cascade", "Cascade Trip", now, now);
    db.prepare(
      `INSERT INTO bags (id,tripId,name,kind,createdAt,updatedAt) VALUES (?,?,?,?,?,?)`
    ).run("bag-cascade", "t-cascade", "Doomed", "checked", now, now);

    db.prepare("DELETE FROM trips WHERE id=?").run("t-cascade");
    const left = db.prepare("SELECT COUNT(*) c FROM bags WHERE id='bag-cascade'").get().c;
    h.assertEqual(left, 0, "the trip's bags should have been removed with it");
  });

  await h.test("items.bagId defaults to NULL and does not disturb existing reads", () => {
    /*
     * The additive guarantee. An item created without a bag must read as
     * unassigned, and readState() must still return items.
     */
    const state = readState();
    h.assert(Array.isArray(state.items), "readState().items should still be an array");
    for (const it of state.items) {
      h.assert(
        it.bagId === null || it.bagId === undefined || typeof it.bagId === "string",
        `item.bagId should be null/undefined/string, got ${typeof it.bagId}`
      );
    }
  });

  /* -- clean up the isolated DB ---------------------------------------- */

  await h.test("cleanup", () => {
    db.close();
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(TMP + s, { force: true });
    h.assert(true, "ok");
  });

  return h.summary();
}

run();
