"use client";

import { useEffect, useState } from "react";

/*
 * Publishes the state of an embedded native screen for the iOS UI test to read.
 *
 * WHY A PROBE AT ALL
 *
 * The bug this exists to catch is "switching tabs left the native screen up over
 * the new tab". That is invisible to every check available here:
 *
 *   - The regression suite is pure functions; it can prove `closeNativeScreen`
 *     is called, not that the native view went away.
 *   - A screenshot cannot see it. The native content is opaque SwiftUI drawn
 *     over the WebView, so a screenshot looks IDENTICAL whether the child
 *     controller was removed or is still sitting on top of the tab.
 *   - XCUITest cannot evaluate JavaScript in a WKWebView, so the test cannot
 *     inspect the DOM or the plugin itself.
 *
 * So the page reports on itself, exactly as `MapProbe` does for Leaflet. The
 * values below are the ones the presentation path actually decided on -- not a
 * re-derivation for the test's benefit, which could agree with itself while the
 * real path misbehaves.
 *
 * WHAT EACH FIELD IS EVIDENCE OF
 *
 *   native=1     the iOS shell was detected at all. If 0, every other field is
 *                meaningless and the test should say so rather than pass.
 *   frame=<...>  the measured region, or none. Proves the geometry handoff
 *                produced something to draw into rather than declining.
 *   presenting=1 a native screen is believed to be on screen. This is the field
 *                that must go back to 0 when the tab is left -- if it stays 1,
 *                the web layer still thinks native owns the tab and the web
 *                content will never come back.
 *   closed=<n>   how many times teardown was requested for this mount. Non-zero
 *                after leaving the tab is the proof that the exit path ran; the
 *                count rather than a boolean because a value that never changes
 *                cannot distinguish "not called" from "not reported".
 *
 * Exposed only in the iOS shell. This is test scaffolding and has no business
 * rendering in a browser, where the pure-function tests already cover the rules.
 */
export type NativePresentationState = {
  /** iOS shell detected (Capacitor present). */
  native: boolean;
  /** The measured region, or null when nothing usable was measured. */
  frameTop: number | null;
  frameHeight: number | null;
  /** Is a native screen believed to be on screen right now? */
  presenting: boolean;
  /** How many times teardown has been requested for this mount. */
  closedCount: number;
  /** Why the present was declined, if it was. Empty when it was not. */
  reason: string;
};

const EMPTY: NativePresentationState = {
  native: false,
  frameTop: null,
  frameHeight: null,
  presenting: false,
  closedCount: 0,
  reason: "",
};

/*
 * Counts teardown requests across the whole session.
 *
 * Module-level, and that is the point. Teardown runs in an unmount cleanup, so
 * anything scoped to the component -- state, or a ref the probe reads -- is gone
 * by the time the close happens, and React discards state updates on an
 * unmounting component outright.
 *
 * The counter therefore outlives whatever incremented it, which is exactly what
 * the test needs: the evidence for "leaving the Itinerary tab closed the native
 * screen" is only observable from a DIFFERENT tab's probe, after the itinerary
 * component is gone. A per-mount value could never be read at that moment.
 *
 * A count rather than a boolean, because a false value cannot distinguish "the
 * close path never ran" from "it ran and nothing survived to report it". This
 * number can only go up.
 */
let globalClosedCount = 0;

/** Record that a teardown was requested. Called from the unmount cleanup. */
export function recordNativeClose() {
  globalClosedCount += 1;
}

/** How many teardowns have been requested. */
export function nativeCloseCount() {
  return globalClosedCount;
}

/** Test hook: reset the counter so a rerun starts from a known value. */
export function resetNativeCloseCount() {
  globalClosedCount = 0;
}

export function NativePresentationProbe({ state }: { state: NativePresentationState }) {
  const [isApp, setIsApp] = useState(false);
  useEffect(() => {
    // Capacitor injects this global; absent in a plain browser.
    setIsApp(typeof window !== "undefined" && "Capacitor" in window);
  }, []);
  if (!isApp) return null;

  /*
   * `closed` is read from the module counter, NOT from `state`.
   *
   * It cannot come through props: the increment happens in an unmount cleanup,
   * so the component that would have passed it has already rendered for the last
   * time. Reading the module value here is what lets the count appear on
   * whichever tab is showing when the test looks.
   */
  const s = { ...EMPTY, ...state, closedCount: nativeCloseCount() };
  const report =
    `NATIVEPROBE native=${s.native ? 1 : 0}` +
    ` top=${s.frameTop === null ? "none" : Math.round(s.frameTop)}` +
    ` height=${s.frameHeight === null ? "none" : Math.round(s.frameHeight)}` +
    ` presenting=${s.presenting ? 1 : 0}` +
    ` closed=${s.closedCount}` +
    ` reason=${s.reason || "none"}`;

  /*
   * Real text rather than an aria-label on an empty node: XCUITest reads static
   * text reliably and empty nodes inconsistently (the same reason MapProbe does
   * this). Invisible to the eye but present in the accessibility tree.
   */
  return (
    <span
      aria-hidden={false}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
        fontSize: 1,
      }}
    >
      {report}
    </span>
  );
}
