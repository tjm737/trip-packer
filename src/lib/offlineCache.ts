/*
 * Last-known-state cache.
 *
 * The app is a client over /api/state, so with no network it had nothing to
 * boot from: `fetchState()` rejects and the UI shows an error page. That is
 * exactly the situation the app is most useful in — standing in an airport on
 * bad wifi, or abroad with no data plan.
 *
 * This keeps the most recent successful state on the device so a cold start
 * with no network still renders the itinerary. It is a *cache*, never a source
 * of truth: every successful server read overwrites it, and a cache that fails
 * to parse is discarded rather than allowed to break startup.
 *
 * localStorage rather than IndexedDB on purpose. The whole AppState is a few
 * tens of KB of JSON — well inside the ~5MB localStorage budget — and a
 * synchronous read means the first paint can use it without an async round
 * trip. IndexedDB would buy capacity we do not need at the cost of a slower,
 * async boot path.
 */

import type { AppState } from "./types";

const STATE_KEY = "trip-packer:state-cache:v1";
const CACHED_AT_KEY = "trip-packer:state-cache:at:v1";

export type CachedState = {
  state: AppState;
  cachedAt: number;
};

/**
 * Reads the cached state. Returns null when there is nothing cached, when the
 * payload is corrupt, or on the server (no `window`).
 *
 * Never throws: a corrupt cache must degrade to "no cache", not a broken app.
 */
export function readCachedState(): CachedState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return null;

    const state = JSON.parse(raw) as AppState;
    // Guard the shape enough that a partial write cannot hand callers
    // something that looks valid but explodes on first render.
    if (!state || !Array.isArray(state.trips) || !Array.isArray(state.users)) {
      return null;
    }

    const at = Number(window.localStorage.getItem(CACHED_AT_KEY));
    return { state, cachedAt: Number.isFinite(at) ? at : 0 };
  } catch {
    return null;
  }
}

/** Stores the state as the offline fallback. Silently ignores quota errors. */
export function writeCachedState(state: AppState): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    window.localStorage.setItem(CACHED_AT_KEY, String(Date.now()));
  } catch {
    // Quota exceeded or storage disabled (private mode). Offline support is a
    // bonus; failing to cache must never break the online path.
  }
}

export function clearCachedState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STATE_KEY);
    window.localStorage.removeItem(CACHED_AT_KEY);
  } catch {
    /* see writeCachedState */
  }
}
