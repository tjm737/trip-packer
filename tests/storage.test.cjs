/*
 * Integration tests for the real fetchState() / reconcilePending() pair.
 *
 * These exercise the actual src/lib/storage.ts module (transpiled from source,
 * not re-implemented) against a stubbed localStorage + fetch, because the
 * "offline edit silently lost" bug lived exactly in this seam: fetchState()
 * mirrored the server snapshot over the cache without replaying the queue.
 */

const h = require("./harness.cjs");
const path = require("node:path");

const storagePath = path.join(h.SRC, "lib", "storage.ts");

/* ----------------------------------------------------------- test doubles */

function installBrowser({ onLine = true } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  globalThis.window = { localStorage, location: { origin: "http://localhost:4000" } };
  globalThis.localStorage = localStorage;
  globalThis.navigator = { onLine };

  return store;
}

function teardownBrowser() {
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.navigator;
  delete globalThis.fetch;
}

function user(id, name = "You") {
  return { id, name, avatarColor: "bg-emerald-500", createdAt: "2026-01-01T00:00:00Z" };
}

function trip(id, name) {
  return {
    id, userId: "u1", name, destination: "", startDate: "", endDate: "",
    notes: "", icon: "✈️", archived: false,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

function item(id, tripId, name, checked) {
  return { id, tripId, categoryId: "c1", name, quantity: 1, checked, icon: "👕", order: 0 };
}

/** Captures every fetch() call and returns a canned JSON response. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init) || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  return calls;
}

function freshStorage() {
  // Each test needs a fresh module instance since it holds no state itself but
  // we want clean caches; loadModule caches per file, so re-transpile.
  delete require.cache[storagePath];
  return h.loadModule(storagePath, new Map());
}

(async () => {
  console.log("storage.fetchState");

  await h.test("fetchState hits an ABSOLUTE /api/state url (the relative-url bug)", async () => {
    installBrowser();
    const calls = stubFetch(() => ({ body: { state: null } }));
    const s = freshStorage();
    await s.fetchState();
    h.assertEqual(calls.length, 1);
    h.assertEqual(calls[0].url, "http://localhost:4000/api/state", "must be absolute");
    teardownBrowser();
  });

  await h.test("fetchState mirrors a successful read into the cache", async () => {
    const store = installBrowser();
    const server = { users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], categories: [], items: [], tasks: [], reservations: [] };
    stubFetch(() => ({ body: { state: server } }));
    const s = freshStorage();
    const out = await s.fetchState();
    h.assertEqual(out.trips.length, 1);
    h.assert(store.size > 0, "cache must be written");
    teardownBrowser();
  });

  await h.test("a queued offline edit is NOT clobbered by an arriving server snapshot", async () => {
    installBrowser();
    // Server copy has the item UNCHECKED (it never saw the offline edit).
    const server = {
      users: [user("u1")], activeUserId: "u1",
      trips: [trip("t1", "Japan")], categories: [],
      items: [item("i1", "t1", "Passport", false)],
      tasks: [], reservations: [],
    };
    stubFetch(() => ({ body: { state: server } }));

    const s = freshStorage();
    // Simulate the offline edit having been queued.
    s.queueMutation({ op: "item.update", id: "i1", updates: { checked: true } }, "Check off Passport");

    const out = await s.fetchState();
    h.assertEqual(out.items[0].checked, true, "queued offline edit must survive the server read");

    // And the cache must hold the reconciled state, not the stale server copy.
    const cached = s.reconcilePending
      ? JSON.parse(globalThis.localStorage.getItem("trip-packer:state-cache:v1"))
      : null;
    h.assert(cached, "cache should exist");
    h.assertEqual(cached.items[0].checked, true, "cache must not be clobbered");
    teardownBrowser();
  });

  await h.test("with an empty queue fetchState returns the server state verbatim", async () => {
    installBrowser();
    const server = { users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], categories: [], items: [], tasks: [], reservations: [] };
    stubFetch(() => ({ body: { state: server } }));
    const s = freshStorage();
    const out = await s.fetchState();
    h.assertEqual(JSON.stringify(out), JSON.stringify(server));
    teardownBrowser();
  });

  await h.test("fetchState falls back to the cache when the network throws", async () => {
    installBrowser();
    const server = { users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], categories: [], items: [item("i1", "t1", "Socks", true)], tasks: [], reservations: [] };
    // Prime the cache via a successful read, then make fetch fail.
    stubFetch(() => ({ body: { state: server } }));
    const s = freshStorage();
    await s.fetchState();

    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    const out = await s.fetchState();
    h.assertEqual(out.trips.length, 1, "offline read must return the cached copy");
    h.assertEqual(out.items[0].checked, true);
    teardownBrowser();
  });

  await h.test("offline with no cache throws the friendly ApiError (status 0)", async () => {
    installBrowser({ onLine: false });
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    const s = freshStorage();
    let err = null;
    try {
      await s.fetchState();
    } catch (e) {
      err = e;
    }
    h.assert(err, "must throw when nothing is cached");
    h.assertEqual(err.status, 0, "status 0 marks it as a connectivity failure");
    h.assert(/offline/i.test(err.message), `message should be friendly: got "${err.message}"`);
    teardownBrowser();
  });

  await h.test("flushOfflineQueue replays ops and reconciles any leftover ones", async () => {
    installBrowser();
    const base = { users: [user("u1")], activeUserId: "u1", trips: [trip("t1", "Japan")], categories: [], items: [], tasks: [], reservations: [] };
    // The server applies the first op but then goes offline for the second.
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call++;
      if (call === 1) {
        const body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ state: { ...base, items: [body.item] } }) };
      }
      throw new TypeError("Failed to fetch");
    };

    const s = freshStorage();
    s.queueMutation({ op: "item.create", item: item("i1", "t1", "Socks") }, "Add Socks");
    s.queueMutation({ op: "item.create", item: item("i2", "t1", "Parka") }, "Add Parka");

    const out = await s.flushOfflineQueue();
    h.assert(out, "should return a state");
    const names = out.items.map((i) => i.name).sort();
    // i1 landed server-side; i2 is still queued and must be replayed on top so
    // it is not lost from the returned state.
    h.assertEqual(names, ["Parka", "Socks"], "leftover queued op must still be present");
    teardownBrowser();
  });

  h.summary();
})();
