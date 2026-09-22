"use client";

import { useEffect, useState } from "react";
import { useWhenServiceWorkerReady } from "./serviceWorker";

/*
 * When was this trip page cached, and are we currently offline?
 *
 * Both halves are needed for the cue to be honest. A saved-at time on its own
 * is noise while the network is up — the user is looking at a live page and
 * does not care when a cache copy was written. The warning only means
 * something when the page in front of them came from that cache.
 *
 * The timestamp has to come from the service worker rather than the page: the
 * page cannot read response headers for its own navigation. See the
 * GET_TRIP_STAMP handler in public/sw.js.
 */

/** How long to wait for the worker's reply before giving up. */
const REPLY_TIMEOUT_MS = 3000;

export function useCachedTripSavedAt(tripId: string | undefined) {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  /*
   * Connectivity.
   *
   * navigator.onLine is unreliable in one direction: a phone attached to a
   * captive-portal wifi reports true while nothing is reachable. It is
   * trustworthy when it says false, which is the only case this branch acts
   * on, and the events catch the aeroplane-mode transition that matters. The
   * timestamp existing at all is the other half of the evidence, so a false
   * positive here cannot produce a warning on its own.
   */
  useEffect(() => {
    if (typeof navigator === "undefined") return;

    const sync = () => setOffline(!navigator.onLine);
    sync();

    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  /*
   * Ask the worker for the stamp once it controls the page.
   *
   * Skipped outside production because the worker is not registered in dev,
   * so the request would hang until the timeout on every render.
   */
  const enabled =
    typeof window !== "undefined" &&
    !!tripId &&
    process.env.NODE_ENV === "production" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator;

  useWhenServiceWorkerReady(() => {
    if (!tripId) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;

    /*
     * A MessageChannel keeps the reply private to this page. The timeout is a
     * real safeguard rather than belt-and-braces: if the worker was replaced
     * mid-flight or the message was dropped, the port would never fire and the
     * cue would stay silent forever. Silence is the correct fallback — a
     * missing cue must never block or break the itinerary.
     */
    const channel = new MessageChannel();
    let done = false;

    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      channel.port1.close();
      window.clearTimeout(timer);
      if (value) setSavedAt(value);
    };

    const timer = window.setTimeout(() => finish(null), REPLY_TIMEOUT_MS);

    channel.port1.onmessage = (event) => {
      const value = event.data?.savedAt;
      finish(typeof value === "string" ? value : null);
    };

    controller.postMessage(
      { type: "GET_TRIP_STAMP", url: `/trips/${tripId}` },
      [channel.port2]
    );
  }, [enabled, tripId]);

  return { savedAt, offline };
}
