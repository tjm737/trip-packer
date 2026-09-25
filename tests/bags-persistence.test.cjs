/**
 * Bag persistence against a REAL database.
 *
 * The reconcile tests cover the client's optimistic view and the scope tests
 * cover the security boundary; neither of them touches SQLite. This file is the
 * only thing standing between "the types line up" and "the rows actually
 * round-trip".
 *
 * Fixtures here are built to the actual NOT NULL column set, not to a
 * convenient subset: insertTrip also requires icon/archived/updatedAt and
 * insertCategory requires icon. Omitting them throws "Missing named parameter"
 * before any assertion runs, which makes the whole file silently vacuous.
 *
 * The bagId UNASSIGN path gets particular attention: updateItem filters its
 * allowed keys with `!== undefined`, so a null bagId survives the filter and an
 * absent bagId does not. Those two must behave differently or unassigning an
 * item is impossible to express.
 */
const h = require("./harness.cjs");

(async () => {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");

  // Isolate: point the db module at a throwaway file before it is first loaded.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-bags-"));
  process.env.TRIP_PACKER_DB = path.join(dir, "test.db");

  const db = await h.loadModule("src/lib/db.ts");

  const now = () => new Date().toISOString();

  const tripRow = (id, userId, name = "Trip") => ({
    id,
    userId,
    name,
    destination: "",
    startDate: "",
    endDate: "",
    notes: "",
    icon: "✈️",
    archived: false,
    createdAt: now(),
    updatedAt: now(),
  });

  const catRow = (id, tripId, name = "Clothing") => ({
    id,
    tripId,
    name,
    icon: "👕",
    order: 0,
  });

  const itemRow = (id, tripId, categoryId, bagId = null) => ({
    id,
    tripId,
    categoryId,
    name: "Socks",
    quantity: 3,
    checked: false,
    icon: "🧦",
    order: 0,
    bagId,
  });

  const bagRow = (id, tripId, name = "Carry-on") => ({
    id,
    tripId,
    name,
    kind: "carry_on",
    tagNumber: "AA123456",
    notes: "",
    createdAt: now(),
    updatedAt: now(),
  });

  /**
   * Insert one user with one trip, one category and one item.
   *
   * insertUser has no options argument -- there is no becomeActive. Only the
   * first user is active by default, and readState falls back to users[0] when
   * the stored active id matches nothing, so a fresh database needs no extra
   * setup for reads to work.
   */
  const seed = (suffix = "") => {
    db.tx.insertUser({
      id: `u1${suffix}`,
      name: "One",
      createdAt: now(),
      avatarColor: "#000",
      theme: "dark",
    });
    db.tx.insertTrip(tripRow(`t1${suffix}`, `u1${suffix}`));
    db.tx.insertCategory(catRow(`c1${suffix}`, `t1${suffix}`));
    db.tx.insertItem(itemRow(`i1${suffix}`, `t1${suffix}`, `c1${suffix}`));
  };

  await h.test("bag persists and reads back with all fields intact", () => {
    seed();
    db.tx.insertBag(bagRow("b1", "t1"));
    const state = db.readState();
    h.assertEqual(state.bags.length, 1);
    const b = state.bags[0];
    h.assertEqual(b.name, "Carry-on");
    h.assertEqual(b.kind, "carry_on");
    h.assertEqual(b.tagNumber, "AA123456");
    h.assertEqual(b.tripId, "t1");
  });

  await h.test("an item is born unassigned (bagId null, not undefined)", () => {
    const i = db.readState().items.find((x) => x.id === "i1");
    h.assert(i !== undefined, "the seeded item must exist");
    // null specifically: the UI distinguishes unassigned from anything else,
    // and undefined would serialize away entirely over JSON.
    h.assertEqual(i.bagId, null);
  });

  await h.test("assigning an item to a bag persists", () => {
    db.tx.updateItem("i1", { bagId: "b1" });
    h.assertEqual(db.readState().items.find((x) => x.id === "i1").bagId, "b1");
  });

  await h.test("unassigning with null persists as null", () => {
    db.tx.updateItem("i1", { bagId: null });
    h.assertEqual(db.readState().items.find((x) => x.id === "i1").bagId, null);
  });

  await h.test("an update that omits bagId leaves it assigned (not a silent clear)", () => {
    db.tx.updateItem("i1", { bagId: "b1" });
    db.tx.updateItem("i1", { name: "Wool socks" });
    const i = db.readState().items.find((x) => x.id === "i1");
    h.assertEqual(i.name, "Wool socks");
    // This is the undefined-vs-null distinction: a rename must not drop the bag.
    h.assertEqual(i.bagId, "b1");
  });

  await h.test("bag.update persists a rename", () => {
    db.tx.updateBag("b1", { name: "Black carry-on" });
    h.assertEqual(db.readState().bags.find((b) => b.id === "b1").name, "Black carry-on");
  });

  await h.test("bag.update CANNOT reassign tripId (authz would be bypassed)", () => {
    db.tx.updateBag("b1", { tripId: "t-other" });
    // tripId is not in the allowed list, so the bag stays in its own trip. Were
    // it updatable, a caller could move a bag to a trip they cannot write and
    // the owning-trip lookup would then answer from the NEW tripId.
    h.assertEqual(db.readState().bags.find((b) => b.id === "b1").tripId, "t1");
  });

  await h.test("deleting a bag UNASSIGNS its items and keeps the items", () => {
    db.tx.updateItem("i1", { bagId: "b1" });
    db.tx.deleteBag("b1");
    const state = db.readState();
    h.assertEqual(state.bags.length, 0);
    const i = state.items.find((x) => x.id === "i1");
    h.assert(i !== undefined, "the item must survive its bag's deletion");
    h.assertEqual(i.bagId, null);
  });

  await h.test("replaceOwnedRows round-trips bags AND the assignments to them", () => {
    const snap = {
      trips: [tripRow("t1", "u1")],
      categories: [catRow("c1", "t1")],
      bags: [bagRow("b9", "t1", "Packed bag")],
      items: [itemRow("i9", "t1", "c1", "b9")],
      tasks: [],
      reservations: [],
    };
    db.tx.replaceOwnedRows("u1", snap);
    const state = db.readState();
    h.assertEqual(state.bags.length, 1);
    h.assertEqual(state.bags[0].id, "b9");
    // The whole point of ordering bags before items in the re-insert.
    h.assertEqual(state.items.find((x) => x.id === "i9").bagId, "b9");
  });

  await h.test("replaceOwnedRows refuses a bag for a trip the pusher does not own", () => {
    db.tx.insertUser({
      id: "u2",
      name: "Two",
      createdAt: now(),
      avatarColor: "#000",
      theme: "dark",
    });
    db.tx.insertTrip(tripRow("t2", "u2", "Other"));
    const snap = {
      trips: [tripRow("t1", "u1")],
      categories: [catRow("c1", "t1")],
      // A bag claimed for t2 but arriving under u1's push: it must not be
      // written, because u1 does not own t2.
      bags: [bagRow("b-evil", "t2", "Smuggled")],
      items: [],
      tasks: [],
      reservations: [],
    };
    db.tx.replaceOwnedRows("u1", snap);
    h.assert(
      !db.readState().bags.some((b) => b.id === "b-evil"),
      "a bag for a trip the pusher does not own must not be written"
    );
  });

  await h.test("deleting a trip removes its bags (no orphans)", () => {
    // Re-seed fresh ids so this is independent of the rows above.
    seed("x");
    db.tx.insertBag(bagRow("bx", "t1x"));
    db.tx.updateItem("i1x", { bagId: "bx" });
    db.tx.deleteTrip("t1x");
    const state = db.readState();
    h.assert(
      !state.bags.some((b) => b.id === "bx"),
      "a deleted trip's bags must not survive as orphans"
    );
  });

  await h.test("an unknown bag kind is REJECTED by the table, not stored", () => {
    seed("k");
    /*
     * The kind column carries a CHECK constraint, so a junk kind fails at write
     * time rather than surviving to be coerced on read. Rejecting at the
     * database is the stronger guarantee: no row can ever exist in a state the
     * UI has no label for, and a hand-edited database file is caught too.
     */
    let threw = false;
    try {
      db.tx.insertBag({ ...bagRow("bk", "t1k"), kind: "not-a-kind" });
    } catch {
      threw = true;
    }
    h.assert(threw, "a kind outside the CHECK set must throw");
    h.assert(
      !db.readState().bags.some((b) => b.id === "bk"),
      "the rejected bag must not have been written"
    );
  });

  await h.test("cleanup", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    h.assert(true, "cleaned");
  });

  h.summary();
})();
