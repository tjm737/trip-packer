/*
 * When the Packing tab should auto-present the native SwiftUI list.
 *
 * The native screen is presented OVER the web UI rather than replacing it, so
 * "open the tab" is not the same event as "show the list": the presentation can
 * fail, and the user can dismiss it. Both cases have to land somewhere sane,
 * and both are decisions rather than side effects, so they live here as a pure
 * function that tests can exercise without a WebView.
 *
 * The state this guards is deliberately a single boolean per tab entry --
 * `hasPresented`. The failure it prevents is a re-present loop: presenting is
 * async and the WebView stays mounted underneath, so a naive
 * `useEffect(() => { present() })` keyed on the component would re-present the
 * moment any unrelated re-render occurred, yanking the user back into a screen
 * they had just dismissed.
 */

export interface PackingTabPresentationInput {
  /** Is this the Packing tab, right now? */
  tabActive: boolean;
  /** Can the platform present a native screen at all (iOS + native bridge)? */
  nativeAvailable: boolean;
  /** Have we already presented the native screen for this entry into the tab? */
  hasPresented: boolean;
}

/*
 * `tabActive` is checked first and is not redundant with `hasPresented`.
 *
 * Leaving the tab and coming back is a new entry, so the native list should
 * present again -- that is the whole point of making it the tab. But the flag
 * that tracks "already presented" is not reset by the effect that runs on
 * entry, so the reset is driven by the tab transition instead. Returning false
 * whenever the tab is inactive is what makes that reset possible: it lets the
 * caller clear the flag while off-tab without presenting anything.
 */
export function shouldPresentPackingTab(
  input: PackingTabPresentationInput
): boolean {
  if (!input.tabActive) return false;
  if (!input.nativeAvailable) return false;
  return !input.hasPresented;
}

/*
 * Whether the web packing list should be rendered.
 *
 * Always true, and that is the design rather than an oversight. The native
 * screen is an OVERLAY over this list: presenting can fail, and the user can
 * dismiss it, so the list underneath is the floor in every environment --
 * browser, Android, and inside the iOS app alike. Deleting it would turn a
 * dismissed overlay into a blank Packing tab.
 *
 * It exists as a function so the reasoning has a name and a test, and so that
 * the day this becomes conditional (e.g. native-only on iOS) there is one place
 * to change rather than an inlined literal to hunt down.
 */
export function shouldRenderWebPackingList(): boolean {
  return true;
}
