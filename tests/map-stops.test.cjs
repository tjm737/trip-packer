/*
 * Tests for the map's stop filtering, with the draft default pinned.
 *
 * The default is the point of this file. "Do not include draft itinerary items
 * on the map" is one boolean, and nothing else in the app breaks when it flips:
 * the map just draws more pins. A regression is therefore silent, which is
 * exactly the kind that needs a test rather than a comment.
 */

const h = require("./harness.cjs");

const { DRAFTS_HIDDEN_BY_DEFAULT, filterStops } = h.loadModule("src/lib/mapStops.ts");

/// Minimal stop shape. `index` is carried so the renumbering can be asserted.
const stop = (type, confirmed, index = 0) => ({ id: `${type}-${index}`, type, confirmed, index });

(async () => {
  await h.test("drafts are hidden by default", async () => {
    // The product decision. If this flips, the map silently gains pins.
    h.assertEqual(DRAFTS_HIDDEN_BY_DEFAULT, true);
  });

  await h.test("default behaviour excludes unconfirmed stops", async () => {
    const stops = [
      stop("flight", true, 1),
      stop("dining", false, 2),
      stop("hotel", true, 3),
    ];
    const visible = filterStops(stops, new Set(), DRAFTS_HIDDEN_BY_DEFAULT);
    h.assertEqual(visible.length, 2);
    h.assertEqual(visible.map((s) => s.type), ["flight", "hotel"]);
  });

  await h.test("drafts can still be shown on request", async () => {
    // The default must not remove the capability, only the starting state.
    const stops = [stop("flight", true, 1), stop("dining", false, 2)];
    const visible = filterStops(stops, new Set(), false);
    h.assertEqual(visible.length, 2);
  });

  await h.test("visible stops are renumbered from 1", async () => {
    // The pin labelled 2 is the second stop on screen, not the second stop of
    // the trip; otherwise hiding one leaves a gap in the numbering.
    const stops = [
      stop("flight", true, 1),
      stop("dining", false, 2),
      stop("hotel", true, 3),
    ];
    const visible = filterStops(stops, new Set(), true);
    h.assertEqual(visible.map((s) => s.index), [1, 2]);
  });

  await h.test("identity is preserved when nothing is filtered", async () => {
    // Feeds a useMemo: a fresh array every call would invalidate every
    // downstream memo and re-render the map on each parent render.
    const stops = [stop("flight", true, 1), stop("hotel", true, 2)];
    const visible = filterStops(stops, new Set(), true);
    h.assert(visible === stops, "expected the same array instance");
  });

  await h.test("the type filter and the draft filter compose", async () => {
    const stops = [
      stop("flight", true, 1),
      stop("dining", false, 2),
      stop("dining", true, 3),
    ];
    const visible = filterStops(stops, new Set(["dining"]), true);
    h.assertEqual(visible.map((s) => s.type), ["flight"]);
  });

  await h.test("all drafts hidden yields an empty list", async () => {
    const stops = [stop("dining", false, 1), stop("activity", false, 2)];
    h.assertEqual(filterStops(stops, new Set(), true).length, 0);
  });

  await h.summary();
})();
