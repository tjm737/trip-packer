/*
 * Tests for the Packing tab's native-presentation decision and web-list gate.
 *
 * The Packing tab auto-presents the native SwiftUI list on entry, and on iOS
 * that native list IS the packing screen -- the web list is not rendered behind
 * it. Two failures matter:
 *
 *   1. A re-present LOOP. Presenting is async, so an unguarded effect re-opens
 *      the screen on every re-render, yanking the user back into a screen they
 *      just dismissed.
 *
 *   2. A stale web list. The web list is rendered before any native edit and is
 *      never refetched, so showing it after a dismissal lands the user on an
 *      out-of-date copy of what they were just looking at. That was the reported
 *      bug ("interaction is not intuitive, when it closes the user sees the old
 *      web packing list"), and the fix is to not render it while native owns the
 *      tab.
 *
 * No DOM or React test infrastructure exists in this project, so the decisions
 * are pure functions and these are the cases that pin them.
 */

const h = require("./harness.cjs");

const {
  shouldPresentPackingTab,
  shouldRenderWebPackingList,
} = h.loadModule("src/lib/nativePackingTab.ts");

async function run() {
  /* -- the happy path ------------------------------------------------------ */

  await h.test("presents on first entry into the Packing tab on iOS", () => {
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: true,
        hasPresented: false,
        presenting: false,
      }),
      "present"
    );
  });

  await h.test("does NOT present a second time within the same tab visit", () => {
    // The loop guard. Without this, every re-render re-opens the screen.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: true,
        hasPresented: true,
        presenting: false,
      }),
      "wait"
    );
  });

  /*
   * The in-flight case, which is the new state and the subtle one.
   *
   * Between "we called present" and "the native screen is dismissed" the call
   * has not resolved, so `hasPresented` may already be true while `presenting`
   * is still true. Re-presenting here would stack a second sheet. This must
   * return "wait" rather than "none", because the difference decides whether the
   * web list renders behind an open sheet.
   */
  await h.test("does not present again while a presentation is in flight", () => {
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: true,
        hasPresented: false,
        presenting: true,
      }),
      "wait"
    );
  });

  /* -- the platforms where presentation is impossible ---------------------- */

  await h.test("never presents off the iOS app", () => {
    // Web and Android have no native screen; presenting would throw.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: false,
        hasPresented: false,
        presenting: false,
      }),
      "none"
    );
  });

  await h.test("never presents while the tab is inactive", () => {
    // Returning "none" here is load-bearing: it is what lets the caller clear
    // the hasPresented flag while off-tab WITHOUT triggering a presentation.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: false,
        nativeAvailable: true,
        hasPresented: false,
        presenting: false,
      }),
      "none"
    );
  });

  await h.test("the tab check is evaluated before the loop guard", () => {
    // Both guards must hold simultaneously; this pins that neither is skipped
    // by short-circuiting in the wrong order.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: false,
        nativeAvailable: false,
        hasPresented: false,
        presenting: false,
      }),
      "none"
    );
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: false,
        nativeAvailable: false,
        hasPresented: true,
        presenting: true,
      }),
      "none"
    );
  });

  /* -- the web list gate --------------------------------------------------- */

  await h.test("renders the web list on web and Android", () => {
    /*
     * This is the whole feature off iOS. Getting this wrong by returning false
     * when native is unavailable would leave browser users with an empty Packing
     * tab and no native screen to fall back to.
     */
    h.assertEqual(
      shouldRenderWebPackingList({ nativeAvailable: false, nativeOnScreen: false }),
      true
    );
    // And nativeOnScreen true with native unavailable is incoherent, but must
    // not hide the list either -- there is no native screen to hide it for.
    h.assertEqual(
      shouldRenderWebPackingList({ nativeAvailable: false, nativeOnScreen: true }),
      true
    );
  });

  await h.test("renders the web list on iOS before the native screen is asked for", () => {
    /*
     * `nativeOnScreen` starts false, so the first render on iOS shows the list.
     * That is deliberate: the tab must not be blank while the sheet animates up,
     * and if presenting never happens the list is all the user has.
     */
    h.assertEqual(
      shouldRenderWebPackingList({ nativeAvailable: true, nativeOnScreen: false }),
      true
    );
  });

  await h.test("HIDES the web list on iOS while the native screen owns the tab", () => {
    /*
     * The regression this whole change exists for. If this flips back to true,
     * dismissing the native list drops the user onto a stale copy of the packing
     * list -- the exact complaint being fixed.
     */
    h.assertEqual(
      shouldRenderWebPackingList({ nativeAvailable: true, nativeOnScreen: true }),
      false
    );
  });

  await h.test("renders the web list again after the native screen is dismissed", () => {
    /*
     * The other half of the pair above: hiding is not permanent. Once the
     * promise resolves on dismissal, `nativeOnScreen` goes false and the list
     * returns as the fallback for a tab the user re-enters.
     */
    h.assertEqual(
      shouldRenderWebPackingList({ nativeAvailable: true, nativeOnScreen: false }),
      true
    );
  });

  await h.summary();
}

run();
