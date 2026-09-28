/*
 * Guard: every sidebar section header must opt out of the mobile drawer's
 * tap-to-close.
 *
 * The reported bug: "they collapse but they also close the sidebar when
 * collapsing."
 *
 * MobileSidebar closes the drawer on ANY button tap inside it, unless the
 * tapped element (or an ancestor) carries `data-keep-drawer-open`. That default
 * is right -- tapping a trip should dismiss the drawer so the page behind it is
 * visible, and that is the overwhelmingly common case.
 *
 * The section headers are the exception. They collapse in place. Without the
 * opt-out, tapping one collapses the section AND dismisses the drawer, so the
 * user is thrown out of the sidebar to look at a change they cannot see. The
 * control appears to do nothing.
 *
 * The row buttons inside those sections already carried the attribute; the
 * headers were added later without it, which is exactly how a rule like this
 * decays -- it is applied per-control, and nothing was checking the whole set.
 *
 * So this test does not check behaviour (there is no DOM harness) -- it checks
 * the invariant structurally: every call to toggleSectionKey in the sidebar
 * must be accompanied by the opt-out. A fifth section added without it fails
 * here rather than in the user's hands.
 */

const h = require("./harness.cjs");
const fs = require("fs");
const path = require("path");

const SIDEBAR = path.join(__dirname, "..", "src", "components", "SidebarContent.tsx");

/** Find each `toggleSectionKey("x")` call and the JSX attributes that follow it. */
function sectionHeaderSites(source) {
  const sites = [];
  const re = /toggleSectionKey\(\s*"([a-z]+)"\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    // The attributes for this element run from the call to the closing `>` of
    // the opening tag. 400 chars is comfortably past the className/title lines.
    const window = source.slice(m.index, m.index + 400);
    const tagEnd = window.indexOf(">");
    sites.push({
      key: m[1],
      attrs: tagEnd === -1 ? window : window.slice(0, tagEnd),
    });
  }
  return sites;
}

async function run() {
  const source = fs.readFileSync(SIDEBAR, "utf8");
  const sites = sectionHeaderSites(source);

  await h.test("finds the section headers (guards against a vacuous pass)", () => {
    /*
     * If the call shape is ever refactored, this test must fail loudly rather
     * than let the ones below pass against an empty list and assert nothing.
     */
    h.assert(
      sites.length >= 4,
      `expected >= 4 section header toggles, found ${sites.length}`
    );
  });

  await h.test("every section header opts out of tap-to-close", () => {
    const offenders = sites
      .filter((s) => !s.attrs.includes("data-keep-drawer-open"))
      .map((s) => s.key);
    h.assertEqual(
      offenders,
      [],
      `these section headers close the drawer when collapsed: ${offenders.join(", ")}`
    );
  });

  await h.test("covered keys are the four known sections", () => {
    // Catches a header being replaced by a differently-shaped control that the
    // regex above would no longer match.
    const keys = sites.map((s) => s.key).sort();
    h.assert(
      keys.includes("accounts") &&
        keys.includes("companions") &&
        keys.includes("upcoming") &&
        keys.includes("archived"),
      `missing a section header; found: ${keys.join(", ")}`
    );
  });

  await h.test("the drawer's tap-to-close default is still in place", () => {
    /*
     * The opt-out is only meaningful because MobileSidebar still closes on
     * button taps. If that handler is removed, this whole guard becomes
     * decorative and should be revisited rather than silently kept.
     */
    const drawer = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "MobileSidebar.tsx"),
      "utf8"
    );
    h.assert(
      drawer.includes('el.closest("[data-keep-drawer-open]")'),
      "MobileSidebar no longer honours data-keep-drawer-open"
    );
    h.assert(
      drawer.includes('el.closest("button, a[href]")'),
      "MobileSidebar no longer closes on button/link taps"
    );
  });

  await h.test("tap-to-close covers LINKS, not just buttons", () => {
    /*
     * The bug this catches: the brand logo and the profile row navigate via
     * `<Link>` (an `<a>`), and the handler matched on `button` alone. Tapping
     * the logo changed the route but left the drawer open over the destination
     * — on a phone, indistinguishable from the logo doing nothing.
     *
     * A string match on the old handler would NOT have caught it: the handler
     * was present and correct-looking the whole time, it just did not cover
     * the element type the logo happens to be. So this assertion checks the
     * MATCHER covers anchors.
     *
     * `a[href]` rather than bare `a` is deliberate — an anchor with no href is
     * a JS-only control, not navigation, and should not dismiss the drawer.
     */
    const drawer = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "MobileSidebar.tsx"),
      "utf8"
    );
    const m = drawer.match(/el\.closest\(\s*"([^"]+)"\s*\)\s*\)\s*setOpen\(false\)/);
    h.assert(m !== null, "could not find the drawer's close-on-tap matcher");
    const matcher = m[1];
    h.assert(
      matcher.includes("a[href]"),
      `drawer matcher "${matcher}" does not cover links, so <Link> navigation ` +
        `(the brand logo, the profile row) leaves the drawer open over the page`
    );
  });

  await h.test("the brand logo navigates home imperatively, not via <Link>", () => {
    /*
     * The logo must send the user to "/" from any screen. It is rendered by
     * SidebarBody, which both the desktop aside and the mobile drawer use.
     *
     * This used to assert a <Link>, which is the shape that BROKE on iOS. A
     * <Link> defers navigation to the router's own click handler, while
     * MobileSidebar closes the drawer from the same tap's bubble phase and
     * unmounts the subtree. In WKWebView the unmount could win and the commit
     * was lost, so the tap did nothing. The fix is a synchronous router.push
     * in the anchor's own onClick, which commits before the teardown.
     *
     * So this pins the contract, not the tag: the element must be an anchor
     * with href="/" (middle-click and Cmd-click still work) AND must call
     * router.push("/") itself. A refactor back to <Link> fails here instead of
     * in the user's hands, which is precisely what the old version allowed.
     */
    const source = fs.readFileSync(SIDEBAR, "utf8");
    /*
     * Match from just before the opening tag so `href`/`onClick` (which sit
     * above aria-label in the JSX) are inside the captured block, through to
     * the closing </a>. The comment above the element mentions "<Link>", so
     * anchor on the tag itself rather than the word.
     */
    const start = source.indexOf('aria-label="TripPlanner home"');
    h.assert(start !== -1, "could not find the TripPlanner home anchor");
    const tagStart = source.lastIndexOf("<a", start);
    h.assert(tagStart !== -1, "the TripPlanner home element is not an anchor");
    const end = source.indexOf("</a>", start);
    h.assert(end !== -1, "could not find the TripPlanner home anchor's close tag");
    const block = source.slice(tagStart, end + 4);
    h.assert(
      /href="\/"/.test(block),
      "the brand logo does not link to /"
    );
    h.assert(
      /router\.push\("\/"\)/.test(block),
      "the brand logo does not navigate imperatively; without router.push it " +
        "defers to <Link>'s handler and loses the race against the drawer " +
        "closing on iOS, which reads on a phone as the logo doing nothing"
    );
    h.assert(
      /e\.metaKey|e\.ctrlKey/.test(block),
      "the brand logo's onClick does not let modified clicks through, so " +
        "Cmd-click / middle-click would be swallowed instead of opening a new tab"
    );
  });

  await h.test("the drawer still unmounts the sidebar body on a link tap", () => {
    /*
     * The imperative navigation above only exists because of this unmount. If
     * the drawer ever stops closing on link taps, the router.push is no longer
     * load-bearing and this guard should be revisited rather than kept as
     * cargo. Asserting the premise keeps the reasoning honest.
     */
    const drawer = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "MobileSidebar.tsx"),
      "utf8"
    );
    h.assert(
      drawer.includes('el.closest("button, a[href]")'),
      "the drawer no longer closes on link taps, so the brand-logo race this " +
        "works around may no longer exist -- re-check before deleting it"
    );
  });

  await h.summary();
}

run();
