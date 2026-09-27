/*
 * Pins the teardown counter that the iOS UI test reads.
 *
 * WHY THIS IS WORTH A UNIT TEST
 *
 * The UI test's whole assertion rests on this counter being monotonic and
 * observable after the component that increments it has unmounted. Those are
 * properties of the module, not of the UI, and they are exactly the properties
 * that would be quietly broken by a refactor moving the counter into component
 * state -- where React would discard the update during unmount and the UI test
 * would fail with a message about the UI that pointed at the wrong file.
 *
 * The module is `.tsx`, so it is loaded through the harness the same way as any
 * other source file. It imports `react` for the probe component; that is fine
 * here because the counter functions below are evaluated at module scope and do
 * not need a renderer.
 */
const h = require("./harness.cjs");

async function run() {
  await h.test("close count starts at zero", async () => {
    const m = h.loadModule("src/components/NativePresentationProbe.tsx");
    m.resetNativeCloseCount();
    h.assertEqual(m.nativeCloseCount(), 0);
  });

  await h.test("recording a close increments the count", async () => {
    const m = h.loadModule("src/components/NativePresentationProbe.tsx");
    m.resetNativeCloseCount();
    m.recordNativeClose();
    h.assertEqual(m.nativeCloseCount(), 1);
  });

  await h.test("the count is monotonic across repeated closes", async () => {
    const m = h.loadModule("src/components/NativePresentationProbe.tsx");
    m.resetNativeCloseCount();
    m.recordNativeClose();
    m.recordNativeClose();
    m.recordNativeClose();
    h.assertEqual(m.nativeCloseCount(), 3);
  });

  /*
   * The increment and the read must resolve to the SAME counter.
   *
   * This is the property the UI test depends on, and it is a property of
   * MODULE IDENTITY, not of the counter's arithmetic. If the probe and the
   * component that records a close ended up with separate module instances, the
   * increment would go to one counter and the probe would report another --
   * always 0 -- and the UI test could never pass however correct the teardown
   * was.
   *
   * It cannot be asserted through the harness: `loadModule` builds a fresh
   * cache per call (see harness.cjs:88, `parentCache = new Map()`), so two loads
   * are deliberately two instances. Asserting shared state across two loads
   * would be testing the harness, not the app.
   *
   * What actually guarantees identity in the app is the BUNDLE, and that is
   * checked against the built output instead of here: `NATIVEPROBE` and
   * `closedCount` appear in exactly one chunk, so there is one instance of the
   * module and one counter. That check lives in the verification steps rather
   * than in this file because it reads `.next/` and needs a build.
   *
   * What IS asserted here is the shape that makes that identity meaningful: the
   * counter is module state (so a shared instance shares it), and it is
   * monotonic.
   */
  await h.test("a single instance keeps a monotonic count", async () => {
    const m = h.loadModule("src/components/NativePresentationProbe.tsx");
    m.resetNativeCloseCount();
    m.recordNativeClose();
    m.recordNativeClose();
    h.assertEqual(
      m.nativeCloseCount(),
      2,
      "within one module instance the count must accumulate",
    );
  });

  /*
   * Reset exists so a rerun does not inherit the previous run's count. If this
   * silently failed, a second `npm test` would report a number that only looked
   * right because it was carried over.
   */
  await h.test("reset returns the count to zero", async () => {
    const m = h.loadModule("src/components/NativePresentationProbe.tsx");
    m.recordNativeClose();
    m.resetNativeCloseCount();
    h.assertEqual(m.nativeCloseCount(), 0);
  });

  await h.summary();
}

run();
