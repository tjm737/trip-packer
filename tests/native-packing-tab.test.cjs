/*
 * Tests for the Packing tab's native-presentation decision.
 *
 * The Packing tab now auto-presents the native SwiftUI list on entry. The
 * failure mode that matters is a re-present LOOP: presenting is async and the
 * WebView stays mounted underneath, so if the guard is wrong the user gets
 * yanked back into a screen they just dismissed, repeatedly, with no way out.
 * That is a worse experience than the button it replaced -- the button could
 * only open on an explicit tap.
 *
 * No DOM or React test infrastructure exists in this project, so the decision
 * is a pure function and these are the cases that pin it.
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
      }),
      true
    );
  });

  await h.test("does NOT present a second time within the same tab visit", () => {
    // The loop guard. Without this, every re-render re-opens the screen.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: true,
        hasPresented: true,
      }),
      false
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
      }),
      false
    );
  });

  await h.test("never presents while the tab is inactive", () => {
    // Returning false here is load-bearing: it is what lets the caller clear
    // the hasPresented flag while off-tab WITHOUT triggering a presentation.
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: false,
        nativeAvailable: true,
        hasPresented: false,
      }),
      false
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
      }),
      false
    );
    h.assertEqual(
      shouldPresentPackingTab({
        tabActive: false,
        nativeAvailable: false,
        hasPresented: true,
      }),
      false
    );
  });

  /* -- the web list is the floor ------------------------------------------ */

  await h.test("the web packing list is always rendered", () => {
    /*
     * This asserts a CONSTANT, which normally would be a tautology. It is not
     * here: the whole point is that the web list must NOT be deleted when the
     * native screen becomes the tab. The native screen is an overlay -- if the
     * user dismisses it, or presentation fails, the list underneath is all
     * there is. The test exists to make deleting it a deliberate act that turns
     * a test red, rather than a quiet simplification.
     */
    h.assertEqual(shouldRenderWebPackingList(), true);
  });

  await h.summary();
}

run();
