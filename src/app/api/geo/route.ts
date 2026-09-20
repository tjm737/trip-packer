import { NextResponse } from "next/server";

import { geocodeMany } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/geo
 *
 * Body: { locations: string[], contexts?: Record<string, string> }
 * Returns: { points: GeoPoint[], unresolved: string[] }
 *
 * `contexts` maps a location string to extra text that disambiguates it — a
 * reservation's title, typically. "Terminal 5" is a fragment that Nominatim
 * resolves to a nightclub in Manhattan; paired with its title "Sofitel London
 * Heathrow" the same string resolves to the Heathrow terminal it means.
 *
 * The browser never calls Nominatim directly. Doing so would leak the user's
 * IP to a third party, bypass the SQLite cache, and make it impossible to
 * enforce the one-request-per-second limit across concurrent tabs.
 */
export async function POST(req: Request) {
  let body: { locations?: unknown; contexts?: unknown };

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

  // Accept only string values; anything else is a malformed client.
  const contexts: Record<string, string> = {};
  if (body.contexts && typeof body.contexts === "object") {
    for (const [k, v] of Object.entries(body.contexts as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) contexts[k] = v;
    }
  }

  if (locations.length === 0) {
    return NextResponse.json({ points: [], unresolved: [] });
  }

  const { points, unresolved } = await geocodeMany(locations, contexts);
  return NextResponse.json({ points, unresolved });
}
