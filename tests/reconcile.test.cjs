/*
 * Tests for the local-first reconciliation policy.
 *
 * The bug this guards against: fetchState() used to overwrite the rendered
 * state and the offline cache with whatever the server returned. When the
 * offline queue was non-empty that server snapshot predated the queued edits,
 * so an offline edit could be silently lost. reconcile() replays the pending
 * ops on top of the server base so the local edit always survives.
 */

const h = require("./harness.cjs");
const path = require("node:path");

const reconcilePath = path.join(h.SRC, "lib", "reconcile.ts");

const { applyOpToState, replayOps, reconcile } = h.loadModule(reconcilePath);

function emptyState() {
  return {
    users: [],
    activeUserId: "",
    trips: [],
    categories: [],
    items: [],
    tasks: [],
    reservations: [],
  };
}

function user(id, name = "You") {
  return { id, name, avatarColor: "bg-emerald-500", createdAt: "2026-01-01T00:00:00Z" };
}

function trip(id, name, userId = "u1") {
  return {
    id,
    userId,
    name,
    destination: "",
    startDate: "",
    endDate: "",
    notes: "",
    icon: "✈️",
    archived: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function item(id, tripId, name, checked = false) {
  return {
    id,
    tripId,
    categoryId: "c1",
    name,
    quantity: 1,
    checked,
    icon: "👕",
    order: 0,
  };
}

(async () => {
  console.log("reconcile");

  await h.test("no pending ops: returns the server state untouched", () => {
    const server = { ...emptyState(), users: [user("u1")], activeUserId: "u1" };
    const out = reconcile(server, []);
    h.assert(out === server, "should return the same object reference");
  });

  await h.test("pending item.update over a stale server state keeps the edit", () => {
    // Server has the item unchecked; the user checked it offline.
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      trips: [trip("t1", "Japan")],
      items: [item("i1", "t1", "Passport", false)],
    };
    const out = reconcile(server, [{ op: "item.update", id: "i1", updates: { checked: true } }]);
    h.assertEqual(out.items[0].checked, true, "offline check must survive");
    // The server base is not mutated.
    h.assertEqual(server.items[0].checked, false, "input state must not be mutated");
  });

  await h.test("independent server changes are preserved alongside local edits", () => {
    // Server gained a trip from another device; local queue touches a different
    // entity. Both must be present — this is the "not last-write-wins wholesale"
    // requirement.
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      trips: [trip("t1", "Japan"), trip("t2", "Iceland")],
      items: [item("i1", "t1", "Socks", false)],
    };
    const out = reconcile(server, [{ op: "item.update", id: "i1", updates: { checked: true } }]);
    h.assertEqual(out.trips.length, 2, "other-device trip must remain");
    h.assertEqual(out.items[0].checked, true, "local edit must remain");
  });

  await h.test("pending item.create is not clobbered by the server snapshot", () => {
    const server = { ...emptyState(), users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], items: [] };
    const out = reconcile(server, [{ op: "item.create", item: item("i9", "t1", "Toothbrush") }]);
    h.assertEqual(out.items.length, 1);
    h.assertEqual(out.items[0].name, "Toothbrush");
  });

  await h.test("pending trip.delete cascades over the server base", () => {
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      trips: [trip("t1", "Japan"), trip("t2", "Iceland")],
      items: [item("i1", "t1", "Socks"), item("i2", "t2", "Parka")],
    };
    const out = reconcile(server, [{ op: "trip.delete", id: "t1" }]);
    h.assertEqual(out.trips.map((t) => t.id), ["t2"]);
    h.assertEqual(out.items.map((i) => i.id), ["i2"], "trip delete must cascade to items");
  });

  await h.test("ops replay in order: create then update the same entity", () => {
    const server = { ...emptyState(), users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], items: [] };
    const out = replayOps(server, [
      { op: "item.create", item: item("i9", "t1", "Toothbrush") },
      { op: "item.update", id: "i9", updates: { name: "Electric Toothbrush" } },
    ]);
    h.assertEqual(out.items[0].name, "Electric Toothbrush");
  });

  await h.test("trip.update patch merges fields (does not replace the row)", () => {
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      trips: [trip("t1", "Japan", "u1")],
    };
    const out = applyOpToState(server, { op: "trip.update", id: "t1", updates: { name: "Japan 2027" } });
    h.assertEqual(out.trips[0].name, "Japan 2027");
    h.assertEqual(out.trips[0].destination, "", "untouched fields must survive");
  });

  await h.test("deleting the active user re-homes to the first remaining user", () => {
    const server = { ...emptyState(), users: [user("u1"), user("u2", "Dexter")], activeUserId: "u1" };
    const out = applyOpToState(server, { op: "user.delete", id: "u1" });
    h.assertEqual(out.users.map((u) => u.id), ["u2"]);
    h.assertEqual(out.activeUserId, "u2");
  });

  await h.test("reservation.reorder assigns order by index within the trip", () => {
    const r = (id, tripId, order) => ({
      id, tripId, type: "flight", title: id, confirmation: "", confirmed: true,
      location: "", locationTo: "", startDate: "", startTime: "", endDate: "",
      endTime: "", cost: "", notes: "", order, createdAt: "2026-01-01T00:00:00Z",
    });
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      reservations: [r("r1", "t1", 0), r("r2", "t1", 1), r("r3", "t2", 0)],
    };
    const out = applyOpToState(server, { op: "reservation.reorder", tripId: "t1", orderedIds: ["r2", "r1"] });
    const byId = Object.fromEntries(out.reservations.map((x) => [x.id, x.order]));
    h.assertEqual(byId.r2, 0);
    h.assertEqual(byId.r1, 1);
    h.assertEqual(byId.r3, 0, "a different trip's reservation is untouched");
  });

  await h.test("state.replace applies the newest snapshot wholesale", () => {
    const server = { ...emptyState(), users: [user("u1")], activeUserId: "u1" };
    const replacement = { ...emptyState(), users: [user("uX", "Zed")], activeUserId: "uX" };
    const out = applyOpToState(server, { op: "state.replace", state: replacement });
    h.assertEqual(out.activeUserId, "uX");
  });

  await h.test("a malformed op is ignored rather than throwing", () => {
    const server = { ...emptyState(), users: [user("u1")], activeUserId: "u1" };
    h.assertEqual(applyOpToState(server, null), server);
    h.assertEqual(applyOpToState(server, { notAnOp: true }), server);
    h.assertEqual(applyOpToState(server, { op: "does.not.exist" }), server);
  });

  await h.test("applyOpToState never mutates the input state", () => {
    const server = {
      ...emptyState(),
      users: [user("u1")],
      activeUserId: "u1",
      items: [item("i1", "t1", "Socks", false)],
    };
    const frozen = JSON.stringify(server);
    applyOpToState(server, { op: "item.update", id: "i1", updates: { checked: true } });
    h.assertEqual(JSON.stringify(server), frozen, "input must be unchanged");
  });

  h.summary();
})();
