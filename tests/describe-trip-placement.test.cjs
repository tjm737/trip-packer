#!/usr/bin/env node
/*
 * Guards the dashboard placement of the "Describe a trip" entry point.
 *
 * History: it began as a small disabled pill in the page header, beside
 * "New Trip". It was moved to a full-width card BELOW the stat row and ABOVE the
 * trip grid, so that (a) it stops competing with the primary "New Trip" action,
 * and (b) it gets a full-width hit target instead of a ~44px pill.
 *
 * The invariants worth pinning, because each is silently breakable:
 *
 *   1. It is still mobile-only. The extraction runs on Apple's on-device model
 *      via a Capacitor plugin, so on the desktop web build it can never run. A
 *      visible-but-permanently-dead card on desktop is the bug being avoided.
 *   2. It sits AFTER the stats grid and BEFORE the trip grid. The whole point of
 *      "move it down" was the position; an accidental reorder would undo it
 *      while every other test still passed.
 *   3. The header no longer renders a second copy. Two entry points would be a
 *      regression -- the old one is small, disabled, and now redundant.
 *   4. The card variant exists and is the one being used, so the placement test
 *      is testing the intended renderer.
 */
const fs = require("fs");
const h = require("./harness.cjs");

const DASHBOARD = h.SRC + "/app/(app)/DashboardClient.tsx";

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

(async () => {
  const raw = fs.readFileSync(DASHBOARD, "utf8");
  const dash = stripComments(raw);

  await h.test("Describe a trip is rendered in the dashboard body", () => {
    h.assert(
      /<NaturalLanguageTripButton/.test(dash),
      "the dashboard must render <NaturalLanguageTripButton>"
    );
  });

  await h.test("it uses the card variant", () => {
    /*
     * Matches the JSX usage `variant="card"`, not the prop declaration. The
     * declaration lives in the component, not here, so its presence here proves
     * the caller opted in.
     */
    h.assert(
      /variant="card"/.test(dash),
      'the dashboard must pass variant="card" -- otherwise the old compact ' +
        "button renders and the card requirement is unmet"
    );
  });

  await h.test("it sits below the stats row and above the trip grid", () => {
    const statsIdx = dash.indexOf("sm:grid-cols-3");
    const nlIdx = dash.indexOf("<NaturalLanguageTripButton");
    // The trip grid is the one with the md/lg responsive trip columns.
    const tripIdx = dash.indexOf("md:grid-cols-2 lg:grid-cols-3");

    h.assert(statsIdx !== -1, "stats grid not found");
    h.assert(nlIdx !== -1, "natural-language trigger not found");
    h.assert(tripIdx !== -1, "trip grid not found");

    h.assert(
      statsIdx < nlIdx,
      "the describe-a-trip card must come AFTER the stats row"
    );
    h.assert(
      nlIdx < tripIdx,
      "the describe-a-trip card must come BEFORE the trip grid"
    );
  });

  await h.test("it is hidden at sm and up (mobile only)", () => {
    /*
     * Find the wrapper immediately enclosing the trigger and assert it carries
     * `sm:hidden`. Walk back from the trigger to the nearest opening <div> and
     * take its className string.
     */
    const nlIdx = dash.indexOf("<NaturalLanguageTripButton");
    const openIdx = dash.lastIndexOf("<div", nlIdx);
    h.assert(openIdx !== -1, "no wrapper div found around the trigger");

    const openTag = dash.slice(openIdx, dash.indexOf(">", openIdx) + 1);
    h.assert(
      /sm:hidden/.test(openTag),
      "the wrapper must carry `sm:hidden` so the card does not render on " +
        `desktop, where the on-device model is unavailable. Wrapper was: ${openTag}`
    );
  });

  await h.test("the header action row no longer renders its own copy", () => {
    /*
     * Note on scope: DashboardClient wraps the WHOLE dashboard in a single
     * `<header>` element (line ~654) that also contains the stats row and the
     * trip grid. So "not inside <header>" would be wrong -- the new card is
     * legitimately inside it. What must not happen is the trigger reappearing in
     * the header's ACTION ROW, the `flex items-center gap-2` strip that holds
     * Import and New Trip.
     *
     * Count usages first: exactly one, or a second (header) copy has been added.
     */
    const usages = dash.match(/<NaturalLanguageTripButton/g) || [];
    h.assert(
      usages.length === 1,
      `expected exactly one <NaturalLanguageTripButton> usage, found ${usages.length}; ` +
        "a second (header) copy is a regression"
    );

    /*
     * Isolate the action row: it is the div holding the "New Trip" button, and
     * it closes before </header>. Assert the trigger appears after that row
     * closes, i.e. the trigger is not one of the row's children.
     */
    const newTripIdx = dash.indexOf("New Trip");
    h.assert(newTripIdx !== -1, "could not locate the New Trip button");

    // The action row opens at the nearest <div before "New Trip".
    const rowOpen = dash.lastIndexOf("<div", newTripIdx);
    h.assert(rowOpen !== -1, "could not locate the header action row");

    // Find the matching close by tag depth.
    const tagRe = /<div\b|<\/div>/g;
    tagRe.lastIndex = rowOpen;
    let depth = 0, rowEnd = -1, m;
    while ((m = tagRe.exec(dash)) !== null) {
      if (m[0] === "</div>") { depth--; if (depth === 0) { rowEnd = tagRe.lastIndex; break; } }
      else depth++;
    }
    h.assert(rowEnd !== -1, "could not find the end of the header action row");

    const nlIdx = dash.indexOf("<NaturalLanguageTripButton");
    h.assert(
      nlIdx > rowEnd,
      "the describe-a-trip trigger must not be inside the header action row " +
        "(the strip containing Import / New Trip)"
    );
  });

  h.summary();
})();
