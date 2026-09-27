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
      drawer.includes('el.closest("button")'),
      "MobileSidebar no longer closes on button taps"
    );
  });

  await h.summary();
}

run();
