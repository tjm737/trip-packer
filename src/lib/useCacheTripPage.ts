"use client";

import { useWhenServiceWorkerReady } from "./serviceWorker";

/*
 * Asks the service worker to cache a trip page for offline use.
 *
 * Trip pages are server-rendered per trip, so they cannot be precached with the
 * app shell — we only know which trips matter once the user opens one. This
 * runs on the trip page itself, and by the time it fires the page has already
 * loaded successfully, so it is a warm-up rather than a blocking step.
 *
 * The send is deferred until the worker actually controls the page; posting
 * earlier is silently dropped, which previously meant a trip was never cached
 * on the very first visit. See serviceWorker.ts.
 *
 * Deliberately silent on failure. Offline support is an enhancement; a trip
 * that cannot be cached must not surface an error to someone who is simply
 * looking at their itinerary.
 */
export function useCacheTripPage(tripId: string | undefined) {
  const enabled =
    typeof window !== "undefined" &&
    !!tripId &&
    process.env.NODE_ENV === "production" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator;

  useWhenServiceWorkerReady(() => {
    if (!tripId) return;
    navigator.serviceWorker.controller?.postMessage({
      type: "CACHE_TRIP",
      url: `/trips/${tripId}`,
    });
  }, [enabled, tripId]);
}
