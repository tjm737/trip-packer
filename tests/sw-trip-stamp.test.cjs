/*
 * Tests for the service worker's GET_TRIP_STAMP reply.
 *
 * Why this exists separately from stale-cue.test.cjs: that file proves the
 * timestamp is FORMATTED correctly, but the timestamp itself comes from the
 * worker over a MessageChannel. If the worker never replies, or replies with
 * the wrong shape, the cue silently never appears — and the formatter tests
 * stay green the whole time. That is this codebase's recurring failure mode
 * ("the file exists but nothing calls it"), so the handoff gets its own test.
 *
 * HOW sw.js IS LOADED
 *
 * sw.js is a classic worker script, not a module, and it calls
 * self.addEventListener at the top level. There is no way to import it for
 * its message handler alone. Instead this loads the source, runs it inside a
 * `vm` context with a fake `self`, and then invokes the captured listener
 * directly. That keeps the REAL handler under test rather than a copy of it,
 * so the assertion cannot drift from the shipping code.
 *
 * The stubs are deliberately minimal — only the surface the handler touches:
 * caches.open/match, URL, Date. Anything else the handler reaches for is a
 * dependency it should not have, and the resulting crash is the correct
 * outcome rather than something to paper over.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const h = require("./harness.cjs");

const SW_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "public", "sw.js"),
  "utf8"
);

/**
 * Run sw.js in a fake worker scope and return its message listener.
 *
 * `cached` maps a request path to the response headers it was stored with, or
 * to null to model "no entry in the cache".
 */
function loadWorker({ cached = {}, origin = "https://app.example" } = {}) {
  const listeners = {};
  const missing = new Set();

  const self = {
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    location: { origin },
    registration: { showNotification: async () => {} },
    clients: { claim: async () => {}, matchAll: async () => [] },
    skipWaiting: () => {},
    // Tiles and other side quests are not exercised here.
    fetch: async () => ({ ok: true, clone: () => ({ ok: true }), arrayBuffer: async () => new ArrayBuffer(0), blob: async () => ({}) }),
  };

  const context = {
    self,
    caches: {
      open: async () => ({
        match: async (key) => {
          const url = typeof key === "string" ? key : key && key.url ? key.url : String(key);
          const pathname = url.startsWith("http") ? new URL(url).pathname : url;
          missing.add(pathname);
          const entry = cached[pathname];
          if (!entry) return undefined;
          return {
            headers: {
              get: (name) =>
                name === "X-Trip-Saved-At" ? entry : null,
            },
          };
        },
        put: async () => {},
        addAll: async () => {},
        keys: async () => [],
        delete: async () => true,
      }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    fetch: self.fetch,
    Request: class {},
    Response: class {
      constructor(body, init) {
        this.body = body;
        this.headers = (init && init.headers) || {};
        this.status = (init && init.status) || 200;
      }
      clone() { return this; }
      static error() { return new Response("", { status: 500 }); }
    },
    Headers: class {
      constructor(init) { this.map = new Map(Object.entries(init || {})); }
      get(k) { return this.map.get(k) || null; }
      set(k, v) { this.map.set(k, v); }
    },
    URL,
    Date,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Error,
    RegExp,
    Map,
    Set,
    TextEncoder,
    ArrayBuffer,
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(SW_SOURCE, context, { filename: "sw.js" });

  const listener = (listeners.message || [])[0];
  if (!listener) throw new Error("sw.js registered no message listener");

  return { listener, self, missing };
}

/**
 * Send a message and resolve with whatever the handler replies through the
 * supplied port. A timeout proves the handler replied nothing at all, which is
 * the failure the real UI would show as a permanently absent cue.
 */
function ask(listener, data, { timeoutMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const timers = [];
    const port = {
      postMessage: (payload) => {
        timers.forEach(clearTimeout);
        resolve(payload);
      },
      close: () => {},
      onmessage: null,
    };

    const port2 = { postMessage: () => {}, close: () => {} };

    const event = {
      data,
      ports: [port2],
      source: null,
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    };

    // Swap in the real sending port so replies land on `port`.
    event.ports[0] = port;

    timers.push(
      setTimeout(() => reject(new Error("worker never replied")), timeoutMs)
    );

    try {
      const ret = listener(event);
      if (ret && ret.catch) ret.catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function run() {
  /* -- the happy path ---------------------------------------------------- */

  await h.test("a cached trip returns its saved-at stamp", async () => {
    const stamp = "2026-09-22T07:30:00.000Z";
    const { listener } = loadWorker({
      cached: { "/trips/trip-1": stamp },
    });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "/trips/trip-1",
    });

    h.assertEqual(reply.savedAt, stamp);
  });

  await h.test("a cache key written as a full URL is still found", async () => {
    /*
     * CACHE_TRIP stores the page under its own URL. Whether that is written as
     * a path or an absolute URL depends on the request that produced it, so
     * both shapes must resolve to the same entry. Getting this wrong means the
     * cue works in one navigation mode and silently vanishes in another.
     */
    const stamp = "2026-09-22T07:30:00.000Z";
    const { listener } = loadWorker({
      cached: { "/trips/trip-1": stamp },
    });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "https://app.example/trips/trip-1",
    });

    h.assertEqual(reply.savedAt, stamp);
  });

  /* -- the honest "no stamp" cases --------------------------------------- */

  await h.test("a trip that was never cached answers savedAt: null", async () => {
    /*
     * Not an error. A trip the user has never opened online has no saved copy
     * and therefore no age to report; the UI must render nothing rather than
     * claim the content is current.
     */
    const { listener } = loadWorker({ cached: {} });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "/trips/never-seen",
    });

    h.assertEqual(reply.savedAt, null);
  });

  await h.test("a cached entry with no stamp header answers null", async () => {
    /*
     * Reachable: the stamp is written by re-wrapping the response, and that can
     * fail for an opaque or already-consumed body. The page is still cached and
     * still usable — there is simply no time to report.
     */
    const { listener } = loadWorker({ cached: { "/trips/trip-1": null } });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "/trips/trip-1",
    });

    h.assertEqual(reply.savedAt, null);
  });

  await h.test("a malformed stamp is rejected, not passed through", async () => {
    /*
     * A bad value must not reach the UI. If it did, describeSavedAt would
     * return null anyway — but passing garbage across the boundary means the
     * failure is invisible here and surfaces there, which is the harder place
     * to debug. Rejecting at the source keeps the contract honest.
     */
    const { listener } = loadWorker({
      cached: { "/trips/trip-1": "yesterday-ish" },
    });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "/trips/trip-1",
    });

    h.assertEqual(reply.savedAt, null);
  });

  /* -- input that must not be trusted ------------------------------------ */

  await h.test("a missing url answers null instead of throwing", async () => {
    const { listener } = loadWorker({});

    const reply = await ask(listener, { type: "GET_TRIP_STAMP" });

    h.assertEqual(reply.savedAt, null);
  });

  await h.test("a cross-origin url is refused", async () => {
    /*
     * The page passes its own pathname, but the handler is reachable by any
     * script in the origin. Refusing a foreign origin keeps it from being
     * used to probe the contents of the cache on behalf of another site.
     */
    const { listener } = loadWorker({ cached: { "/trips/trip-1": "2026-09-22T07:30:00.000Z" } });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "https://evil.example/trips/trip-1",
    });

    h.assertEqual(reply.savedAt, null);
  });

  await h.test("a non-trip path is refused", async () => {
    const { listener } = loadWorker({ cached: { "/settings": "2026-09-22T07:30:00.000Z" } });

    const reply = await ask(listener, {
      type: "GET_TRIP_STAMP",
      url: "/settings",
    });

    h.assertEqual(reply.savedAt, null);
  });

  /* -- an unrelated message must not be answered ------------------------- */

  await h.test("an unrelated message type is ignored, not replied to", async () => {
    /*
     * The handler sits ahead of the other message branches. If it replied to
     * everything, a PREFETCH_TRIP would be answered with a bogus savedAt and
     * the caller's port would resolve with the wrong payload.
     */
    const { listener } = loadWorker({});

    let replied = false;
    const event = {
      data: { type: "SOMETHING_ELSE" },
      ports: [{ postMessage: () => { replied = true; }, close: () => {} }],
      source: null,
      waitUntil: () => {},
    };
    listener(event);
    await new Promise((r) => setTimeout(r, 30));
    h.assertEqual(replied, false);
  });
}

(async function main() {
  await run();
  h.summary();
})();
