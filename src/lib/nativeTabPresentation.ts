/*
 * When a tab should auto-present its native SwiftUI screen, and whether the
 * web content should render behind it.
 *
 * Written for the Packing tab and now shared with the Itinerary tab. The rules
 * are not packing-specific: every native screen presented this way has the same
 * two questions (present now? render the web fallback?) and the same failure
 * modes, so the itinerary reuses them rather than growing a parallel copy that
 * can drift.
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
export type NativeTabAction = "present" | "wait" | "none";

export interface NativeTabPresentationInput {
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
export function shouldPresentNativeTab(input: NativeTabPresentationInput): NativeTabAction {
  if (!input.tabActive) return "none";
  if (!input.nativeAvailable) return "none";
  if (input.hasPresented || input.presenting) return "wait";
  return "present";
}

/*
 * Whether the web content should be rendered behind the native screen.
 *
 * False on iOS once a native presentation is in flight or on screen: the
 * native screen is not an overlay, it is the screen, and the web content
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
export function shouldRenderWebTabContent(input: {
  nativeAvailable: boolean;
  nativeOnScreen: boolean;
}): boolean {
  return !(input.nativeAvailable && input.nativeOnScreen);
}

/*
 * Whether the "Open native list" control should be on screen.
 *
 * It should almost never be. On iOS the native list IS the packing screen and it
 * auto-presents on entry into the tab, so a button whose only job is to open it
 * is a control for something that already happened. It used to render
 * unconditionally whenever the platform was iOS, which meant the ordinary path --
 * open the tab, dismiss the native list -- ended with a stray button sitting above
 * the fallback web list. There is nothing broken about that screen, but it reads
 * as broken, because a button offering to open a screen you just closed looks
 * like an error state the app has failed to explain.
 *
 * So the only honest reason to show it is that the automatic presentation did not
 * happen and the user is otherwise stuck:
 *
 *   - `presentFailed` -- the present call threw. The user asked for the native
 *     list (by tapping the tab) and did not get it. Showing a way to retry is the
 *     difference between a recoverable hiccup and a dead tab.
 *   - `tabEmpty` -- there is no web list behind it to use instead. Without this,
 *     a failure that leaves the tab blank would offer no way forward at all.
 *
 * Note both are checked against a platform that can actually present. On web and
 * Android there is no native screen to open, so the control must never appear --
 * `nativeAvailable` guards that, and it is checked first so the other two cannot
 * conjure a button on a platform that cannot honour it.
 */
export function shouldShowNativeFallbackButton(input: {
  nativeAvailable: boolean;
  presentFailed: boolean;
  tabEmpty: boolean;
}): boolean {
  if (!input.nativeAvailable) return false;
  return input.presentFailed || input.tabEmpty;
}

/*
 * Whether the Itinerary tab should auto-present its native screen.
 *
 * Same rules as packing -- the itinerary is presented on entering the tab, and
 * for the same reason: on iOS the native screen IS the itinerary, and the web
 * version behind it was rendered before any change and is never refetched.
 *
 * Kept as a named wrapper rather than a bare re-export so the itinerary has a
 * single place to diverge later if it needs to. It does not today, and a
 * re-export would quietly make any future packing-specific rule apply to the
 * itinerary too.
 */
export function shouldPresentItineraryTab(input: NativeTabPresentationInput): NativeTabAction {
  return shouldPresentNativeTab(input);
}
