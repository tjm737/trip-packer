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
  shouldPresentNativeTab,
  shouldRenderWebTabContent,
  shouldShowNativeFallbackButton,
  shouldSendFrame,
  sameFrame,
} = h.loadModule("src/lib/nativeTabPresentation.ts");

async function run() {
  /* -- the happy path ------------------------------------------------------ */

  await h.test("presents on first entry into the Packing tab on iOS", () => {
    h.assertEqual(
      shouldPresentNativeTab({
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
      shouldPresentNativeTab({
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
      shouldPresentNativeTab({
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
      shouldPresentNativeTab({
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
      shouldPresentNativeTab({
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
      shouldPresentNativeTab({
        tabActive: false,
        nativeAvailable: false,
        hasPresented: false,
        presenting: false,
      }),
      "none"
    );
    h.assertEqual(
      shouldPresentNativeTab({
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
      shouldRenderWebTabContent({ nativeAvailable: false, nativeOnScreen: false }),
      true
    );
    // And nativeOnScreen true with native unavailable is incoherent, but must
    // not hide the list either -- there is no native screen to hide it for.
    h.assertEqual(
      shouldRenderWebTabContent({ nativeAvailable: false, nativeOnScreen: true }),
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
      shouldRenderWebTabContent({ nativeAvailable: true, nativeOnScreen: false }),
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
      shouldRenderWebTabContent({ nativeAvailable: true, nativeOnScreen: true }),
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
      shouldRenderWebTabContent({ nativeAvailable: true, nativeOnScreen: false }),
      true
    );
  });

  /* -- the stray "Open native list" button --------------------------------- */

  /*
   * The reported bug: "when I close the packing list, I see the open native list
   * button".
   *
   * The button rendered unconditionally whenever the platform was iOS. So the
   * ordinary path -- enter the tab, native list opens, close it, fall back to the
   * web list -- ended with a button offering to open the screen that had just been
   * closed. Nothing was actually broken; it just read as broken, which is worse,
   * because there is no error to point at.
   *
   * On iOS the native list IS the packing screen and it opens itself. A control
   * for opening it is redundant by definition, so its absence is the correct
   * default and these cases pin that.
   */

  await h.test("does NOT show the button in the normal iOS flow", () => {
    /*
     * The regression test for the reported bug. State: iOS, presentation
     * succeeded, user dismissed the native list, web list is now showing. The
     * button must be gone.
     *
     * If this ever returns true, the stray button is back and so is the
     * complaint.
     */
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: true,
        presentFailed: false,
        tabEmpty: false,
      }),
      false
    );
  });

  await h.test("does NOT show the button just because the platform is iOS", () => {
    // The exact shape of the old bug: platform capability treated as a reason to
    // render. Capability is a precondition, never a justification.
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: true,
        presentFailed: false,
        tabEmpty: false,
      }),
      false
    );
  });

  await h.test("shows the button when the automatic presentation failed", () => {
    /*
     * The case the control legitimately exists for. The user tapped the Packing
     * tab expecting the native list; it threw. Without a way to retry, the tab is
     * a dead end.
     */
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: true,
        presentFailed: true,
        tabEmpty: false,
      }),
      true
    );
  });

  await h.test("shows the button when the tab would otherwise be empty", () => {
    // Belt-and-braces: even without a thrown error, a tab with no web list behind
    // it needs some way forward.
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: true,
        presentFailed: false,
        tabEmpty: true,
      }),
      true
    );
  });

  await h.test("NEVER shows the button on web or Android", () => {
    /*
     * There is no native screen to open on these platforms, so the button would
     * be a lie -- it would throw if tapped. `nativeAvailable` is checked first
     * precisely so the other two flags cannot conjure a button that cannot work.
     */
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: false,
        presentFailed: true,
        tabEmpty: true,
      }),
      false
    );
    h.assertEqual(
      shouldShowNativeFallbackButton({
        nativeAvailable: false,
        presentFailed: false,
        tabEmpty: false,
      }),
      false
    );
  });

  /* -- frame forwarding into the embedded region --------------------------- */

  /*
   * Embedded native content is a child view with an explicit frame, so it does
   * NOT follow the page. As the page scrolls, rotates or the keyboard opens, the
   * region moves and only a new frame from JS moves the view with it. The
   * failure these cases pin is invisible in a type check: the native content
   * stays where it was first placed while the page slides underneath.
   */

  await h.test("sends a new frame while the native screen is up", () => {
    h.assertEqual(
      shouldSendFrame({ presenting: true, hasFrame: true, sameAsLastSent: false }),
      true
    );
  });

  await h.test("does not send a frame when nothing is on screen", () => {
    /*
     * Before the present there is no child view to move. Sending here is a no-op
     * the plugin answers `applied: false` to, and this effect runs on every
     * scroll -- so it is worth not calling at all.
     */
    h.assertEqual(
      shouldSendFrame({ presenting: false, hasFrame: true, sameAsLastSent: false }),
      false
    );
  });

  await h.test("does not send a frame when nothing has been measured", () => {
    h.assertEqual(
      shouldSendFrame({ presenting: true, hasFrame: false, sameAsLastSent: false }),
      false
    );
  });

  await h.test("does not re-send the frame the present already carried", () => {
    /*
     * The present call was given this frame, so the view is already there. A
     * re-send can arrive before the child controller exists and resolve
     * `applied: false` under a view that is visibly on screen -- which reads as a
     * failure that did not happen.
     */
    h.assertEqual(
      shouldSendFrame({ presenting: true, hasFrame: true, sameAsLastSent: true }),
      false
    );
  });

  await h.test("compares frames by value, not identity", () => {
    /*
     * `measurePresentationFrame` returns a FRESH object per measurement, so an
     * unchanged region arrives as a different object every scroll event. An
     * identity check would therefore send a bridge call per scroll frame for a
     * region that never moved.
     */
    const a = { top: 200, left: 0, width: 393, height: 500 };
    const b = { top: 200, left: 0, width: 393, height: 500 };
    h.assert(a !== b, "the two frames must be distinct objects");
    h.assertEqual(sameFrame(a, b), true);
  });

  await h.test("treats a moved frame as different", () => {
    const a = { top: 200, left: 0, width: 393, height: 500 };
    const moved = { top: 180, left: 0, width: 393, height: 520 };
    h.assertEqual(sameFrame(a, moved), false);
  });

  await h.test("treats a frame that only changed on one edge as different", () => {
    // Each edge is compared, so a change in any single field must count. This
    // catches a comparison that drops one field -- e.g. forgetting height, which
    // is the one that moves when the keyboard opens.
    const a = { top: 200, left: 0, width: 393, height: 500 };
    h.assertEqual(sameFrame(a, { top: 200, left: 0, width: 393, height: 320 }), false);
    h.assertEqual(sameFrame(a, { top: 200, left: 0, width: 320, height: 500 }), false);
    h.assertEqual(sameFrame(a, { top: 200, left: 8, width: 393, height: 500 }), false);
    h.assertEqual(sameFrame(a, { top: 199, left: 0, width: 393, height: 500 }), false);
  });

  await h.test("treats two absent frames as equal", () => {
    // Both unmeasured is the same state, and must not read as a change.
    h.assertEqual(sameFrame(null, null), true);
  });

  await h.test("treats an absent frame and a real one as different", () => {
    const a = { top: 200, left: 0, width: 393, height: 500 };
    h.assertEqual(sameFrame(null, a), false);
    h.assertEqual(sameFrame(a, null), false);
  });

  await h.summary();
}

run();
