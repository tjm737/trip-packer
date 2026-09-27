"use client";

/*
 * Client-side metrics collector.
 *
 * Fire-and-forget, and that phrase is a requirement rather than a description:
 * nothing here may ever delay a render, throw into a component, or surface a
 * failure to the user. Every function is a no-op when the environment cannot
 * support it, because the app's job is to plan a trip and this is a side note.
 *
 * THREE DESIGN CHOICES WORTH STATING
 *
 * 1. QUEUE AND FLUSH, not one request per event. A page that navigates three
 *    times would otherwise make three round trips; batched, they cost one. The
 *    flush is debounced so a burst (mount + route change + a click) collapses
 *    into a single POST.
 *
 * 2. `sendBeacon` ON UNLOAD, `fetch` OTHERWISE. A normal `fetch` on
 *    `pagehide`/`visibilitychange` is routinely killed when the tab dies, which
 *    is precisely when the most interesting event — the user leaving — is in
 *    the queue. `navigator.sendBeacon` is the browser API built for this: it
 *    hands the payload to the browser and returns immediately, so it survives
 *    the unload. It cannot be used for the debounced path because it gives no
 *    response and no retry.
 *
 * 3. THE SESSION ID LIVES IN sessionStorage, NOT localStorage. A new tab is a
 *    new sitting, and "how many sittings" stops meaning anything if a browser
 *    that is never closed reports one session forever. sessionStorage is also
 *    cleared when the tab closes, so the id cannot become a durable identifier
 *    for a person — which is the whole reason this is a random value rather
 *    than anything derived.
 */

import { normalizePath, type KnownEvent } from "@/lib/metrics";

const ENDPOINT = "/api/metrics";
const SESSION_KEY = "tp_metrics_session";

/** Collapse a burst of events into one request. */
const FLUSH_DELAY_MS = 2_000;

/** Hard cap on the queue, so a long offline stretch cannot grow it forever. */
const MAX_QUEUE = 40;

interface QueuedEvent {
  name: KnownEvent;
  sessionId: string | null;
  meta?: Record<string, string | number | boolean>;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

/**
 * Whether to collect at all.
 *
 * Respects Do Not Track and the Global Privacy Control signal. Both are
 * explicit requests not to be measured, and honouring them costs one line
 * against a table where the numbers are directional anyway. Also opts out
 * during local development, so a dev session cannot pollute the one dataset
 * used to judge whether the app is being used.
 */
function collectionEnabled(): boolean {
  if (typeof window === "undefined") return false;

  if (process.env.NODE_ENV !== "production") return false;

  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl === true) return false;
  if (navigator.doNotTrack === "1") return false;

  return true;
}

/**
 * The per-tab sitting id.
 *
 * Random, not derived from anything about the device. `crypto.randomUUID` is
 * used where available and a coarse fallback otherwise — the fallback is
 * deliberately not a hash of navigator properties, because a stable
 * device-derived value would be exactly the fingerprint this design avoids.
 */
export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const generated =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    window.sessionStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    // Private mode or storage disabled. Counting still works; this session
    // just does not coalesce, which is better than throwing.
    return null;
  }
}

/**
 * Queue an event.
 *
 * Never throws and never returns anything the caller needs. Callers treat this
 * as a statement of fact about something that already happened.
 */
export function track(
  name: KnownEvent,
  meta?: Record<string, string | number | boolean>
): void {
  if (!collectionEnabled()) return;

  try {
    if (queue.length >= MAX_QUEUE) {
      // Drop the OLDEST, not the newest. Recent events describe what the user
      // is doing now, which is the more useful half of a truncated queue.
      queue.shift();
    }

    queue.push({ name, sessionId: getSessionId(), meta });

    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, FLUSH_DELAY_MS);
    }
  } catch {
    // A metrics failure is not allowed to break a click handler.
  }
}

/** Record the current page view, with the path normalised to drop ids. */
export function trackPageView(pathname: string): void {
  track("page_view", { path: normalizePath(pathname) });
}

/**
 * Send what is queued, right now.
 *
 * Returns a promise so the unload path can `await` it where the environment
 * supports that, but callers are free to ignore it — the debounced path does.
 */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  if (!collectionEnabled()) {
    queue = [];
    return;
  }

  const batch = queue;
  queue = [];

  const body = JSON.stringify({ events: batch });

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // Put the events back so a transient failure is retried on the next flush.
    // Re-prepending (not pushing) preserves order, and the queue stays capped
    // because track() trims from the front.
    queue = batch.concat(queue).slice(-MAX_QUEUE);
  }
}

/**
 * Install the unload handlers. Idempotent, so a double render cannot double
 * send — which would silently double every count recorded at the moment of
 * leaving, the exact number a funnel analysis depends on.
 */
export function installUnloadFlush(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const beacon = () => {
    if (queue.length === 0) return;
    if (!collectionEnabled()) {
      queue = [];
      return;
    }

    const body = JSON.stringify({ events: queue });
    queue = [];

    try {
      if (typeof navigator.sendBeacon === "function") {
        // A Blob with an explicit type, because sendBeacon defaults to
        // text/plain and the route parses JSON.
        const blob = new Blob([body], { type: "application/json" });
        const sent = navigator.sendBeacon(ENDPOINT, blob);
        if (sent) return;
      }
    } catch {
      // fall through to fetch
    }

    // Fallback: keepalive fetch survives some unloads where sendBeacon is
    // unavailable (older Safari). Losing the batch is acceptable; throwing
    // during unload is not.
    try {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
    } catch {
      /* nothing left to do */
    }
  };

  // pagehide is the reliable signal on iOS Safari; visibilitychange covers
  // tab switches and the Android task switcher, where pagehide may not fire.
  window.addEventListener("pagehide", beacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") beacon();
  });
}
