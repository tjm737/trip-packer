"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativePackingList, closeNativeScreen, updateNativeFrame, nativeScreensAvailable } from "@/lib/nativeScreens";
import { shouldPresentNativeTab, shouldShowNativeFallbackButton, shouldSendFrame, sameFrame } from "@/lib/nativeTabPresentation";
import { useNativePresentationFrame } from "@/components/useNativePresentationFrame";

/*
 * Makes the Packing tab open the native SwiftUI list by itself, and reports
 * whether the native screen currently owns the tab.
 *
 * On iOS the native list is the packing screen, not an overlay -- the parent
 * hides the web list while it is up. That is why this component takes
 * `onNativeOnScreen` and raises its own presentation state: the decision to
 * hide the web list depends on state that only lives here, and the parent is
 * what renders the list.
 *
 * It reports up rather than rendering the list itself because the list is not
 * this component's to own. It is the whole feature on web and Android, and it is
 * the fallback on iOS when presenting fails, so it has to keep working when the
 * native bridge is absent entirely.
 *
 * `openPackingList` resolves differently in the two modes and this component
 * must handle both: embedded (the normal iOS case, with a frame) it resolves on
 * PRESENTATION with `dismissed: false`, and the tab's unmount closes the screen;
 * modal (no frame) it resolves on DISMISSAL with `dismissed: true`. Deciding on
 * resolution alone is what previously produced the stale list -- and, in the
 * other direction, un-hid the web list underneath a live native one.
 */
export function NativePackingAutoOpen({
  tripId,
  onNativeOnScreen,
  onNativeAvailable,
}: {
  tripId: string;
  onNativeOnScreen: (onScreen: boolean) => void;
  onNativeAvailable: (available: boolean) => void;
}) {
  const [isNative, setIsNative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * `hasPresented` is a ref, not state, on purpose. Writing it must not cause a
   * re-render, because a re-render is what would re-run the effect below --
   * and a presentation loop is exactly the failure being guarded against.
   */
  const hasPresented = useRef(false);

  /*
   * Tracks whether a presentation is in flight or fully on screen. Unlike
   * `hasPresented` this DOES drive renders -- the parent hides the web list
   * when it flips -- so it is state.
   */
  const [presenting, setPresenting] = useState(false);

  /*
   * The region of the page the native list should occupy, in points.
   *
   * Null until the tab panel has been measured. The effect below waits for it,
   * because the native screen is embedded in that region rather than presented
   * over the whole page.
   */
  const frame = useNativePresentationFrame(isNative);

  // Resolved after mount so server and first client render agree -- the bridge
  // does not exist during SSR, so `Capacitor.getPlatform()` is "web" there.
  useEffect(() => {
    /*
     * Gate on availability, not the platform.
     *
     * `Capacitor.getPlatform() === "ios"` was the old test and it is now wrong:
     * native screens are disabled (see NATIVE_SCREENS_ENABLED), so on iOS the
     * platform check is true while nothing should be presented. Using it would
     * still call the open* function, which throws for a disabled feature, and the
     * catch would surface "Native screens are only available in the iOS app" to
     * the user -- an error message on every tab open for a deliberate disable.
     *
     * `nativeScreensAvailable()` is the single source of truth for whether the
     * feature is on, so this cannot drift from the kill switch.
     */
    const native = nativeScreensAvailable();
    setIsNative(native);
    onNativeAvailable(native);
  }, [onNativeAvailable]);

  // Tell the parent whenever native takes or releases the tab. Separate from
  // the effect below so the parent is told on failure too, not only on success.
  useEffect(() => {
    onNativeOnScreen(presenting);
  }, [presenting, onNativeOnScreen]);

  /*
   * Keep the up native list pinned to the panel as the panel moves.
   *
   * See `shouldSendFrame` for why a frame is not sent when there is nothing on
   * screen or when it repeats what the present already carried. The comparison is
   * by VALUE -- `measurePresentationFrame` returns a fresh object per
   * measurement, so an identity check would send on every scroll event.
   */
  const lastSentFrame = useRef<typeof frame>(null);
  useEffect(() => {
    if (!shouldSendFrame({
      presenting,
      hasFrame: frame !== null,
      sameAsLastSent: sameFrame(lastSentFrame.current, frame),
    })) return;
    lastSentFrame.current = frame;
    void updateNativeFrame(frame as NonNullable<typeof frame>);
  }, [presenting, frame]);

  /*
   * Tab entry arms the present; tab EXIT is what closes the screen.
   *
   * Split into a separate effect from the present below because this one has no
   * dependency that changes during a visit -- so its cleanup runs only on a real
   * unmount. The present below IS keyed on `frame`, which changes on every
   * scroll, so putting the teardown in its cleanup (where it used to live) would
   * close the native screen every time the page scrolled.
   *
   * The close is the only thing that takes the native view down: embedded screens
   * have no Done button by design, the web tab bar is the exit. Without it the
   * child controller stays on screen over whichever tab the user switched to.
   */
  useEffect(() => {
    if (!isNative) return;
    return () => {
      void closeNativeScreen();
      hasPresented.current = false;
      lastSentFrame.current = null;
      setPresenting(false);
    };
  }, [isNative, tripId]);

  /*
   * Present once per entry into the Packing tab.
   *
   * This component is mounted as part of the Packing tab's content, so mounting
   * IS the tab entry event -- and unmounting is the exit, handled by the effect
   * above. That is what lets a second visit re-present without ever presenting
   * twice within one visit.
   */
  useEffect(() => {
    if (!isNative) return;
    /*
     * Wait for a usable frame before presenting. The native screen is embedded
     * in the tab panel's region, so presenting before the panel has been
     * measured would either fail or land in the wrong place -- and a zero-height
     * frame is treated as "not yet measured" rather than as a real size, because
     * a hidden or collapsed panel reports one honestly.
     */
    if (!frame) return;

    const action = shouldPresentNativeTab({
      tabActive: true,
      nativeAvailable: true,
      hasPresented: hasPresented.current,
      presenting,
    });
    if (action === "present") {
      hasPresented.current = true;
      void present(frame);
    }

    // NO cleanup here -- see the effect above. A cleanup keyed on `frame` would
    // fire on every scroll and close the screen the user is looking at.
    // `isNative` flips false -> true once, after mount; running then is correct.
    // `presenting` is deliberately NOT a dependency: it is read as a guard at
    // the moment of entering, and depending on it would re-run this effect when
    // the presentation resolves, re-arming the loop the guard exists to stop.
    // `frame` IS a dependency -- it starts null and arrives on the first
    // measurement, and the effect has to run again once it does. Re-running is
    // harmless because `hasPresented` stops a second present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, tripId, frame]);

  async function present(f: NonNullable<typeof frame>) {
    setError(null);
    setPresenting(true);
    /*
     * Record the frame the present carries BEFORE the call, so the forwarding
     * effect above sees it as already-sent and does not immediately re-send it.
     * A re-send can land before the child controller exists and resolve
     * `applied: false` under a view that is visibly on screen.
     */
    lastSentFrame.current = f;
    try {
      const result = await openNativePackingList(tripId, f);

      /*
       * The two fields answer different questions, and in embedded mode they
       * disagree -- so they must be read separately rather than inferred.
       *
       * `presented: false` means nothing was shown (a screen was already up), so
       * keep `presenting` true: the native screen really is on screen and the web
       * list must stay hidden behind it.
       *
       * `dismissed: true` means the promise resolved because the screen CLOSED --
       * the modal behaviour, where resolution waits for the dismissal. Only then
       * is it right to stop treating the native screen as present, which is what
       * brings the tab back.
       *
       * Embedded, the promise resolves as soon as the child controller is added
       * and reports `dismissed: false`; deciding on `presented` alone would bring
       * the web list back underneath the still-visible native one.
       */
      if (result?.dismissed) setPresenting(false);
    } catch (e) {
      /*
       * Clear `presenting` on failure so the web list renders. A failed present
       * must degrade to the web list rather than to an empty tab -- the native
       * screen is not coming, and leaving the tab blank would give the user no
       * way to pack anything.
       *
       * Surface the reason rather than failing silently: the user asked for the
       * native list and deserves to know it did not open, rather than being
       * left to wonder whether they mis-tapped.
       */
      setPresenting(false);
      setError(e instanceof Error ? e.message : "Could not open the native list.");
    }
  }

  if (!isNative) return null;

  /*
   * On iOS the native list is the packing screen and it opens itself when the tab
   * is entered, so there is normally nothing for a button to do here. Showing one
   * unconditionally is what produced the stray "Open native list" control sitting
   * above the web list every time the user closed the native screen.
   *
   * It now appears only when the automatic presentation failed -- and the failure
   * is stated in words rather than implied by the presence of a button, because a
   * bare button reads as an unexplained state rather than an error.
   */
  const showButton = shouldShowNativeFallbackButton({
    nativeAvailable: isNative,
    presentFailed: error !== null,
    tabEmpty: false,
  });

  if (!showButton) return null;

  return (
    <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3 flex-shrink-0" />
        {error ?? "The native list did not open."}
      </span>

      <Tooltip label="Try opening the native SwiftUI packing list again" side="top">
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            /* Wrapped, not passed directly: `onClick` hands the handler a mouse
               event, and `present` now takes a frame. Passing it directly would
               typecheck as "a frame is not an event" in one direction and, were
               the types looser, would silently hand a MouseEvent to native as a
               frame. The retry is a no-op until the panel has been measured,
               which is the same condition the auto-present path waits on. */
            onClick={() => { if (frame) present(frame); }}
            disabled={!frame}
            className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 focus-ring"
          >
            <Smartphone className="w-4 h-4 mr-1.5" />
            Try again
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
