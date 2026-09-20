"use client";

import { useCallback, useEffect, useState } from "react";
import { flushOfflineQueue, discardOfflineQueue } from "@/lib/storage";
import { queuedOpCount } from "@/lib/offlineQueue";

/*
 * Tracks connectivity and the offline write queue.
 *
 * `navigator.onLine` is only a hint — it reports whether the device has *a*
 * network, not whether our server is reachable (captive portals are the classic
 * case). So the queue length is the real signal that something is stuck, and it
 * is what the banner reports; `online` alone would claim success on hotel wifi
 * that silently drops every request.
 */
export function useOfflineStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(() => {
    setPending(queuedOpCount());
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

  return { online, pending, syncing, sync, discard, refreshPending };
}
