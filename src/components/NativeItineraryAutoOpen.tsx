"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativeItinerary, closeNativeScreen, updateNativeFrame } from "@/lib/nativeScreens";
import { shouldPresentItineraryTab, shouldShowNativeFallbackButton, shouldSendFrame, sameFrame } from "@/lib/nativeTabPresentation";
import { useNativePresentationFrame } from "@/components/useNativePresentationFrame";
import { NativePresentationProbe, recordNativeClose } from "@/components/NativePresentationProbe";

/*
 * Makes the Itinerary tab open the native SwiftUI itinerary by itself, and
 * reports whether the native screen currently owns the tab.
 *
 * A deliberate near-mirror of NativePackingAutoOpen, and the duplication is
 * contained rather than eliminated: the two differ only in which plugin method
 * they call, so the shared decisions live in `nativeTabPresentation` (when to
 * present, whether to render the web fallback, when to offer a retry) and only
 * the wiring is repeated here. The alternative -- a generic component with a
 * `screen` prop -- would have to thread the "what does the web fallback look
 * look like" question through the parent anyway, since the itinerary's fallback
 * is rendered by the page, not by this component.
 *
 * It reports up rather than rendering the itinerary itself, for the same reason
 * as packing: the web itinerary is the feature on web and Android, and the
 * fallback on iOS when a present fails, so it is not this component's to own.
 *
 * `openItinerary` resolves differently in the two modes, and this component must
 * not assume either: embedded it resolves on PRESENTATION (`dismissed: false`)
 * and the tab's unmount is what closes the screen; modal it resolves on
 * DISMISSAL (`dismissed: true`). See the result handling in `present` below.
 */
export function NativeItineraryAutoOpen({
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
   * A ref, not state, on purpose: writing it must not cause a re-render, because
   * a re-render is what would re-run the effect below -- and re-presenting the
   * moment the user dismissed the screen is exactly the loop being guarded
   * against.
   */
  const hasPresented = useRef(false);

  /*
   * Unlike `hasPresented` this DOES drive renders -- the parent hides the web
   * itinerary when it flips -- so it is state.
   */
  const [presenting, setPresenting] = useState(false);

  /*
   * The region to draw into. Null until the tab panel has a usable rect, which
   * is what gates the present below: presenting before there is a region to
   * draw into would put the native screen in the wrong place, and the frame is
   * only correct once the panel above it has settled.
   *
   * Kept live while native owns the tab, not stopped once `presenting` flips.
   * The native view has to track the panel as the page scrolls and the device
   * rotates, and the only thing that moves it is a fresh frame sent from here --
   * so tearing the measurement down at presentation time would freeze the native
   * content exactly when it needs to follow. `onFrameChange` below forwards each
   * new frame to the plugin.
   */
  const frame = useNativePresentationFrame(isNative);

  // Resolved after mount so server and first client render agree. The bridge
  // does not exist during SSR, so `Capacitor.getPlatform()` is "web" there, and
  // reading it during render would make the two disagree.
  useEffect(() => {
    const native = Capacitor.getPlatform() === "ios";
    setIsNative(native);
    onNativeAvailable(native);
  }, [onNativeAvailable]);

  // Tell the parent whenever native takes or releases the tab.
  useEffect(() => {
    onNativeOnScreen(presenting);
  }, [presenting, onNativeOnScreen]);

  /*
   * Keep the up native screen pinned to the panel as the panel moves.
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
   * Present once per entry into the Itinerary tab.
   *
   * Mounting IS the tab entry event -- this component is rendered as part of the
   * tab's content -- and unmounting is the exit, which resets the ref via the
   * cleanup below. That is what lets a second visit re-present without ever
   * presenting twice within one visit.
   *
   * Split across two effects on purpose. The arming effect below has NO
   * dependencies that change during a visit, so its cleanup runs only on real
   * tab exit. The presenting effect is keyed on `frame`, which changes on every
   * scroll -- if the reset lived there, a scroll would clear `hasPresented` and
   * re-present the screen the user is already looking at, which is precisely the
   * loop the ref exists to prevent.
   */
  useEffect(() => {
    if (!isNative) return;
    return () => {
      /*
       * Tab exit -- and this is the ONLY thing that takes the native view down.
       *
       * Embedded screens have no Done button by design (the web tab bar is the
       * exit), so nothing native-side closes them. Without this call the child
       * controller stays on screen after the user taps another tab, covering the
       * tab they switched to -- the native content would own the screen instead
       * of belonging to a tab, which is the exact problem embedding exists to
       * solve.
       */
      void closeNativeScreen();
      recordNativeClose();
      hasPresented.current = false;
      lastSentFrame.current = null;
      setPresenting(false);
    };
  }, [isNative, tripId]);

  useEffect(() => {
    if (!isNative) return;

    const action = shouldPresentItineraryTab({
      tabActive: true,
      nativeAvailable: true,
      hasPresented: hasPresented.current,
      presenting,
    });
    // `action === "present"` alone is not enough: the frame must exist too. The
    // present cannot happen on mount, because the panel has no usable rect until
    // layout settles -- drawing then would put the screen in the wrong place.
    if (action === "present" && frame) {
      hasPresented.current = true;
      void present(frame);
    }
    // No cleanup here: this effect must not reset anything, for the reason above.
    // `presenting` is read as a guard at the moment of presenting rather than
    // depended on, because depending on it would re-run this effect when the
    // presentation resolves and re-arm the loop the guard exists to stop.
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
      const result = await openNativeItinerary(tripId, f);

      /*
       * The two fields answer different questions, and in embedded mode they
       * disagree -- so they must be read separately rather than inferred.
       *
       * `presented: false` means nothing was shown (a screen was already up), so
       * keep `presenting` true: the native screen really is on screen and the web
       * itinerary must stay hidden behind it.
       *
       * `dismissed: true` means the promise resolved because the screen CLOSED --
       * the modal behaviour, where resolution waits for the dismissal. Only then
       * is it right to stop treating the native screen as present.
       *
       * Embedded, the promise resolves as soon as the child controller is added
       * (there is no dismissal to wait for, since the web tab bar is the way out),
       * and reports `dismissed: false`. Deciding on `presented` alone would read
       * that as "closed", un-hide the web itinerary underneath, and draw the web
       * list and the native list on top of each other -- the exact overlap this
       * whole feature exists to avoid.
       */
      if (result?.dismissed) setPresenting(false);
      /*
       * `presented: false` means a screen was already up when this was called,
       * so this call changed nothing. `presenting` stays true -- the native
       * screen really is on screen and the web itinerary must stay hidden behind
       * it. Falling through to `setPresenting(false)` here (the previous
       * behaviour, deciding on resolution alone) un-hid the web list underneath
       * the live native view.
       */
    } catch (e) {
      /*
       * Clear `presenting` on failure so the web itinerary renders. A failed
       * present must degrade to the web screen rather than to an empty tab --
       * the native screen is not coming, and a blank itinerary would leave the
       * user with no way to see their bookings.
       */
      setPresenting(false);
      setError(e instanceof Error ? e.message : "Could not open the native itinerary.");
    }
  }

  if (!isNative) return null;

  /*
   * The probe is rendered in BOTH branches below, and that is load-bearing.
   *
   * The test reads it to learn whether the native screen is up. If it only
   * mounted alongside the error button, it would be absent in exactly the case
   * the test cares about -- a successful present, where the button is hidden --
   * and the test would read "no probe" as a failure of the thing it is meant to
   * be observing. So it is a sibling of the branch, not inside it.
   */
  const probeState = {
    native: isNative,
    frameTop: frame ? frame.top : null,
    frameHeight: frame ? frame.height : null,
    presenting,
    closedCount: 0,
    reason: error ?? "",
  };

  const showButton = shouldShowNativeFallbackButton({
    nativeAvailable: isNative,
    presentFailed: error !== null,
    tabEmpty: false,
  });

  if (!showButton) return <NativePresentationProbe state={probeState} />;

  return (
    <>
      <NativePresentationProbe state={probeState} />
      <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3 flex-shrink-0" />
        {error ?? "The native itinerary did not open."}
      </span>

      <Tooltip label="Try opening the native SwiftUI itinerary again" side="top">
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!frame) {
                setError("The itinerary is still loading. Try again in a moment.");
                return;
              }
              void present(frame);
            }}
            className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 focus-ring"
          >
            <Smartphone className="w-4 h-4 mr-1.5" />
            Try again
          </Button>
        </span>
      </Tooltip>
      </div>
    </>
  );
}
