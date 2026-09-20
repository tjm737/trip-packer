import { NextResponse } from "next/server";

import { geocodeMany } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/geo
 *
 * Body: { locations: string[] }
 * Returns: { points: GeoPoint[], unresolved: string[] }
 *
 * The browser never calls Nominatim directly. Doing so would leak the user's
 * IP to a third party, bypass the SQLite cache, and make it impossible to
 * enforce the one-request-per-second limit across concurrent tabs.
 */
export async function POST(req: Request) {
  let body: { locations?: unknown };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.locations)) {
    return NextResponse.json({ error: "locations must be an array" }, { status: 400 });
  }

  const locations = body.locations
    .filter((l): l is string => typeof l === "string")
    .slice(0, 50); // defensive cap; a trip will never legitimately exceed this

  if (locations.length === 0) {
    return NextResponse.json({ points: [], unresolved: [] });
  }

  const { points, unresolved } = await geocodeMany(locations);
  return NextResponse.json({ points, unresolved });
}
