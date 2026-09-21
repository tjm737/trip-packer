"use client";

import { useCallback, useEffect, useState } from "react";
import { flushOfflineQueue, discardOfflineQueue } from "@/lib/storage";
import { listQueuedOps, queuedOpCount } from "@/lib/offlineQueue";

/*
 * Tracks connectivity and the offline write queue.
 *
 * `navigator.onLine` is only a hint — it reports whether the device has *a*
 * network, not whether our server is reachable (captive portals are the classic
 * case). So the queue length is the real signal that something is stuck, and it
 * is what the banner reports; `online` alone would claim success on hotel wifi
 * that silently drops every request.
 *
 * We also expose the queued op labels so the banner can name what is pending
 * rather than only counting it. A bare "2 changes" is not actionable when the
 * user is trying to work out whether the edit they just made is the one that
 * did not save.
 */
export function useOfflineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [labels, setLabels] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(() => {
    const ops = listQueuedOps();
    setPending(ops.length);
    setLabels(ops.map((op) => op.label));
  }, []);

  const sync = useCallback(async () => {
    if (queuedOpCount() === 0) return;
    setSyncing(true);
    try {
      await flushOfflineQueue();
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setOnline(navigator.onLine);
    refreshPending();

    const goOnline = () => {
      setOnline(true);
      // Reconnect is the moment queued work can finally land.
      void sync();
    };
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    // The `online` event is unreliable on iOS — it can fire before the network
    // is actually usable. Poll the queue length so the banner clears itself
    // once a retry succeeds without needing a manual refresh.
    const poll = window.setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine) void sync();
      else refreshPending();
    }, 15000);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      window.clearInterval(poll);
    };
  }, [refreshPending, sync]);

  const discard = useCallback(() => {
    discardOfflineQueue();
    refreshPending();
  }, [refreshPending]);

  return { online, pending, labels, syncing, sync, discard, refreshPending };
}
