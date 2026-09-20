"use client";

/*
 * Client-side cache of geocoded coordinates.
 *
 * Why this is needed: reservations store location *text* only. Coordinates are
 * resolved on the server via /api/geo (and cached there in the SQLite geocache
 * table), but the browser never keeps them. So offline the map had nothing to
 * draw and fell back to "Could not look up those places", even though the
 * server had known the answer all along.
 *
 * This persists the resolved points in localStorage, keyed by the normalised
 * query the API returns, so a trip that has been viewed once can still draw its
 * map with no connection. That is the whole point of the feature: the map and
 * the booking references are what you actually want at the airport.
 *
 * Keyed by query rather than by trip on purpose — a location like "Munich
 * Airport" is shared across trips, and the coordinates are a property of the
 * place, not of the trip.
 */

const KEY = "trip-packer:geocache:v1";

/*
 * The /api/geo response keys queries in lower case, while the map asks about
 * the original strings ("Philadelphia" vs "philadelphia"). Normalise both
 * sides so a lookup cannot fail on casing alone.
 */
function norm(q: string): string {
  return q.trim().toLowerCase();
}

/*
 * Older entries were written under a context-augmented key of the form
 * "<location>\u0000<context>", because the server used to echo its internal
 * cache key back as the query. Those keys are still on disk for anyone who
 * used the app before that was fixed, and a plain lookup would miss them.
 *
 * Rather than migrate or drop them, fall back to any entry sharing the
 * location prefix. The coordinate is a property of the place, so a
 * context-resolved answer is the best one available offline.
 */
function findWithContextFallback(
  all: Record<string, LatLng>,
  key: string
): LatLng | undefined {
  const exact = all[key];
  if (exact) return exact;
  const prefix = `${key}\u0000`;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) return v;
  }
  return undefined;
}

export type LatLng = { lat: number; lng: number };

function read(): Record<string, LatLng> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, LatLng> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const p = v as Partial<LatLng>;
      // Guard against a corrupted or half-written entry.
      if (typeof p?.lat === "number" && typeof p?.lng === "number") {
        out[k] = { lat: p.lat, lng: p.lng };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Coordinates for these queries that we already know, offline included. */
export function readCachedCoords(queries: string[]): Map<string, LatLng> {
  const all = read();
  const out = new Map<string, LatLng>();
  for (const q of queries) {
    const hit = findWithContextFallback(all, norm(q));
    if (hit) out.set(q, hit);
  }
  return out;
}

/** Remember resolved coordinates. Never throws. */
export function writeCachedCoords(points: { query: string; lat: number; lng: number }[]) {
  if (typeof window === "undefined") return;
  try {
    const all = read();
    let changed = false;
    for (const p of points) {
      // Skip anything malformed rather than poisoning the cache.
      if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const k = norm(p.query);
      const prev = all[k];
      if (!prev || prev.lat !== p.lat || prev.lng !== p.lng) {
        all[k] = { lat: p.lat, lng: p.lng };
        changed = true;
      }
    }
    if (changed) window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Quota or unavailable storage. The map still works online.
  }
}
