/**
 * Bag ops: reconcile + authorisation scoping.
 *
 * Two separate risks are covered here, and they fail in different ways:
 *
 *   1. reconcile() is the client's optimistic view of a write. If it disagrees
 *      with the server, the UI flickers or shows stale data until reload.
 *   2. scopeStateForUser() is the security boundary. If it under-filters, one
 *      account sees another's bags -- the same class of bug as the print-route
 *      disclosure that shipped earlier, and the reason this file exists at all
 *      rather than trusting "tsc passed".
 *
 * kthxbai
 */
const h = require("./harness.cjs");

(async () => {
  const { reconcile } = await h.loadModule("src/lib/reconcile.ts");
  const { scopeStateForUser } = await h.loadModule("src/lib/access.ts");

  const trip = (id, userId) => ({ id, userId, name: `Trip ${id}` });
  const bag = (id, tripId, name = `Bag ${id}`) => ({
    id,
    tripId,
    name,
    kind: "checked",
    tagNumber: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const item = (id, tripId, categoryId, bagId = null) => ({
    id,
    tripId,
    categoryId,
    name: `Item ${id}`,
    quantity: 1,
    checked: false,
    icon: "box",
    order: 0,
    bagId,
  });
  const base = (over = {}) => ({
    users: [],
    activeUserId: "",
    trips: [],
    categories: [],
    items: [],
    tasks: [],
    reservations: [],
    bags: [],
    ...over,
  });

  /* ---------------- reconcile: the three ops ---------------- */

  await h.test("bag.create appends the bag", () => {
    const next = reconcile(base(), [{ op: "bag.create", bag: bag("b1", "t1") }]);
    h.assertEqual(next.bags.length, 1);
    h.assertEqual(next.bags[0].id, "b1");
  });

  await h.test("bag.update patches fields and preserves identity", () => {
    const start = base({ bags: [bag("b1", "t1", "Old")] });
    const next = reconcile(start, [
      { op: "bag.update", id: "b1", updates: { name: "New", tagNumber: "AA123" } },
    ]);
    h.assertEqual(next.bags[0].name, "New");
    h.assertEqual(next.bags[0].tagNumber, "AA123");
    h.assertEqual(next.bags[0].tripId, "t1");
  });

  await h.test("bag.update on an unknown id is a no-op, not a crash", () => {
    const start = base({ bags: [bag("b1", "t1")] });
    const next = reconcile(start, [{ op: "bag.update", id: "nope", updates: { name: "x" } }]);
    h.assertEqual(next.bags.length, 1);
    h.assertEqual(next.bags[0].name, "Bag b1");
  });

  await h.test("bag.delete removes the bag", () => {
    const start = base({ bags: [bag("b1", "t1"), bag("b2", "t1")] });
    const next = reconcile(start, [{ op: "bag.delete", id: "b1" }]);
    h.assertEqual(next.bags.length, 1);
    h.assertEqual(next.bags[0].id, "b2");
  });

  /* ---------------- reconcile: the deletion semantics ---------------- */

  await h.test("bag.delete UNASSIGNS its items instead of deleting them", () => {
    const start = base({
      bags: [bag("b1", "t1")],
      items: [item("i1", "t1", "c1", "b1")],
    });
    const next = reconcile(start, [{ op: "bag.delete", id: "b1" }]);
    // The item must survive: losing a packing row because its bag was deleted
    // would destroy real user data.
    h.assertEqual(next.items.length, 1);
    h.assertEqual(next.items[0].bagId, null);
  });

  await h.test("bag.delete leaves other bags' items alone", () => {
    const start = base({
      bags: [bag("b1", "t1"), bag("b2", "t1")],
      items: [item("i1", "t1", "c1", "b1"), item("i2", "t1", "c1", "b2")],
    });
    const next = reconcile(start, [{ op: "bag.delete", id: "b1" }]);
    const i2 = next.items.find((i) => i.id === "i2");
    h.assertEqual(i2.bagId, "b2");
  });

  await h.test("trip.delete also clears bags and bag assignments", () => {
    const start = base({
      trips: [trip("t1", "u1")],
      bags: [bag("b1", "t1")],
      items: [item("i1", "t1", "c1", "b1")],
    });
    const next = reconcile(start, [{ op: "trip.delete", id: "t1" }]);
    h.assertEqual(next.bags.length, 0);
    h.assertEqual(next.items.length, 0);
  });

  /* ---------------- reconcile: item assignment ---------------- */

  await h.test("item.update assigns a bag", () => {
    const start = base({ items: [item("i1", "t1", "c1", null)] });
    const next = reconcile(start, [{ op: "item.update", id: "i1", updates: { bagId: "b1" } }]);
    h.assertEqual(next.items[0].bagId, "b1");
  });

  await h.test("item.update with bagId null UNASSIGNS", () => {
    const start = base({ items: [item("i1", "t1", "c1", "b1")] });
    const next = reconcile(start, [{ op: "item.update", id: "i1", updates: { bagId: null } }]);
    // null must be applied, not treated as "absent" -- this is the distinction
    // the db layer's !== undefined filter exists to preserve.
    h.assertEqual(next.items[0].bagId, null);
  });

  await h.test("reconcile tolerates a state with no bags key at all", () => {
    // Old cached state from before this migration must not throw.
    const legacy = {
      users: [],
      activeUserId: "",
      trips: [],
      categories: [],
      items: [],
      tasks: [],
      reservations: [],
    };
    const next = reconcile(legacy, [{ op: "bag.create", bag: bag("b1", "t1") }]);
    h.assertEqual(next.bags.length, 1);
  });

  /* ---------------- scopeStateForUser: the security boundary ---------------- */

  const twoUsers = () => ({
    users: [
      { id: "u1", name: "One", createdAt: "", avatarColor: "#000", theme: "dark" },
      { id: "u2", name: "Two", createdAt: "", avatarColor: "#000", theme: "dark" },
    ],
    activeUserId: "u1",
    trips: [trip("t1", "u1"), trip("t2", "u2")],
    categories: [],
    items: [],
    tasks: [],
    reservations: [],
    bags: [bag("b1", "t1", "Mine"), bag("b2", "t2", "Theirs")],
  });

  await h.test("a user sees only their own trip's bags", () => {
    const scoped = scopeStateForUser(twoUsers(), "u1");
    h.assertEqual(scoped.bags.length, 1);
    h.assertEqual(scoped.bags[0].id, "b1");
  });

  await h.test("ANOTHER USER'S BAG NEVER APPEARS (the leak this guards)", () => {
    const scoped = scopeStateForUser(twoUsers(), "u1");
    const ids = scoped.bags.map((b) => b.id);
    h.assert(!ids.includes("b2"), "u1 must not receive u2's bag");
    // And the name must not leak either -- ids are not the only disclosure.
    const names = scoped.bags.map((b) => b.name);
    h.assert(!names.includes("Theirs"), "u1 must not receive u2's bag name");
  });

  await h.test("an item pointing at an invisible bag has its bagId nulled", () => {
    const state = twoUsers();
    state.items = [item("i1", "t1", "c1", "b2")]; // item in u1's trip, bag in u2's
    const scoped = scopeStateForUser(state, "u1");
    h.assertEqual(scoped.items.length, 1);
    // The item is legitimately visible; the foreign bag reference is not.
    h.assertEqual(scoped.items[0].bagId, null);
  });

  await h.test("an item pointing at a visible bag KEEPS its bagId", () => {
    const state = twoUsers();
    state.items = [item("i1", "t1", "c1", "b1")];
    const scoped = scopeStateForUser(state, "u1");
    h.assertEqual(scoped.items[0].bagId, "b1");
  });

  await h.test("a shared trip exposes its bags to the other member", () => {
    const state = twoUsers();
    state.tripMembers = [{ tripId: "t2", userId: "u1", role: "viewer", createdAt: "" }];
    const scoped = scopeStateForUser(state, "u1");
    const ids = scoped.bags.map((b) => b.id).sort();
    h.assertDeepEqual(ids, ["b1", "b2"]);
  });

  await h.test("scoping an unknown user returns null, not everything", () => {
    h.assertEqual(scopeStateForUser(twoUsers(), "ghost"), null);
    h.assertEqual(scopeStateForUser(twoUsers(), null), null);
  });

  await h.test("a state with no bags key scopes to an empty list", () => {
    const state = twoUsers();
    delete state.bags;
    const scoped = scopeStateForUser(state, "u1");
    h.assertDeepEqual(scoped.bags, []);
  });

  h.summary();
})();
