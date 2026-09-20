import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/route
 *
 * Body: { waypoints: { lat, lng }[] }
 * Returns: { legs: [{ fromIndex, toIndex, distanceM, durationS, geometry }] }
 *
 * Uses the public OSRM demo server to measure driving legs between consecutive
 * stops.
 *
 * Two important properties of that server shape this file:
 *
 *   1. It routes each leg independently rather than asking for one route
 *      through every waypoint. A single multi-waypoint request fails entirely
 *      with "Impossible route between points" as soon as one hop crosses an
 *      ocean — which is exactly what a flight between continents does. Routing
 *      per leg means the drivable hops still resolve while the flight is
 *      cleanly skipped.
 *
 *   2. Coverage is regional rather than global, so a leg may legitimately have
 *      no route. That is not an error: the client simply draws no line for it.
 *
 * Requests are proxied through the server so the user's IP stays off
 * third-party logs and the upstream URL lives in one place, ready to be
 * swapped for a self-hosted OSRM later.
 *
 * OSRM takes coordinates as lng,lat — the reverse of the order used almost
 * everywhere else, and a classic source of transposed, silently-wrong routes.
 */

const OSRM = "https://router.project-osrm.org/route/v1/driving";

type Waypoint = { lat: number; lng: number };

type OsrmResponse = {
  code: string;
  routes?: {
    distance: number;
    duration: number;
    geometry?: { coordinates: [number, number][] };
  }[];
};

/** Measure one driving leg. Returns null when no route exists. */
async function routeLeg(
  from: Waypoint,
  to: Waypoint
): Promise<{ distanceM: number; durationS: number; geometry: [number, number][] } | null> {
  const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null; // NoRoute, or upstream trouble

    const data = (await res.json()) as OsrmResponse;
    if (data.code !== "Ok" || !data.routes?.length) return null;

    const route = data.routes[0];
    const geometry: [number, number][] = (route.geometry?.coordinates ?? []).map(
      ([lng, lat]) => [lat, lng] as [number, number]
    );

    return { distanceM: route.distance, durationS: route.duration, geometry };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { waypoints?: unknown };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.waypoints)) {
    return NextResponse.json({ error: "waypoints must be an array" }, { status: 400 });
  }

  const waypoints = body.waypoints.filter(
    (w): w is Waypoint =>
      typeof w === "object" &&
      w !== null &&
      Number.isFinite((w as Waypoint).lat) &&
      Number.isFinite((w as Waypoint).lng)
  );

  if (waypoints.length < 2) return NextResponse.json({ legs: [] });
  if (waypoints.length > 25) {
    return NextResponse.json({ error: "Too many waypoints" }, { status: 400 });
  }

  // Legs are independent, so fetch them concurrently. The demo server is not
  // rate-limited the way Nominatim is, and a 6-stop trip is only 5 requests.
  const results = await Promise.all(
    waypoints.slice(0, -1).map((from, i) => routeLeg(from, waypoints[i + 1]))
  );

  const legs = results
    .map((r, i) =>
      r
        ? {
            fromIndex: i + 1,
            toIndex: i + 2,
            distanceM: r.distanceM,
            durationS: r.durationS,
            geometry: r.geometry,
          }
        : null
    )
    .filter((l): l is NonNullable<typeof l> => l !== null);

  return NextResponse.json({ legs });
}
