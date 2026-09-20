"use client";

import { CloudOff, RefreshCw, Check, X } from "lucide-react";
import { useOfflineStatus } from "@/lib/useOfflineStatus";
import { Tooltip } from "@/components/ui/tooltip";

/*
 * A thin strip shown only when something is actually wrong: no network, or
 * writes waiting to sync. When online with an empty queue it renders nothing,
 * so there is no permanent chrome on a healthy connection.
 *
 * Placed above the content rather than floating, so it can never cover the
 * itinerary — the one thing the user needs to read offline.
 */
export function OfflineBanner() {
  const { online, pending, syncing, sync, discard } = useOfflineStatus();

  const showOffline = !online || pending > 0;
  if (!showOffline) return null;

  const label = !online
    ? pending > 0
      ? `Offline — ${pending} change${pending === 1 ? "" : "s"} will sync`
      : "Offline — showing your saved copy"
    : syncing
      ? `Syncing ${pending} change${pending === 1 ? "" : "s"}…`
      : `${pending} change${pending === 1 ? "" : "s"} waiting to sync`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 sm:px-4"
    >
      {!online ? (
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
      ) : syncing ? (
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <Check className="h-3.5 w-3.5 shrink-0" />
      )}

      <span className="min-w-0 flex-1 truncate">{label}</span>

      {online && pending > 0 && !syncing && (
        <>
          <Tooltip label="Send queued changes to the server now" side="bottom">
            <button
              type="button"
              onClick={() => void sync()}
              className="shrink-0 rounded px-1.5 py-0.5 font-medium text-amber-100 transition-colors hover:bg-amber-500/20"
            >
              Retry now
            </button>
          </Tooltip>

          <Tooltip label="Discard these changes — they will not be saved" side="bottom">
            <button
              type="button"
              onClick={discard}
              aria-label="Discard queued changes"
              className="shrink-0 rounded p-1 text-amber-200/70 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
