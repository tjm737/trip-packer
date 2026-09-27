import { Capacitor, registerPlugin } from "@capacitor/core";
import { buildPresentationGeometry, roundGeometry } from "@/lib/nativePresentationGeometry";

/*
 * TypeScript surface for the NativeScreens Capacitor plugin.
 *
 * Opens SwiftUI screens from the web layer. The web layer talks to this, never
 * to Capacitor directly, so there is one typed place to import from.
 *
 * Same degradation contract as foundationModels.ts: a missing plugin is the
 * expected case almost everywhere, so `isAvailable()` answers with a boolean
 * rather than throwing and callers do not need try/catch around a normal
 * situation. Presenting is different -- it is an explicit user action, so a
 * genuine failure there should surface as an error the UI can show.
 */

/**
 * What every present call resolves with.
 *
 * TWO MODES, TWO MOMENTS -- and the fields say which one happened, so callers
 * must read them separately rather than inferring:
 *
 *  - Modal (no frame): resolves on DISMISSAL. `dismissed: true`.
 *  - Embedded (with a frame): resolves on PRESENTATION, because a child
 *    controller has no completion signal and the web tab bar is the exit.
 *    `dismissed: false`.
 *
 * Treating every resolution as "the screen closed" is the bug this shape
 * exists to prevent: embedded it would un-hide the web list underneath while
 * the native screen is still up, drawing both at once.
 */
export interface NativePresentResult {
  presented: boolean;
  dismissed?: boolean;
  reason?: string;
}

/**
 * Options every native screen takes.
 *
 * `frame` is the region of the page the native screen should occupy, in points,
 * measured from the tab panel. Optional: when absent the native side falls back
 * to a full-screen presentation, so a caller that could not measure still gets
 * a working (if uglier) screen rather than nothing.
 */
type OpenOptions = {
  tripId: string;
  frame?: NativeFrame;
};

/** Where to draw the native screen, in points relative to the viewport. */
export interface NativeFrame {
  top: number;
  left: number;
  width: number;
  height: number;
  safeArea: { top: number; bottom: number };
}

interface NativeScreensPlugin {
  openPackingList(options: OpenOptions): Promise<NativePresentResult>;
  openItinerary(options: OpenOptions): Promise<NativePresentResult>;
  closeNativeScreen(): Promise<{ closed: boolean }>;
  setFrame(options: { frame: NativeFrame }): Promise<{ applied: boolean }>;
}

/*
 * The second argument matters and is easy to omit.
 *
 * `registerPlugin(name)` with no implementation leaves the web proxy empty, so
 * every method throws CapacitorException("... is not implemented on web") on
 * any platform without native code. Declaring the web implementation means
 * availability is answered by declaration instead of by catching an exception,
 * and gives tests a supported seam to substitute.
 *
 * The web implementation is deliberately "unavailable" rather than a no-op
 * that silently succeeds: a native screen cannot be presented in a browser, and
 * resolving as though it had been would leave the caller believing a screen is
 * open when nothing happened.
 */
const NativeScreens = registerPlugin<NativeScreensPlugin>("NativeScreens", {
  web: () =>
    Promise.resolve({
      async openPackingList() {
        throw new Error("Native screens are only available in the iOS app.");
      },
      async openItinerary() {
        throw new Error("Native screens are only available in the iOS app.");
      },
      /*
       * Closing is a no-op that REPORTED IT WAS A NO-OP, rather than a throw.
       *
       * On web there is never an embedded screen, and the caller fires this from
       * effect cleanup on unmount -- where a throw would surface as an unhandled
       * rejection during a normal navigation. `closed: false` is the truthful
       * answer and cannot be mistaken for success.
       */
      async closeNativeScreen() {
        return { closed: false };
      },
      // Same reasoning: nothing to move on web, and `applied: false` says so.
      async setFrame() {
        return { applied: false };
      },
    }),
});

/**
 * Whether native screens can be presented at all.
 *
 * Checks the platform as well as plugin presence: the web implementation
 * exists precisely so this can be answered by declaration, and it is not
 * available, so `Capacitor.getPlatform() === "ios"` is the real question.
 */
export function nativeScreensAvailable(): boolean {
  return Capacitor.getPlatform() === "ios" && Capacitor.isNativePlatform();
}

/**
 * Present the native packing list for a trip.
 *
 * With a `frame` it is embedded in the page and resolves on PRESENTATION with
 * `dismissed: false`; without one it is a full-screen modal that resolves on
 * dismissal with `dismissed: true`. Read the fields, do not infer -- see
 * `NativePresentResult`.
 *
 * `presented: false` is the other case: a screen was already up and this call
 * was a no-op, so nothing on screen changed.
 *
 * Throws if the platform cannot present it, so callers should gate on
 * `nativeScreensAvailable()` and keep their existing web behaviour as the
 * fallback rather than treating this as the only path.
 */
export async function openNativePackingList(
  tripId: string,
  frame?: NativeFrame
): Promise<NativePresentResult> {
  if (!nativeScreensAvailable()) {
    throw new Error("Native screens are only available in the iOS app.");
  }
  return NativeScreens.openPackingList({ tripId, frame });
}

/**
 * Present the native itinerary for a trip.
 *
 * Same contract as `openNativePackingList`: with a frame it embeds and resolves
 * on presentation (`dismissed: false`), without one it is a modal that resolves
 * on dismissal. `presented: false` means a screen was already up.
 */
export async function openNativeItinerary(
  tripId: string,
  frame?: NativeFrame
): Promise<NativePresentResult> {
  if (!nativeScreensAvailable()) {
    throw new Error("Native screens are only available in the iOS app.");
  }
  return NativeScreens.openItinerary({ tripId, frame });
}

/**
 * Tear down the embedded native screen, if one is up.
 *
 * The counterpart to the present calls in embedded mode. The native screens
 * deliberately have no Done button there -- the web tab bar is the way out --
 * so SOMETHING in the web layer has to take the view down, and this is it.
 * Callers fire it from effect cleanup when the owning tab unmounts.
 *
 * Resolves `{ closed }` and never throws: "it was already gone" is a normal
 * outcome when a teardown races a tab switch, and this is called from cleanup
 * where a rejection would become an unhandled promise.
 */
export async function closeNativeScreen(): Promise<{ closed: boolean }> {
  if (!nativeScreensAvailable()) return { closed: false };
  return NativeScreens.closeNativeScreen();
}

/**
 * Move the up native screen to a new region.
 *
 * Called as the web layer re-measures the tab panel -- on scroll, rotation and
 * keyboard -- so the native content tracks the region it is supposed to be
 * drawn into. Without this the frame is whatever it was at presentation time and
 * the page slides out from under the native view.
 *
 * Resolves `{ applied }` and never throws, for the same reason as
 * `closeNativeScreen`: a frame in flight when the tab is left is normal.
 */
export async function updateNativeFrame(
  frame: NativeFrame
): Promise<{ applied: boolean }> {
  if (!nativeScreensAvailable()) return { applied: false };
  return NativeScreens.setFrame({ frame });
}

/**
 * Measure the region a native screen should occupy, in points.
 *
 * The target is the tab panel, which is already exactly the content area below
 * the header and tab bar -- so nothing above it is disturbed and no header
 * height has to be hardcoded. See nativePresentationGeometry.ts for why that
 * choice matters.
 *
 * Returns null when there is nothing usable to measure, so the caller can fall
 * back to a full-screen presentation instead of presenting into a collapsed
 * region.
 */
export function measurePresentationFrame(
  panel: HTMLElement | null,
): NativeFrame | null {
  if (!panel || typeof window === "undefined") return null;

  const r = panel.getBoundingClientRect();

  /*
   * Read safe-area insets from the document element rather than hardcoding them.
   * They vary by device and orientation: a notch phone reports a tall top inset,
   * an older SE reports zero.
   *
   * The values come back from getComputedStyle as strings like "59px", so they
   * are parsed rather than coerced -- Number("59px") is NaN, and a NaN inset
   * would silently produce a NaN frame.
   */
  const cs = window.getComputedStyle(document.documentElement);
  const readInset = (name: string): number => {
    const n = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(n) ? n : 0;
  };

  const geometry = buildPresentationGeometry(
    { top: r.top, left: r.left, width: r.width, height: r.height },
    {
      top: readInset("--safe-area-inset-top") || readInset("env(safe-area-inset-top)"),
      bottom:
        readInset("--safe-area-inset-bottom") || readInset("env(safe-area-inset-bottom)"),
    },
  );

  return geometry ? roundGeometry(geometry) : null;
}
