/*
 * Tests for activeTripIdFromPath.
 *
 * This function decides whether the sidebar draws the Print and Calendar
 * buttons, and which trip they point at. A wrong answer is not cosmetic: it
 * either links to a 404 (/api/trips//calendar.ics) or draws a plausible-looking
 * control that hits the wrong trip. Both are the kind of bug that only shows up
 * in front of a user, so the edges are pinned here instead.
 */

const h = require("./harness.cjs");

const { activeTripIdFromPath } = h.loadModule("src/lib/activeTrip.ts");

async function run() {
  // --- the shapes that must resolve to a id ------------------------------

  await h.test("plain trip route", () => {
    h.assertEqual(activeTripIdFromPath("/trips/abc123"), "abc123");
  });

  await h.test("print preview still belongs to its trip", () => {
    // The print page renders inside the same shell, so the sidebar is drawn
    // there too. It must keep pointing at the trip it is printing.
    h.assertEqual(activeTripIdFromPath("/trips/abc123/print"), "abc123");
  });

  await h.test("a sub-route resolves to its parent trip, not the sub-page", () => {
    // Deliberately permissive: any future /trips/<id>/<tab> works with no
    // change here, because the id is always segment 1.
    h.assertEqual(activeTripIdFromPath("/trips/abc123/map"), "abc123");
    h.assertEqual(activeTripIdFromPath("/trips/abc123/anything/else"), "abc123");
  });

  await h.test("a trailing slash is not part of the id", () => {
    h.assertEqual(activeTripIdFromPath("/trips/abc123/"), "abc123");
  });

  // --- the shapes that must NOT resolve ---------------------------------

  await h.test("the trips list is not a trip", () => {
    h.assertEqual(activeTripIdFromPath("/trips"), null);
    h.assertEqual(activeTripIdFromPath("/trips/"), null);
  });

  await h.test("an empty id segment must not become a link", () => {
    // Guards the /api/trips//calendar.ics 404. "[].filter(len>0)" collapses the
    // double slash, so this reaches the length check and returns null.
    h.assertEqual(activeTripIdFromPath("/trips//print"), null);
    h.assertEqual(activeTripIdFromPath("//trips//"), null);
  });

  await h.test("non-trip routes", () => {
    h.assertEqual(activeTripIdFromPath("/"), null);
    h.assertEqual(activeTripIdFromPath("/profile"), null);
    h.assertEqual(activeTripIdFromPath("/login"), null);
    h.assertEqual(activeTripIdFromPath(""), null);
  });

  await h.test("a nested route merely containing 'trips' is not a trip route", () => {
    // Only segment 0 counts. /settings/trips/<id> is a different location and
    // must not resolve, or the section would appear somewhere it has no place.
    h.assertEqual(activeTripIdFromPath("/settings/trips/abc123"), null);
  });

  await h.test("share links are excluded even though they show a trip", () => {
    // A share token is not a trip id and the API is keyed by id, so there is
    // nothing honest to link to. The share page has its own export controls.
    h.assertEqual(activeTripIdFromPath("/share/sometoken"), null);
  });

  await h.test("null and undefined are tolerated", () => {
    // usePathname can be null before the router resolves.
    h.assertEqual(activeTripIdFromPath(null), null);
    h.assertEqual(activeTripIdFromPath(undefined), null);
  });

  // --- encoding and impurity --------------------------------------------

  await h.test("a percent-encoded id is decoded to match the raw id", () => {
    // The rest of the app keys trips by their raw id, so a link built from the
    // encoded form must compare and fetch as the same trip.
    h.assertEqual(activeTripIdFromPath("/trips/a%20b"), "a b");
    h.assertEqual(activeTripIdFromPath("/trips/abc%2F123"), "abc/123");
  });

  await h.test("a malformed escape sequence yields null, not a throw", () => {
    // decodeURIComponent throws on a lone "%". A route we cannot parse is a
    // route we cannot build links for, and crashing the sidebar over it would
    // take the whole shell down.
    h.assertEqual(activeTripIdFromPath("/trips/%"), null);
    h.assertEqual(activeTripIdFromPath("/trips/%E0%A4%A"), null);
  });

  await h.test("query strings and hashes are stripped defensively", () => {
    h.assertEqual(activeTripIdFromPath("/trips/abc123?tab=map"), "abc123");
    h.assertEqual(activeTripIdFromPath("/trips/abc123#packing"), "abc123");
  });

  h.summary();
}

(async () => {
  await run();
})();
