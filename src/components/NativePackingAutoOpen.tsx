"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativePackingList } from "@/lib/nativeScreens";
import { shouldPresentPackingTab } from "@/lib/nativePackingTab";

/*
 * Makes the Packing tab open the native SwiftUI list by itself.
 *
 * This replaces the old "Open native list" button. The button was an opt-in
 * pilot affordance -- the user had to know the native screen existed and ask for
 * it. Now the tab presents it on entry, which is what "make the packing tab the
 * native list" means in practice.
 *
 * It is NOT a replacement of the web list. `openPackingList` presents a SwiftUI
 * screen over the WebView; it does not swap the tab's content, and there is no
 * dismiss verb in the plugin surface for the web layer to observe. So the web
 * list stays mounted underneath and is what the user returns to when they close
 * the native screen -- and it is the whole feature on web and Android, where
 * presenting is impossible.
 *
 * Rendering nothing on the web is deliberate: this component's only job is to
 * trigger a native presentation, so outside the iOS app it has nothing to do.
 * The web list is rendered by the parent, not here.
 */
export function NativePackingAutoOpen({ tripId }: { tripId: string }) {
  const [isNative, setIsNative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * `hasPresented` is a ref, not state, on purpose. Writing it must not cause a
   * re-render, because a re-render is what would re-run the effect below --
   * and a presentation loop is exactly the failure being guarded against.
   */
  const hasPresented = useRef(false);

  // Resolved after mount so server and first client render agree -- the bridge
  // does not exist during SSR, so `Capacitor.getPlatform()` is "web" there.
  useEffect(() => {
    setIsNative(Capacitor.getPlatform() === "ios");
  }, []);

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

    if (
      shouldPresentPackingTab({
        tabActive: true,
        nativeAvailable: true,
        hasPresented: hasPresented.current,
      })
    ) {
      hasPresented.current = true;
      present();
    }

    return () => {
      // Tab exit. A later entry is a new presentation, so clear the flag.
      hasPresented.current = false;
    };
    // `isNative` flips false -> true once, after mount; running then is correct.
  }, [isNative, tripId]);

  async function present() {
    setError(null);
    try {
      await openNativePackingList(tripId);
    } catch (e) {
      /*
       * Surface the reason rather than failing silently. The web list is still
       * on screen below, so this is not fatal -- but the user asked for the
       * native list and deserves to know it did not open, rather than being
       * left to wonder whether they mis-tapped.
       */
      setError(e instanceof Error ? e.message : "Could not open the native list.");
    }
  }

  if (!isNative) return null;

  return (
    <div className="px-3 pb-2 flex items-center gap-2 flex-wrap">
      <Tooltip label="Open the native SwiftUI packing list" side="top">
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={present}
            className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 focus-ring"
          >
            <Smartphone className="w-4 h-4 mr-1.5" />
            Open native list
          </Button>
        </span>
      </Tooltip>

      {error && (
        <span className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          {error}
        </span>
      )}
    </div>
  );
}
