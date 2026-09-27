/*
 * Tests for the metrics ingestion logic.
 *
 * Why this is worth testing rather than trusting: /api/metrics is an
 * UNAUTHENTICATED write endpoint, so `sanitizeBatch` is the only thing standing
 * between the open internet and a table of arbitrary rows. Two failure modes
 * matter and both are silent in production:
 *
 *   - Too permissive: an attacker (or a typo in a call site) creates unbounded
 *     junk series, and the numbers used to make product decisions become
 *     meaningless.
 *   - Too strict: real events are dropped, and the table quietly under-reports
 *     — which is worse, because the report looks plausible. A missing
 *     trip_created is indistinguishable from nobody creating trips.
 *
 * The path normaliser is tested for the same reason: it is what stops trip and
 * bag ids ending up in the database, so a regression there is a privacy bug
 * that no error message would ever surface.
 */

const h = require("./harness.cjs");

const { sanitizeBatch, sanitizeEvent, normalizePath, KNOWN_EVENTS, MAX_BATCH } =
  h.loadModule("src/lib/metrics.ts");

async function run() {
  /* -- the allowlist: the security boundary ----------------------------- */

  await h.test("only known event names are accepted", () => {
    h.assertEqual(sanitizeEvent({ name: "page_view" }).name, "page_view");
    h.assertEqual(sanitizeEvent({ name: "trip_created" }).name, "trip_created");
    /*
     * An unknown name is dropped outright rather than coerced to "unknown".
     * Coercing would let anyone create unbounded distinct rows by varying the
     * name, and a catch-all bucket tells the report nothing anyway.
     */
    h.assertEqual(sanitizeEvent({ name: "definitely_not_an_event" }), null);
    h.assertEqual(sanitizeEvent({ name: "DROP TABLE metrics_events" }), null);
    h.assertEqual(sanitizeEvent({ name: "" }), null);
  });

  await h.test("prototype and inherited names are not events", () => {
    /*
     * The allowlist is a Set, so this is really asserting the lookup is not a
     * property access on an object. With `obj[name]` these would all pass and
     * "constructor" would become a valid series — the classic prototype
     * pollution footgun.
     */
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      h.assertEqual(sanitizeEvent({ name }), null, `${name} must not be an event`);
    }
  });

  await h.test("a non-object event is rejected, not thrown on", () => {
    /*
     * This handler parses attacker-supplied JSON. Every one of these shapes is
     * trivially sendable, and a throw here would be a 500 on an endpoint that
     * is supposed to be invisible.
     */
    for (const bad of [null, undefined, "page_view", 42, true, []]) {
      h.assertEqual(sanitizeEvent(bad), null);
    }
  });

  /* -- metadata: bounded, flat, scalar ---------------------------------- */

  await h.test("meta keeps flat scalars and drops nested structures", () => {
    const r = sanitizeEvent({
      name: "page_view",
      meta: { path: "/trips", n: 3, ok: true, nested: { a: 1 }, arr: [1, 2] },
    });
    h.assertEqual(r.meta.path, "/trips");
    h.assertEqual(r.meta.n, 3);
    h.assertEqual(r.meta.ok, true);
    /*
     * Nested values are dropped rather than stringified. JSON.stringify would
     * happily store a 10MB blob, turning a count table into a dumping ground.
     */
    h.assertEqual(r.meta.nested, undefined);
    h.assertEqual(r.meta.arr, undefined);
  });

  await h.test("meta keys and string values are length-capped", () => {
    const longKey = "k".repeat(200);
    const r = sanitizeEvent({
      name: "page_view",
      meta: { [longKey]: "x".repeat(500), path: "/trips" },
    });
    const keys = Object.keys(r.meta);
    for (const k of keys) {
      h.assert(k.length <= 40, `key too long: ${k.length}`);
    }
    for (const v of Object.values(r.meta)) {
      if (typeof v === "string") h.assert(v.length <= 120, `value too long: ${v.length}`);
    }
    h.assertEqual(r.meta.path, "/trips");
  });

  await h.test("meta is omitted entirely when it sanitises to nothing", () => {
    /*
     * `null` rather than `{}`. An empty object stored for every event is pure
     * overhead on the largest column in the table, and it makes
     * "has metadata" queries useless.
     */
    h.assertEqual(sanitizeEvent({ name: "page_view" }).meta, null);
    h.assertEqual(sanitizeEvent({ name: "page_view", meta: "nope" }).meta, null);
    h.assertEqual(sanitizeEvent({ name: "page_view", meta: {} }).meta, null);
    h.assertEqual(
      sanitizeEvent({ name: "page_view", meta: { nested: { a: 1 } } }).meta,
      null
    );
  });

  await h.test("a non-numeric, non-boolean meta value is discarded", () => {
    // NaN and Infinity are JSON-serialisable in a way that corrupts a report:
    // JSON.stringify turns them into null, so the count looks like a bad row.
    const r = sanitizeEvent({
      name: "page_view",
      meta: { nan: NaN, inf: Infinity, neg: -Infinity, good: 1 },
    });
    h.assertEqual(r.meta.good, 1);
    h.assertEqual(r.meta.nan, undefined);
    h.assertEqual(r.meta.inf, undefined);
    h.assertEqual(r.meta.neg, undefined);
  });

  /* -- session id: opaque and bounded ----------------------------------- */

  await h.test("session id is bounded and type-checked", () => {
    h.assertEqual(sanitizeEvent({ name: "page_view", sessionId: "abc123" }).sessionId, "abc123");
    // Anything oversized is dropped rather than truncated: a truncated id would
    // collide with a different session and silently merge two sittings.
    h.assertEqual(sanitizeEvent({ name: "page_view", sessionId: "x".repeat(200) }).sessionId, null);
    h.assertEqual(sanitizeEvent({ name: "page_view", sessionId: 12345 }).sessionId, null);
    h.assertEqual(sanitizeEvent({ name: "page_view" }).sessionId, null);
  });

  /* -- batch handling --------------------------------------------------- */

  await h.test("a batch passes valid events and counts the rejects", () => {
    const r = sanitizeBatch([
      { name: "page_view", sessionId: "s1", meta: { path: "/" } },
      { name: "nonsense" },
      { name: "trip_created", sessionId: "s1" },
    ]);
    h.assertEqual(r.events.length, 2);
    h.assertEqual(r.rejected, 1);
  });

  await h.test("an oversized batch is truncated, not rejected", () => {
    /*
     * Truncate rather than 400. The events are genuine; the sender is a buggy
     * or over-eager client. Keeping the first MAX_BATCH is the useful half
     * (they arrive in order) and it bounds the write unconditionally.
     */
    const many = Array.from({ length: MAX_BATCH + 25 }, () => ({ name: "page_view" }));
    const r = sanitizeBatch(many);
    h.assertEqual(r.events.length, MAX_BATCH);
    h.assertEqual(r.rejected, 25);
  });

  await h.test("a non-array batch yields nothing and does not throw", () => {
    for (const bad of [null, undefined, "x", 42, {}]) {
      const r = sanitizeBatch(bad);
      h.assertEqual(r.events.length, 0);
    }
  });

  await h.test("the event list has no duplicates", () => {
    // A duplicated name in the allowlist is a silent coverage hole: the report
    // would show one row per event, and a reader has no way to notice.
    h.assertEqual(new Set(KNOWN_EVENTS).size, KNOWN_EVENTS.length);
  });

  /* -- path normalisation: the privacy guard ---------------------------- */

  await h.test("trip and bag ids are replaced, not stored", () => {
    /*
     * This is the test that matters most. Paths are the one place a real
     * identifier can leak into this table, and an id in a path is exactly the
     * kind of "not technically PII" detail that turns a count table into a
     * record of what each person looked at.
     */
    h.assertEqual(normalizePath("/trips/abc123"), "/trips/:id");
    h.assertEqual(normalizePath("/trips/abc123/bags"), "/trips/:id/bags");
    h.assertEqual(normalizePath("/share/xyz789"), "/share/:id");

    const out = normalizePath("/trips/t_8f3a2b1c/bags/b_99");
    h.assert(!out.includes("8f3a2b1c"), `leaked a trip id: ${out}`);
    h.assert(!out.includes("99"), `leaked a bag id: ${out}`);
  });

  await h.test("normalisation is stable across different ids", () => {
    // If two ids normalised differently the report would fragment, which is
    // how you end up with "top page: /trips/:id" listed eleven times.
    h.assertEqual(normalizePath("/trips/aaaa"), normalizePath("/trips/bbbb"));
  });

  await h.test("known static routes are left alone", () => {
    for (const p of ["/", "/trips", "/settings", "/about"]) {
      h.assertEqual(normalizePath(p), p);
    }
  });

  await h.test("a query string or hash cannot smuggle a value in", () => {
    // The query is where a token or an email would realistically appear, and
    // nothing in this table needs it.
    h.assertEqual(normalizePath("/trips?email=a@b.com"), "/trips");
    h.assertEqual(normalizePath("/trips#section"), "/trips");
    h.assertEqual(normalizePath("/share/tok#x"), "/share/:id");
  });

  await h.test("hostile and empty paths normalise without throwing", () => {
    for (const p of ["", "/", "///", "no-leading-slash", "/trips/"]) {
      const out = normalizePath(p);
      h.assertEqual(typeof out, "string");
      h.assert(out.length > 0, "must always return something renderable");
      h.assert(out.length <= 120, `too long: ${out.length}`);
    }
  });

  /* -- the ingest boundary: normalisation must not depend on the client --- */

  await h.test("a raw path in meta is normalised ON INGEST, not trusted", () => {
    /*
     * Regression test for a real bug found by hitting the running endpoint with
     * curl: `normalizePath` was applied only in the client (`track.ts`), so a
     * hand-crafted POST wrote `/trips/abc123` straight into the table — the
     * exact identifier this design exists to avoid storing.
     *
     * The test goes through `sanitizeEvent` rather than `normalizePath`
     * directly, because the guarantee being asserted is about the SERVER
     * boundary. Asserting on normalizePath alone would have passed while the
     * endpoint leaked.
     */
    const r = sanitizeEvent({
      name: "page_view",
      meta: { path: "/trips/abc123" },
    });
    h.assertEqual(r.meta.path, "/trips/:id");
    h.assert(!r.meta.path.includes("abc123"), "a trip id reached the table");
  });

  await h.test("a query string cannot be smuggled through meta", () => {
    // The realistic leak: a share link or an email appended to a path.
    const r = sanitizeEvent({
      name: "page_view",
      meta: { path: "/trips?email=someone@example.com" },
    });
    h.assert(
      !r.meta.path.includes("someone@example.com"),
      `email reached the table: ${r.meta.path}`
    );
    h.assertEqual(r.meta.path, "/trips");
  });

  await h.test("non-path meta keys are left alone", () => {
    /*
     * The normaliser must not be applied indiscriminately. `imported_bags` and
     * `item_count` are the useful payload of trip_created; running them through
     * a path shaper would corrupt a count into a route.
     */
    const r = sanitizeEvent({
      name: "trip_created",
      meta: { imported_bags: 1, item_count: 31 },
    });
    h.assertEqual(r.meta.imported_bags, 1);
    h.assertEqual(r.meta.item_count, 31);
  });
}

(async function main() {
  await run();
  h.summary();
})();
