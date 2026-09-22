"use client";

/*
 * Client-side cache of driving legs between stops.
 *
 * Why this is needed: coordinates were already persisted (see geoCache.ts), so
 * offline the map could still draw its pins. The driving legs were not, so the
 * route lines and every "55.9 mi · 1h 22m drive" figure disappeared the moment
 * the connection dropped.
 *
 * That is precisely the wrong thing to lose. The pins alone tell you where the
 * stops are; the drive figures tell you how long the next leg takes, which is
 * the part you actually want offline — standing at Keflavík working out whether
 * the guesthouse is twenty minutes away or two hours.
 *
 * Keyed by the hop itself ("from|to", rounded), not by trip. A drive between
 * two places is a property of those places, so a leg cached for one trip is
 * reused by any other trip that covers the same hop, and editing an unrelated
 * stop does not invalidate every leg in the trip.
 *
 * The rounding is load-bearing. Coordinates come back from geocoding as floats
 * and can shift in the last decimal place between runs (a re-geocode once moved
 * a stop and changed the drive total from 131.0 to 128.9 mi). Keying on the raw
 * float would make the cache miss on exactly those runs, so keys snap to ~11 m.
 */

export type CachedLeg = {
  distanceM: number;
  durationS: number;
  geometry: [number, number][];
};

const KEY = "trip-packer:legcache:v1";

/** ~11 m at the equator — far tighter than any meaningful route difference. */
const PRECISION = 4;

function round(n: number): number {
  return Number(n.toFixed(PRECISION));
}

/** Stable identity for a hop. Order matters: A→B is not B→A. */
export function legKey(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): string {
  return `${round(from.lat)},${round(from.lng)}|${round(to.lat)},${round(to.lng)}`;
}

function read(): Record<string, CachedLeg> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, CachedLeg> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const l = v as Partial<CachedLeg>;
      // Guard against a corrupted or half-written entry.
      if (
        typeof l?.distanceM === "number" &&
        typeof l?.durationS === "number" &&
        Array.isArray(l?.geometry)
      ) {
        out[k] = {
          distanceM: l.distanceM,
          durationS: l.durationS,
          geometry: l.geometry as [number, number][],
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Legs for these hops that we already know, offline included.
 *
 * Returns a Map keyed by hop index, mirroring the order of `hops` so the caller
 * can apply the same fromIndex/toIndex mapping it uses for a live response.
 */
export function readCachedLegs(
  hops: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }[]
): Map<number, CachedLeg> {
  const all = read();
  const out = new Map<number, CachedLeg>();
  hops.forEach((h, i) => {
    const hit = all[legKey(h.from, h.to)];
    if (hit) out.set(i, hit);
  });
  return out;
}

/** Remember resolved legs. Never throws. */
export function writeCachedLegs(
  hops: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }[],
  legs: CachedLeg[]
) {
  if (typeof window === "undefined") return;
  try {
    const all = read();
    let changed = false;
    legs.forEach((leg, i) => {
      const hop = hops[i];
      if (!hop) return;
      if (
        typeof leg.distanceM !== "number" ||
        typeof leg.durationS !== "number" ||
        !Array.isArray(leg.geometry)
      ) {
        return;
      }
      const k = legKey(hop.from, hop.to);
      const prev = all[k];
      /*
       * Geometry is large and OSRM is deterministic for the same input, so skip
       * the write when nothing meaningful changed — otherwise every map visit
       * rewrites the whole cache and churns the quota.
       */
      if (
        prev &&
        prev.distanceM === leg.distanceM &&
        prev.durationS === leg.durationS &&
        prev.geometry.length === leg.geometry.length
      ) {
        return;
      }
      all[k] = {
        distanceM: leg.distanceM,
        durationS: leg.durationS,
        geometry: leg.geometry,
      };
      changed = true;
    });
    if (changed) window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Quota or unavailable storage. Routes still work online.
  }
}
