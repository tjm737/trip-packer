/*
 * Tests for the note-URL link button (noteUrl / noteLinkLabel).
 *
 * These helpers were written for the owner's itinerary and are now reused on the
 * SHARED (unauthenticated) itinerary. That makes one property much more
 * important than it was: the notes text comes from an imported file the owner did
 * not write by hand, and it is rendered as a clickable href on a page whose whole
 * purpose is to be handed to other people. A `javascript:` URL that made it into
 * an href would be a real XSS vector, so the scheme allow-list is pinned here.
 */

const h = require("./harness.cjs");

const { noteUrl, noteLinkLabel } = h.loadModule("src/components/TripReservations.tsx");

async function run() {
  /* -- what counts as a link --------------------------------------------- */

  await h.test("a plain https URL is found", () => {
    h.assertEqual(noteUrl("Booked at https://www.airbnb.com/rooms/123"), "https://www.airbnb.com/rooms/123");
  });

  await h.test("a http URL is found", () => {
    h.assertEqual(noteUrl("see http://example.com/x"), "http://example.com/x");
  });

  await h.test("a URL with no scheme is NOT a link", () => {
    // Bare domains are ambiguous ("email john.co"), so they stay plain text.
    h.assertEqual(noteUrl("arrive 8.30am, email john.co"), "");
    h.assertEqual(noteUrl("www.airbnb.com/rooms/1"), "");
  });

  await h.test("plain notes produce no link", () => {
    h.assertEqual(noteUrl("Check in after 3pm"), "");
    h.assertEqual(noteUrl(""), "");
  });

  /* -- the XSS-relevant cases -------------------------------------------- */

  await h.test("javascript: and data: URLs are refused", () => {
    // The whole reason the regex is http(s)-only rather than "anything with ://".
    h.assertEqual(noteUrl("javascript:alert(1)"), "");
    h.assertEqual(noteUrl("data:text/html,<script>alert(1)</script>"), "");
    h.assertEqual(noteUrl("click javascript:void(0)"), "");
  });

  await h.test("a javascript: URL is not smuggled in after a real one", () => {
    // First match wins, and it must be the http one.
    const got = noteUrl("see https://ok.example.com then javascript:alert(1)");
    h.assertEqual(got, "https://ok.example.com");
  });

  await h.test("whatever is returned always begins with http(s)", () => {
    /*
     * The property that actually keeps this safe on a shared page: every value
     * that reaches an href is http:// or https://. An http URL *inside* a
     * javascript: string is extracted (the regex cannot know better) and that is
     * fine — the href is still a plain http URL, not script.
     */
    const hostile = [
      "javascript:window.location='http://evil.example.com'",
      "data:text/html,<script>fetch('http://evil.example.com')</script>",
      "javascript:alert('https://evil.example.com')",
    ];
    for (const input of hostile) {
      const got = noteUrl(input);
      if (got !== "") {
        h.assertEqual(
          got.startsWith("http://") || got.startsWith("https://"),
          true,
          `returned value must be http(s), got ${got}`
        );
      }
    }
  });

  /* -- trailing punctuation ---------------------------------------------- */

  await h.test("a trailing full stop is not part of the URL", () => {
    h.assertEqual(noteUrl("see https://x.com/a."), "https://x.com/a");
  });

  await h.test("trailing commas, semicolons and colons are trimmed", () => {
    h.assertEqual(noteUrl("https://x.com/a,"), "https://x.com/a");
    h.assertEqual(noteUrl("https://x.com/a;"), "https://x.com/a");
    h.assertEqual(noteUrl("https://x.com/a:"), "https://x.com/a");
  });

  await h.test("a URL ending in a close paren keeps it when balanced", () => {
    // Wikipedia-style URLs legitimately end in ")".
    h.assertEqual(
      noteUrl("https://en.wikipedia.org/wiki/Foo_(bar)"),
      "https://en.wikipedia.org/wiki/Foo_(bar)"
    );
  });

  await h.test("an extra closing paren from the sentence is trimmed", () => {
    h.assertEqual(
      noteUrl("(see https://en.wikipedia.org/wiki/Foo_(bar))"),
      "https://en.wikipedia.org/wiki/Foo_(bar)"
    );
  });

  /* -- the label ---------------------------------------------------------- */

  await h.test("a known brand gets its proper name", () => {
    h.assertEqual(noteLinkLabel("https://www.airbnb.com/rooms/1", "Cozy loft"), "Airbnb");
    h.assertEqual(noteLinkLabel("https://www.booking.com/hotel/x", "Hotel X"), "Booking.com");
  });

  await h.test("the booking title wins over an unrecognised host", () => {
    // The comment in the source says identical captions were a real failure:
    // three buttons all reading the host name told the user nothing.
    h.assertEqual(
      noteLinkLabel("https://guide.michelin.com/x", "Noma"),
      "Noma",
      "the title disambiguates"
    );
  });

  await h.test("a bare host falls back to a title-cased fragment", () => {
    h.assertEqual(noteLinkLabel("https://tickets.example.co.uk/a", ""), "Example");
    h.assertEqual(noteLinkLabel("https://wurzer-alm.at/x", ""), "Wurzer-alm");
  });

  await h.test("malformed input degrades to a label instead of throwing", () => {
    /*
     * This runs during render on the public share page, so a throw is a blank
     * page for a legitimate viewer. A string that is not parseable as a URL hits
     * the catch and yields "Link" — the fallback, not the title, because a
     * non-URL never reaches the title branch. That is acceptable: a button
     * captioned "Link" is still usable, and the alternative is a crash.
     */
    h.assertEqual(noteLinkLabel("not a url at all", "Title"), "Link");
    h.assertEqual(noteLinkLabel("", ""), "");
    h.assertEqual(noteLinkLabel(null, ""), "");
    // A parseable URL with a usable title does use the title.
    h.assertEqual(noteLinkLabel("https://unknown-host.example/x", "Title"), "Title");
  });
}

(async function main() {
  await run();
  h.summary();
})();
