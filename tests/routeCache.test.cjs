/*
 * Tests for the driving-leg cache.
 *
 * The bug these guard against: coordinates were persisted (geoCache) but legs
 * were not, so offline the map drew its pins and then dropped every route line
 * and every "55.9 mi · 1h 22m drive" figure. The pins tell you where the stops
 * are; the drive figures tell you how long the next leg takes, which is the
 * part worth having at the airport.
 *
 * The cache is keyed by the hop itself (not by trip), so these tests focus on
 * that key: it must be order-sensitive, must survive the sub-metre coordinate
 * drift that re-geocoding produces, and must round-trip geometry intact.
 */

const h = require("./harness.cjs");

const routeCachePath = require("node:path").join(h.SRC, "lib", "routeCache.ts");

/** Minimal localStorage so the module can be exercised outside a browser. */
function withStorage(fn) {
  const store = new Map();
  const prev = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    return fn(store);
  } finally {
    if (prev === undefined) delete globalThis.window;
    else globalThis.window = prev;
  }
}

const A = { lat: 63.985, lng: -22.6056 };
const B = { lat: 64.2786, lng: -21.0819 };

(async () => {
  console.log("routeCache");

  const { legKey, readCachedLegs, writeCachedLegs } = h.loadModule(routeCachePath);

  await h.test("legKey is order sensitive (A->B is not B->A)", () => {
    h.assert(legKey(A, B) !== legKey(B, A), "A->B and B->A produced the same key");
  });

  await h.test("legKey ignores sub-metre coordinate drift", () => {
    // Re-geocoding can shift a stop in the last decimal place; a re-geocode once
    // moved a stop and changed the drive total from 131.0 to 128.9 mi. Keying on
    // the raw float would miss the cache on exactly those runs.
    const drifted = { lat: A.lat + 0.00001, lng: A.lng - 0.00001 };
    h.assertEqual(legKey(A, B), legKey(drifted, B));
  });

  await h.test("legKey distinguishes genuinely different hops", () => {
    const far = { lat: 63.99, lng: -22.62 };
    h.assert(legKey(A, B) !== legKey(far, B), "different hops collided onto one key");
  });

  await h.test("round-trips legs, including geometry", () => {
    withStorage(() => {
      const hops = [{ from: A, to: B }];
      const legs = [
        {
          distanceM: 89953.4,
          durationS: 4920,
          geometry: [
            [63.985, -22.6056],
            [64.0, -22.0],
            [64.2786, -21.0819],
          ],
        },
      ];
      writeCachedLegs(hops, legs);

      const got = readCachedLegs(hops);
      h.assertEqual(got.size, 1);
      const leg = got.get(0);
      h.assertEqual(leg.distanceM, 89953.4);
      h.assertEqual(leg.durationS, 4920);
      h.assertEqual(leg.geometry.length, 3);
      // Geometry must survive in [lat, lng] order for Leaflet to draw it.
      h.assertEqual(leg.geometry[2][0], 64.2786);
      h.assertEqual(leg.geometry[2][1], -21.0819);
    });
  });

  await h.test("returns missing hops rather than inventing them", () => {
    withStorage(() => {
      writeCachedLegs([{ from: A, to: B }], [
        { distanceM: 1, durationS: 1, geometry: [[0, 0]] },
      ]);
      // Ask about two hops; only the first was ever cached.
      const far = { lat: 10, lng: 10 };
      const got = readCachedLegs([{ from: A, to: B }, { from: A, to: far }]);
      h.assertEqual(got.size, 1);
      h.assertEqual(got.has(0), true);
      h.assertEqual(got.has(1), false);
    });
  });

  await h.test("survives a corrupted cache entry", () => {
    withStorage((store) => {
      store.set(
        "trip-packer:legcache:v1",
        JSON.stringify({ "1,2|3,4": { distanceM: "nope" }, "5,6|7,8": null })
      );
      const got = readCachedLegs([{ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }]);
      h.assertEqual(got.size, 0);
    });
  });

  await h.test("survives unparseable storage", () => {
    withStorage((store) => {
      store.set("trip-packer:legcache:v1", "{not json");
      const got = readCachedLegs([{ from: A, to: B }]);
      h.assertEqual(got.size, 0);
    });
  });

  await h.test("never throws when storage is unavailable", () => {
    const prev = globalThis.window;
    globalThis.window = {
      get localStorage() {
        throw new Error("blocked");
      },
    };
    try {
      // Quota/blocked storage must not take down the map.
      writeCachedLegs([{ from: A, to: B }], [
        { distanceM: 1, durationS: 1, geometry: [] },
      ]);
      h.assertEqual(readCachedLegs([{ from: A, to: B }]).size, 0);
    } finally {
      if (prev === undefined) delete globalThis.window;
      else globalThis.window = prev;
    }
  });
})();
