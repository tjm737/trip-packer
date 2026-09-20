import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/route
 *
 * Body: { hops: { from: {lat,lng}, to: {lat,lng} }[] }
 * Returns: { legs: { distanceM, durationS, geometry }[] }
 *
 * Each hop is routed independently rather than as one multi-waypoint request.
 * A single request fails outright — "Impossible route between points" — as soon
 * as one hop crosses an ocean or lies outside the routing data, which would
 * discard every other leg too. Asking per hop means an unroutable leg is simply
 * absent from the response while its neighbours still resolve.
 *
 * Flights are not sent here at all: the client draws those as great-circle
 * arcs, since no router can produce them.
 *
 * Results are returned in request order, so the caller can zip them back onto
 * the hops it asked about.
 */

type Point = { lat: number; lng: number };

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/** Beyond this, a "leg" is almost certainly two unrelated places. */
const MAX_LEG_M = 5_000_000;

function isValidPoint(p: unknown): p is Point {
  if (!p || typeof p !== "object") return false;
  const { lat, lng } = p as Record<string, unknown>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry?: { coordinates?: [number, number][] };
};

async function routeHop(from: Point, to: Point): Promise<{
  distanceM: number;
  durationS: number;
  geometry: [number, number][];
} | null> {
  // OSRM wants lng,lat — the opposite of Leaflet and of our own types.
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "trip-packer/1.0" },
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { code?: string; routes?: OsrmRoute[] };
  if (data.code !== "Ok" || !data.routes?.length) return null;

  const route = data.routes[0];
  if (typeof route.distance !== "number" || route.distance > MAX_LEG_M) return null;

  // GeoJSON is [lng, lat]; flip to [lat, lng] for Leaflet.
  const geometry = (route.geometry?.coordinates ?? []).map(
    ([lng, lat]) => [lat, lng] as [number, number]
  );

  return {
    distanceM: route.distance,
    durationS: typeof route.duration === "number" ? route.duration : 0,
    geometry,
  };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = (body as { hops?: unknown })?.hops;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "hops must be an array" }, { status: 400 });
  }
  if (raw.length > 60) {
    return NextResponse.json({ error: "Too many hops" }, { status: 400 });
  }

  const hops = raw.map((h) => {
    const { from, to } = (h ?? {}) as { from?: unknown; to?: unknown };
    return isValidPoint(from) && isValidPoint(to) ? { from, to } : null;
  });

  if (hops.some((h) => h === null)) {
    return NextResponse.json({ error: "Each hop needs valid from/to points" }, { status: 400 });
  }

  /*
   * Routing is best-effort by design. A hop with no drivable route (a flight,
   * a ferry, or somewhere the routing graph does not reach) yields null rather
   * than failing the whole request, and the client renders it as not drivable.
   *
   * Requests are sequential, not parallel: the public OSRM instance is a
   * shared demo server and hammering it with a burst of concurrent requests
   * is how clients get rate-limited.
   */
  const legs: (Awaited<ReturnType<typeof routeHop>>)[] = [];
  for (const hop of hops as { from: Point; to: Point }[]) {
    try {
      legs.push(await routeHop(hop.from, hop.to));
    } catch {
      legs.push(null); // timeout or network failure: treat as unroutable
    }
  }

  const resolved = legs.filter((l): l is NonNullable<typeof l> => l !== null);

  return NextResponse.json(
    {
      legs: resolved,
      /** Indices (into the request array) that produced no driving route. */
      unroutable: legs.map((l, i) => (l === null ? i : -1)).filter((i) => i >= 0),
      warning: resolved.length === 0 ? "No driving routes available" : undefined,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
