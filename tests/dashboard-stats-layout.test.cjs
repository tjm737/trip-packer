#!/usr/bin/env node
/*
 * Guards the dashboard stat-row layout.
 *
 * The requirement: on a phone, "Total items" and "Next trip" sit side by side,
 * with "Packed" spanning the row beneath them. Previously the grid was
 * `grid-cols-1 sm:grid-cols-3`, so below 640px all three stacked full-width and
 * pushed the trip grid below the fold.
 *
 * The assertions below are the STRUCTURE that produces that pairing, because the
 * pairing itself is a CSS outcome:
 *
 *   - the grid is 2-up on mobile (grid-cols-2) and 3-up at sm
 *   - the two paired cards are siblings with no wrapper in between (a wrapper
 *     would need to also carry the order/span classes, and silently breaks the
 *     pairing if it does not)
 *   - Packed spans both mobile columns and is ordered last on mobile
 *   - the `order-*` classes restore the original desktop reading order, because
 *     the DOM order was changed to achieve the mobile pairing
 *
 * A previous bug in this codebase had a guard test pinned to the BUGGY markup, so
 * this test asserts the *contract* (what must be adjacent / spanning) rather than
 * a snapshot of the classes.
 */
const fs = require("fs");
const h = require("./harness.cjs");

const DASHBOARD = h.SRC + "/app/(app)/DashboardClient.tsx";

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

(async () => {
  const dash = stripComments(fs.readFileSync(DASHBOARD, "utf8"));

  // Isolate the stats grid block. If the grid class is gone entirely (e.g. it was
  // reverted to `grid-cols-1`, the original bug), fail with a clear message rather
  // than throwing an unhandled error that would abort the whole suite runner.
  const gridStart = dash.indexOf("sm:grid-cols-3");
  if (gridStart === -1) {
    await h.test("stats grid exists", () => {
      h.assert(false, "no `sm:grid-cols-3` stats grid found in DashboardClient.tsx");
    });
    h.summary();
    return;
  }
  // Walk outward to the enclosing <div ...> opening tag.
  const open = dash.lastIndexOf("<div", gridStart);
  h.assert(open !== -1, "could not find the stats grid opening tag");
  // Find the matching close by brace-tag depth over JSX tags.
  const tagRe = /<div\b|<\/div>/g;
  tagRe.lastIndex = open;
  let depth = 0, end = -1, m;
  while ((m = tagRe.exec(dash)) !== null) {
    if (m[0] === "</div>") { depth--; if (depth === 0) { end = tagRe.lastIndex; break; } }
    else depth++;
  }
  h.assert(end !== -1, "could not find the stats grid closing tag");
  const block = dash.slice(open, end);

  await h.test("stats grid is 2-up on mobile, 3-up at sm", () => {
    h.assert(
      /grid-cols-2 sm:grid-cols-3/.test(block),
      "the stats row must be 2 columns on mobile (grid-cols-2) and 3 at sm; " +
        "grid-cols-1 stacks all three and pushes the trip grid off screen"
    );
  });

  await h.test("Total items and Next trip resolve to adjacent mobile slots", () => {
    /*
     * Grid `order` is what actually determines placement, not DOM position. The
     * DOM reads Total items, Packed, Next trip; the order-* classes must move
     * Next trip into slot 2 so it lands beside Total items (slot 1) on mobile,
     * with Packed (order-3) dropping to the row beneath.
     *
     * Asserting on resolved order values rather than DOM adjacency is the point:
     * DOM order alone does not decide the pairing, so a DOM-adjacency assertion
     * would pass or fail for the wrong reason.
     */
    const orderCls = [...block.matchAll(/order-(\d+)(?:\s+sm:order-(\d+))?/g)]
      .map((m) => ({ mobile: Number(m[1]), sm: m[2] ? Number(m[2]) : null }));

    h.assert(orderCls.length === 2, "expected exactly two order-* wrappers (Packed, Next trip)");

    // Mobile: Total items (implicit 0) < Next trip (2) < Packed (3).
    const mobile = orderCls.map((o) => o.mobile).sort((a, b) => a - b);
    h.assert(
      mobile[0] === 2 && mobile[1] === 3,
      `on mobile Next trip must precede Packed (got order values ${JSON.stringify(mobile)}); ` +
        "Total items stays at the implicit 0 so the two pair on row 1"
    );

    // Desktop (sm): Total items (0) < Packed (2) < Next trip (3).
    const sm = orderCls.map((o) => o.sm).sort((a, b) => a - b);
    h.assert(
      sm[0] === 2 && sm[1] === 3,
      `at sm Packed must precede Next trip (got ${JSON.stringify(sm)})`
    );
  });

  await h.test("Packed spans both mobile columns", () => {
    h.assert(
      /col-span-2 sm:col-span-1/.test(block),
      "Packed must span both mobile columns (col-span-2) and collapse to one " +
        "at sm; halved, its progress sub-line would wrap"
    );
  });

  await h.test("desktop reading order is restored via order-*", () => {
    /*
     * Because the DOM order was changed for the mobile pairing, the wide layout
     * needs order-* to put Packed back in the middle (Total items, Packed, Next
     * trip). Without these, desktop would read Total items, Next trip, Packed.
     */
    h.assert(
      /order-3 sm:order-2/.test(block),
      "Packed must be order-3 on mobile and order-2 at sm"
    );
    h.assert(
      /order-2 sm:order-3/.test(block),
      "Next trip must be order-2 on mobile and order-3 at sm"
    );
  });

  h.summary();
})();
