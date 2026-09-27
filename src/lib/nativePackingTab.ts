/*
 * When the Packing tab should auto-present the native SwiftUI list, and
 * whether the web list should render behind it.
 *
 * On iOS the native list IS the packing screen. The web list is not shown
 * behind it and is not what the user returns to -- it is only the fallback for
 * the platforms where presenting is impossible (browser, Android), and for the
 * case where presenting a native screen fails outright.
 *
 * That is a reversal of the original design, which kept the web list mounted
 * underneath the native sheet. The problem with it was not the extra render:
 * the plugin resolved its promise when the sheet went UP and never signalled
 * dismissal, so the web layer had no idea the native screen had closed. Closing
 * it revealed a web list that had been sitting there unchanged the whole time,
 * showing stale data and none of the edits just made natively. To the user that
 * reads as the app being broken, and it reads that way precisely because
 * nothing on screen changed -- there was no moment that looked wrong.
 *
 * The state this guards is deliberately a single boolean per tab entry --
 * `hasPresented`. The failure it prevents is a re-present loop: presenting is
 * async, so a naive `useEffect(() => { present() })` keyed on the component
 * would re-present the moment any unrelated re-render occurred, yanking the
 * user back into a screen they had just dismissed.
 */

/** What the web layer should do with the native presentation right now. */
export type PackingTabAction = "present" | "wait" | "none";

export interface PackingTabPresentationInput {
  /** Is this the Packing tab, right now? */
  tabActive: boolean;
  /** Can the platform present a native screen at all (iOS + native bridge)? */
  nativeAvailable: boolean;
  /** Have we already presented the native screen for this entry into the tab? */
  hasPresented: boolean;
  /**
   * Is a native presentation believed to be in flight or currently on screen?
   *
   * This is the state that closes the gap between "we called present" and "the
   * native screen is up". Presenting is async, and on iOS the call does not
   * resolve until the screen is dismissed -- so between those two moments the
   * web layer must not act as though the user is looking at the tab.
   */
  presenting: boolean;
}

/*
 * `tabActive` is checked first and is not redundant with `hasPresented`.
 *
 * Leaving the tab and coming back is a new entry, so the native list should
 * present again -- that is the whole point of making it the tab. But the flag
 * that tracks "already presented" is not reset by the effect that runs on
 * entry, so the reset is driven by the tab transition instead. Returning "none"
 * whenever the tab is inactive is what makes that reset possible: it lets the
 * caller clear the flag while off-tab without presenting anything.
 *
 * "wait" is a distinct outcome from "none" on purpose. Both mean "do not
 * present", but they mean different things to the caller: "none" says there is
 * nothing to do, while "wait" says a presentation is already underway and the
 * caller must hold its state. Collapsing them would make an in-flight native
 * presentation look like an idle tab, which is the bug this replaced -- the web
 * list would render underneath a sheet that is still open.
 */
export function shouldPresentPackingTab(input: PackingTabPresentationInput): PackingTabAction {
  if (!input.tabActive) return "none";
  if (!input.nativeAvailable) return "none";
  if (input.hasPresented || input.presenting) return "wait";
  return "present";
}

/*
 * Whether the web packing list should be rendered.
 *
 * False on iOS once a native presentation is in flight or on screen: the
 * native screen is not an overlay, it is the packing screen, and the web list
 * behind it is stale by construction -- it was rendered before any native edit
 * and is never refetched. Rendering it means the user closes the native list
 * and lands on a worse copy of what they were just looking at.
 *
 * True everywhere else:
 *   - web and Android, where presenting is impossible and this list IS the
 *     feature;
 *   - iOS before the native screen has been asked for, so the tab is never
 *     blank while the sheet animates up;
 *   - iOS when presenting FAILED, which is the case that makes this a fallback
 *     rather than a plain `!isNative`. A failed present resolves with no
 *     dismissal, so `nativeOnScreen` stays false and the list comes back. If
 *     this returned `!isNative` instead, a failed present would leave the user
 *     staring at an empty tab with no list and no explanation.
 */
export function shouldRenderWebPackingList(input: {
  nativeAvailable: boolean;
  nativeOnScreen: boolean;
}): boolean {
  return !(input.nativeAvailable && input.nativeOnScreen);
}
