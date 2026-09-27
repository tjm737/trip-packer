"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativePackingList } from "@/lib/nativeScreens";
import { shouldPresentNativeTab, shouldShowNativeFallbackButton } from "@/lib/nativeTabPresentation";

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
 * `openPackingList` resolves when the screen is DISMISSED, which makes the
 * await below the dismissal signal -- there is no event to subscribe to and no
 * polling. That is a contract of the plugin, not a convenience: it used to
 * resolve on present, and the web layer's resulting inability to tell present
 * from dismissed is what produced the stale list this replaces.
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

  // Resolved after mount so server and first client render agree -- the bridge
  // does not exist during SSR, so `Capacitor.getPlatform()` is "web" there.
  useEffect(() => {
    const native = Capacitor.getPlatform() === "ios";
    setIsNative(native);
    onNativeAvailable(native);
  }, [onNativeAvailable]);

  // Tell the parent whenever native takes or releases the tab. Separate from
  // the effect below so the parent is told on failure too, not only on success.
  useEffect(() => {
    onNativeOnScreen(presenting);
  }, [presenting, onNativeOnScreen]);

  /*
   * Present once per entry into the Packing tab.
   *
   * This component is mounted as part of the Packing tab's content, so mounting
   * IS the tab entry event -- and unmounting is the exit, which resets the ref
   * via the cleanup below. That is what lets a second visit re-present without
   * ever presenting twice within one visit.
   */
  useEffect(() => {
    if (!isNative) return;

    const action = shouldPresentNativeTab({
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
      const result = await openNativePackingList(tripId);

      /*
       * `presented: false` means a sheet was already up, so nothing changed --
       * keep `presenting` true, because the native screen really is on screen
       * and the web list should stay hidden behind it.
       *
       * Anything else means the native screen has now been dismissed, because
       * the promise resolves on dismissal. Clearing `presenting` here is what
       * brings the tab back, and on iOS brings the web list back with it as the
       * fallback for a dismissed-then-re-entered tab.
       */
      if (result?.presented !== false) setPresenting(false);
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
