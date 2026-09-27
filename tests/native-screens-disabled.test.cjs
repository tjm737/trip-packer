/*
 * Tests for the native-screens kill switch.
 *
 * The SwiftUI screens are disabled (NATIVE_SCREENS_ENABLED = false) because they
 * behaved worse than their JS equivalents: the interaction was unintuitive, and
 * leaving a tab did not reliably tear the native screen down.
 *
 * What these tests protect is the DISABLE ITSELF, which is easy to undo by
 * accident in ways that are invisible until a user hits them:
 *
 *   1. `nativeScreensAvailable()` must be false even on iOS. If somebody
 *      reintroduces a platform check in a component, the app calls the open
 *      function, which throws for a disabled feature, and the component's catch
 *      renders "Native screens are only available in the iOS app" to the user --
 *      an error on every tab open, for a feature that was turned off on purpose.
 *
 *   2. The open functions must still throw rather than silently resolve. A
 *      resolved promise means "a screen is up", so resolving would make callers
 *      hide the web list behind a native screen that was never presented --
 *      leaving a blank tab with no way to pack anything.
 *
 *   3. `closeNativeScreen` / `updateNativeFrame` must NOT throw. They are called
 *      from effect cleanup on unmount, so a rejection becomes an unhandled
 *      promise rejection during an ordinary navigation.
 *
 * No DOM or native bridge exists here, so the module is loaded with a stubbed
 * Capacitor that reports an iOS native platform -- the strongest case. If the
 * feature is off there, it is off everywhere.
 */

const path = require("path");
const Module = require("module");

const h = require("./harness.cjs");

// Stub @capacitor/core BEFORE nativeScreens.ts is loaded, so the module sees an
// iOS native platform. Without this the plugin registry is empty and the test
// would pass for the wrong reason -- it would prove nothing about iOS.
const ORIGINAL_RESOLVE = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@capacitor/core") {
    return path.join(__dirname, "__stub_capacitor_core__.cjs");
  }
  return ORIGINAL_RESOLVE.call(this, request, ...rest);
};

const {
  nativeScreensAvailable,
  openNativePackingList,
  openNativeItinerary,
  closeNativeScreen,
  updateNativeFrame,
} = h.loadModule("src/lib/nativeScreens.ts");

Module._resolveFilename = ORIGINAL_RESOLVE;

async function run() {
  await h.test("native screens are unavailable even on an iOS native platform", () => {
    h.assertEqual(nativeScreensAvailable(), false);
  });

  await h.test("opening the packing list is refused before the plugin is reached", async () => {
    /*
     * Asserts on the MESSAGE, not merely that it rejected.
     *
     * Both paths reject, so "did it throw?" cannot tell enabled from disabled:
     * the web plugin implementation throws "Native screens are only available in
     * the iOS app" too. A test that only checked for a rejection would pass with
     * the feature ON, and so would prove nothing (this was verified by flipping
     * NATIVE_SCREENS_ENABLED and watching it still pass).
     *
     * The kill switch refuses at the availability check, before any plugin call,
     * so its message is the caller's own. That is the observable difference.
     */
    let message = null;
    try {
      await openNativePackingList("trip-1");
    } catch (e) {
      message = e.message;
    }
    h.assert(
      message !== null,
      "expected openNativePackingList to reject while disabled"
    );
    h.assert(
      !/only available in the iOS app/.test(message),
      `expected refusal before the plugin was reached, got: ${message}`
    );
  });

  await h.test("opening the itinerary is refused before the plugin is reached", async () => {
    let message = null;
    try {
      await openNativeItinerary("trip-1");
    } catch (e) {
      message = e.message;
    }
    h.assert(
      message !== null,
      "expected openNativeItinerary to reject while disabled"
    );
    h.assert(
      !/only available in the iOS app/.test(message),
      `expected refusal before the plugin was reached, got: ${message}`
    );
  });

  await h.test("closing is a safe no-op, not a rejection", async () => {
    // Fired from effect cleanup, where a throw is an unhandled rejection.
    const result = await closeNativeScreen();
    h.assertEqual(result, { closed: false });
  });

  await h.test("updating the frame is a safe no-op, not a rejection", async () => {
    const result = await updateNativeFrame({
      top: 0,
      left: 0,
      width: 390,
      height: 700,
      safeArea: { top: 59, bottom: 34 },
    });
    h.assertEqual(result, { applied: false });
  });

  h.summary();
}

run();
