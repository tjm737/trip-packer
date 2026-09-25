"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AlertCircle, Smartphone } from "lucide-react";
import { openNativePackingList } from "@/lib/nativeScreens";

/*
 * Entry point to the native SwiftUI packing list.
 *
 * Only rendered where native screens can actually be presented -- inside the
 * iOS app. On the web this returns null, so the button never appears in a
 * browser, where it could only lead to an error. The check runs in an effect
 * rather than during render because Capacitor's platform is resolved from the
 * bridge, which does not exist while server-rendering; reading it during render
 * would produce a hydration mismatch between the server's "not iOS" and the
 * client's "iOS".
 *
 * Presenting is an explicit user action, so unlike availability it surfaces
 * failure rather than hiding: if the bridge rejects, the reason is shown
 * instead of the tap appearing to do nothing.
 */
export function NativePackingButton({ tripId }: { tripId: string }) {
  const [isNative, setIsNative] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved after mount so the server and first client render agree.
  useEffect(() => {
    setIsNative(Capacitor.getPlatform() === "ios");
  }, []);

  if (!isNative) return null;

  async function open() {
    setError(null);
    try {
      await openNativePackingList(tripId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the native list.");
    }
  }

  return (
    <div className="py-2 px-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Tooltip label="Open the native SwiftUI packing list" side="top">
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              onClick={open}
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
    </div>
  );
}
