"use client";

import { useEffect } from "react";

/*
 * Asks the service worker to cache a trip page for offline use.
 *
 * Trip pages are server-rendered per trip, so they cannot be precached with the
 * app shell — we only know which trips matter once the user opens one. This
 * runs on the trip page itself, and by the time it fires the page has already
 * loaded successfully, so it is a warm-up rather than a blocking step.
 *
 * Deliberately silent on failure. Offline support is an enhancement; a trip
 * that cannot be cached must not surface an error to someone who is simply
 * looking at their itinerary.
 */
export function useCacheTripPage(tripId: string | undefined) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!tripId) return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const send = () => {
      // controller may be null on the very first load, before the worker has
      // claimed the page; registering is the registrar's job, not ours.
      navigator.serviceWorker.controller?.postMessage({
        type: "CACHE_TRIP",
        url: `/trips/${tripId}`,
      });
    };

    if (navigator.serviceWorker.controller) send();
    else navigator.serviceWorker.ready.then(send).catch(() => {});
  }, [tripId]);
}
