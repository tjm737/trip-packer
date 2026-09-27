"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativeItinerary } from "@/lib/nativeScreens";
import { shouldPresentItineraryTab, shouldShowNativeFallbackButton } from "@/lib/nativeTabPresentation";

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
 * `openItinerary` resolves when the screen is DISMISSED, so the await below IS
 * the dismissal signal. That is a plugin contract, not a convenience.
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
   * Present once per entry into the Itinerary tab.
   *
   * Mounting IS the tab entry event -- this component is rendered as part of the
   * tab's content -- and unmounting is the exit, which resets the ref via the
   * cleanup below. That is what lets a second visit re-present without ever
   * presenting twice within one visit.
   */
  useEffect(() => {
    if (!isNative) return;

    const action = shouldPresentItineraryTab({
      tabActive: true,
      nativeAvailable: true,
      hasPresented: hasPresented.current,
      presenting,
    });
    if (action === "present") {
      hasPresented.current = true;
      present();
    }

    return () => {
      // Tab exit. A later entry is a new presentation, so clear the flag.
      hasPresented.current = false;
      setPresenting(false);
    };
    // `isNative` flips false -> true once, after mount; running then is correct.
    // `presenting` is deliberately NOT a dependency: it is read as a guard at
    // the moment of entering, and depending on it would re-run this effect when
    // the presentation resolves, re-arming the loop the guard exists to stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, tripId]);

  async function present() {
    setError(null);
    setPresenting(true);
    try {
      const result = await openNativeItinerary(tripId);

      /*
       * `presented: false` means a sheet was already up, so nothing changed --
       * keep `presenting` true, because the native screen really is on screen
       * and the web itinerary should stay hidden behind it.
       *
       * Anything else means the native screen has now been dismissed, because
       * the promise resolves on dismissal.
       */
      if (result?.presented !== false) setPresenting(false);
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
        {error ?? "The native itinerary did not open."}
      </span>

      <Tooltip label="Try opening the native SwiftUI itinerary again" side="top">
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={present}
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
