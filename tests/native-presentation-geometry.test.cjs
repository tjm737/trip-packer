/*
 * Tests for the web -> native presentation geometry handoff.
 *
 * These pin the rules that decide whether the native screen is presented into
 * a region at all. The failure they exist to prevent is a silent one: if the
 * rejection rules are wrong, the native screen either never appears (and
 * nothing says why) or appears collapsed into a few pixels with no way to
 * dismiss it. Neither shows up in a type check.
 */

const h = require("./harness.cjs");

(async () => {
  const geo = await h.loadModule("src/lib/nativePresentationGeometry.ts");

  const safe = { top: 59, bottom: 34 };
  const good = { top: 200, left: 0, width: 393, height: 500 };

  // ---------------------------------------------------------------- acceptance

  await h.test("accepts a healthy region", () => {
    h.assertEqual(geo.presentRegionRejection(good), null);
  });

  await h.test("builds the payload from a healthy region", () => {
    const g = geo.buildPresentationGeometry(good, safe);
    h.assert(g !== null, "expected a payload");
    h.assertEqual(g.top, 200);
    h.assertEqual(g.left, 0);
    h.assertEqual(g.width, 393);
    h.assertEqual(g.height, 500);
    h.assertDeepEqual(g.safeArea, safe);
  });

  // --------------------------------------------------------------- null input

  await h.test("rejects null rect with a reason", () => {
    h.assertEqual(geo.presentRegionRejection(null), "no-element");
  });

  await h.test("rejects undefined rect with a reason", () => {
    h.assertEqual(geo.presentRegionRejection(undefined), "no-element");
  });

  await h.test("null rect yields no payload", () => {
    h.assertEqual(geo.buildPresentationGeometry(null, safe), null);
  });

  // --------------------------------------------------------------- zero sizes

  /*
   * A hidden or unlaid-out element reports zeros. That is "not ready yet", and
   * the caller retries; it is not "no space", which would be a layout bug.
   */
  await h.test("rejects zero width", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, width: 0 }), "zero-width");
  });

  await h.test("rejects zero height", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, height: 0 }), "zero-height");
  });

  await h.test("rejects negative width", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, width: -10 }), "zero-width");
  });

  // ------------------------------------------------------------- non-finite

  /*
   * NaN is the dangerous one: every comparison against NaN is false, so a NaN
   * height would sail past a naive `height < MIN` check and produce a NaN frame
   * that UIKit renders as either zero-size or undefined behaviour.
   */
  await h.test("rejects NaN height rather than letting it through", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, height: NaN }), "not-finite");
  });

  await h.test("rejects Infinity width", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, width: Infinity }), "not-finite");
  });

  await h.test("rejects NaN top", () => {
    h.assertEqual(geo.presentRegionRejection({ ...good, top: NaN }), "not-finite");
  });

  // ------------------------------------------------------------- scrolled out

  await h.test("rejects a region scrolled entirely above the viewport", () => {
    h.assertEqual(
      geo.presentRegionRejection({ top: -600, left: 0, width: 393, height: 500 }),
      "scrolled-out"
    );
  });

  await h.test("accepts a region partly scrolled above the viewport", () => {
    // Still visible, just clipped at the top. Worth presenting into.
    h.assertEqual(geo.presentRegionRejection({ ...good, top: -100 }), null);
  });

  // ---------------------------------------------------------------- too small

  await h.test("rejects a region shorter than the minimum", () => {
    h.assertEqual(
      geo.presentRegionRejection({ ...good, height: geo.MIN_PRESENTABLE_HEIGHT - 1 }),
      "too-small"
    );
  });

  await h.test("accepts a region exactly at the minimum", () => {
    h.assertEqual(
      geo.presentRegionRejection({ ...good, height: geo.MIN_PRESENTABLE_HEIGHT }),
      null
    );
  });

  // ----------------------------------------------------------------- rounding

  /*
   * Fractional frames produce a half-pixel seam between the web chrome and the
   * native view. Rounding is the fix, and it must not round the width and the
   * left independently into an overlapping frame -- hence rounding each field
   * on its own, which is what this checks.
   */
  await h.test("rounds fractional geometry to whole points", () => {
    const g = geo.roundGeometry({
      top: 200.4,
      left: 0.6,
      width: 392.5,
      height: 499.4,
      safeArea: { top: 58.7, bottom: 33.6 },
    });
    h.assertEqual(g.top, 200);
    h.assertEqual(g.left, 1);
    h.assertEqual(g.width, 393);
    h.assertEqual(g.height, 499);
    h.assertEqual(g.safeArea.top, 59);
    h.assertEqual(g.safeArea.bottom, 34);
  });

  await h.test("roundGeometry leaves integers untouched", () => {
    const g = geo.roundGeometry({ ...good, safeArea: safe });
    h.assertEqual(g.top, 200);
    h.assertEqual(g.height, 500);
    h.assertEqual(g.safeArea.top, 59);
  });

  /*
   * Guard the units contract. If someone "fixes" this by multiplying by
   * devicePixelRatio, the frame is correct on a 1x display and 3x too large on
   * the phone this ships to. The comment in the module says so; this asserts it.
   */
  await h.test("geometry is in points, not device pixels", () => {
    const g = geo.roundGeometry({ ...good, safeArea: safe });
    // Unscaled: the values in are the values out. A 3x conversion would
    // produce 1500 here.
    h.assertEqual(g.height, 500);
    h.assert(g.height !== 1500, "height appears to have been scaled by DPR");
  });

  h.summary();
})();
