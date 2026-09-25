import { Capacitor, registerPlugin } from "@capacitor/core";

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

interface NativeScreensPlugin {
  openPackingList(options: { tripId: string }): Promise<{ presented: boolean }>;
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
 * Throws if the platform cannot present it, so callers should gate on
 * `nativeScreensAvailable()` and keep their existing web behaviour as the
 * fallback rather than treating this as the only path.
 */
export async function openNativePackingList(tripId: string): Promise<void> {
  if (!nativeScreensAvailable()) {
    throw new Error("Native screens are only available in the iOS app.");
  }
  await NativeScreens.openPackingList({ tripId });
}
