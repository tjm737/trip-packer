/*
 * Tests for the Map link on the SHARED itinerary.
 *
 * The shared page now renders a Google Maps button beside each itinerary item's
 * location, matching the owner's view. It reuses mappableLocation() and
 * googleMapsUrl() from TripReservations rather than reimplementing them, so
 * these tests pin two things:
 *
 *   1. The href that reaches a public page is always a plain https Google Maps
 *      URL. The location string is free text that the owner types AND that the
 *      itinerary importer writes, and it is interpolated into a query parameter
 *      on a page shown to third parties — so the scheme and the encoding are
 *      the security-relevant properties, not cosmetics.
 *
 *   2. Which items get a link at all. The interesting cases are the ones the
 *      owner's view already decided ("Reykjavík hotel (not yet booked)" is a
 *      description, not a place) — the two views must agree, or a viewer sees a
 *      Map button the owner never saw, or vice versa.
 *
 * These are the same helpers the owner's itinerary uses, so a change here that
 * breaks these tests breaks that view too. That is intentional.
 */

const h = require("./harness.cjs");

const { mappableLocation, googleMapsUrl, isMappableLocation } = h.loadModule(
  "src/components/TripReservations.tsx"
);

async function run() {
  /* -- the href is always a safe https Maps URL --------------------------- */

  await h.test("the URL is https and points at Google Maps", () => {
    const url = googleMapsUrl("Reykjavík, Iceland");
    h.assertEqual(url.startsWith("https://www.google.com/maps/search/"), true, url);
    h.assertEqual(url.includes("api=1"), true, "uses the documented api=1 form");
  });

  await h.test("the query is percent-encoded, not interpolated raw", () => {
    /*
     * If the query were spliced in unencoded, a location containing "&" would
     * silently add a second parameter and a location containing a quote could
     * break out of the attribute. Encoding is what prevents both.
     */
    const url = googleMapsUrl("A & B");
    h.assertEqual(url.includes("A%20%26%20B"), true, url);
    h.assertEqual(url.includes("A & B"), false, "raw ampersand must not appear");
  });

  await h.test("hostile location text cannot change the scheme or host", () => {
    /*
     * This is the property that matters on a public page. Whatever the stored
     * text is, the value returned begins https://www.google.com/maps/ — the
     * text can only ever land inside the encoded query parameter.
     */
    const hostile = [
      "javascript:alert(1)",
      "https://evil.example.com/",
      "//evil.example.com",
      "data:text/html,<script>alert(1)</script>",
      '" onmouseover="alert(1)',
      "javascript:window.location='http://evil.example.com'",
    ];
    for (const input of hostile) {
      const url = googleMapsUrl(input);
      h.assertEqual(
        url.startsWith("https://www.google.com/maps/search/?api=1&query="),
        true,
        `scheme/host must be fixed, got ${url}`
      );
      /*
       * The payload may appear, but only percent-encoded inside the query — the
       * scheme and host are fixed and no raw delimiter survives. Asserting on
       * the encoded form is the meaningful check; an earlier version of this
       * assertion compared the decoded payload and always passed, which proved
       * nothing.
       */
      h.assertEqual(
        url.split("query=")[1] === encodeURIComponent(input.trim()),
        true,
        `payload must be fully encoded, got ${url}`
      );
    }
  });

  await h.test("whitespace is trimmed before encoding", () => {
    // A leading space would otherwise encode to %20 and shift the query.
    h.assertEqual(googleMapsUrl("  Keflavík  ").endsWith("Keflav%C3%ADk"), true);
  });

  /* -- which items are mappable ------------------------------------------ */

  await h.test("a real address produces a query", () => {
    h.assertEqual(mappableLocation({ location: "Grindavík, Iceland" }), "Grindavík, Iceland");
  });

  await h.test("the location wins over the destination when both exist", () => {
    // A flight has two ends; the origin is where you need directions for.
    const got = mappableLocation({ location: "Philadelphia", locationTo: "Keflavík (KEF)" });
    h.assertEqual(got, "Philadelphia");
  });

  await h.test("locationTo is used when location is unusable", () => {
    // \"near MUC\" is the real case from the source comment: an airport code in
    // prose is not a place, so the arrival end is the better query.
    const got = mappableLocation({ location: "near MUC", locationTo: "Erding" });
    h.assertEqual(got, "Erding");
  });

  await h.test("a descriptive title does NOT become the query", () => {
    /*
     * Straight from the owner's view: this is the exact title in the test trip.
     * \"hotel\" is in DESCRIPTIVE_TITLE, so the title is rejected — but the
     * location is still used, because it is a real place.
     */
    const got = mappableLocation({
      title: "Reykjavík hotel (not yet booked)",
      location: "Reykjavík, Iceland",
    });
    h.assertEqual(got, "Reykjavík, Iceland");
    h.assertEqual(got.includes("not yet booked"), false, "description must not leak into the query");
  });

  await h.test("an item naming no place at all gets no link", () => {
    /*
     * Careful: the code falls back to the title when the title itself is a
     * usable place name, so an item with no location is NOT automatically
     * linkless. "Silfra snorkel tour" is asserted separately below — the title
     * passes isMappableLocation and legitimately becomes the query. These cases
     * are the ones that genuinely have nothing to map.
     */
    h.assertEqual(mappableLocation({}), null);
    h.assertEqual(mappableLocation({ location: "" }), null);
    h.assertEqual(mappableLocation({ title: "TBD" }), null);
    h.assertEqual(mappableLocation({ title: "n/a" }), null);
  });

  await h.test("a title that names a place becomes the query when there is no location", () => {
    // Documented behaviour: the title is the last resort, and only if it looks
    // like a place. This is why the real trip's snorkel tour still gets a link.
    h.assertEqual(mappableLocation({ title: "Silfra snorkel tour" }), "Silfra snorkel tour");
  });

  await h.test("placeholder text is not a destination", () => {
    // These are the values isMappableLocation exists to reject.
    for (const junk of ["TBD", "?", "-", "n/a", "1", "  "]) {
      h.assertEqual(isMappableLocation(junk), false, `${junk} must not be mappable`);
      h.assertEqual(mappableLocation({ location: junk }), null, `${junk} must yield no link`);
    }
  });

  await h.test("a place-naming title is appended to disambiguate", () => {
    // "Erding" alone is ambiguous; with a real venue name it is not.
    const got = mappableLocation({ title: "Therme Erding", location: "Erding" });
    h.assertEqual(got, "Erding, Therme Erding");
  });

  await h.test("a title containing a stay-word is NOT appended", () => {
    /*
     * DESCRIPTIVE_TITLE covers hotel/apartment/guesthouse/etc. "Hotel Arooma"
     * matches on "hotel", so the address is left alone — the address alone is
     * the better query, and the brand name adds noise. This is the case that
     * caught me out: the word "hotel" in the name does not make it a place.
     */
    h.assertEqual(mappableLocation({ title: "Hotel Arooma", location: "Erding" }), "Erding");
    h.assertEqual(
      mappableLocation({ title: "Blue Lagoon Guesthouse", location: "Grindavík, Iceland" }),
      "Grindavík, Iceland"
    );
  });

  await h.test("a flight-number title is not appended", () => {
    // BA936 is not a place, so it must not pollute the query.
    const got = mappableLocation({ title: "BA936", location: "Philadelphia" });
    h.assertEqual(got, "Philadelphia");
  });

  await h.test("a from/to title is not appended", () => {
    // The title names two places at once; appending it makes a worse query.
    const got = mappableLocation({ title: "PHL to Iceland", location: "Philadelphia" });
    h.assertEqual(got, "Philadelphia");
  });

  await h.test("the real test-trip rows all resolve as expected", () => {
    /*
     * Every reservation in the Iceland trip, asserted together. These came from
     * the live DB, so this doubles as a check that the share page shows a Map
     * link on every one of the five items. The queries are not always just the
     * location: a non-descriptive title is appended to disambiguate, which is
     * why the snorkel tour reads "Þingvellir National Park, Silfra snorkel
     * tour". That is the owner's existing behaviour, faithfully reused.
     */
    const rows = [
      { title: "Reykjavík hotel (not yet booked)", location: "Reykjavík, Iceland", expect: "Reykjavík, Iceland" },
      { title: "PHL to Iceland", location: "Philadelphia", locationTo: "Keflavík (KEF)", expect: "Philadelphia" },
      { title: "Silfra snorkel tour", location: "Þingvellir National Park", expect: "Þingvellir National Park, Silfra snorkel tour" },
      { title: "Hertz — 4x4 SUV", location: "Keflavík Airport", expect: "Keflavík Airport, Hertz — 4x4 SUV" },
      { title: "Blue Lagoon Guesthouse", location: "Grindavík, Iceland", expect: "Grindavík, Iceland" },
    ];
    for (const r of rows) {
      h.assertEqual(mappableLocation(r), r.expect, r.title);
    }
  });
}

(async function main() {
  await run();
  h.summary();
})();
