import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { tx } from "@/lib/db";

/*
 * Share-link management.
 *
 * Deliberately separate from /api/mutate: that endpoint returns the entire app
 * state, which must never be reachable with a share token. Keeping share
 * operations on their own route means the public read path cannot accidentally
 * inherit a state-dumping response.
 *
 * This route manages *links* and therefore stays behind the normal app
 * boundary — only /api/shared/[token] is public.
 */

/** GET /api/share?tripId=... — list active links for a trip. */
export async function GET(req: Request) {
  const tripId = new URL(req.url).searchParams.get("tripId");
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ tokens: tx.listShareTokens(tripId) });
  } catch (err) {
    console.error("[api/share] list failed:", err);
    return NextResponse.json({ error: "Could not load share links" }, { status: 500 });
  }
}

/** POST /api/share — create a link. */
export async function POST(req: Request) {
  let body: { tripId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tripId } = body;
  if (!tripId) {
    return NextResponse.json({ error: "tripId required" }, { status: 400 });
  }

  try {
    const token = randomUUID();
    tx.createShareToken(token, tripId);
    return NextResponse.json({ token, tokens: tx.listShareTokens(tripId) });
  } catch (err) {
    console.error("[api/share] create failed:", err);
    return NextResponse.json({ error: "Could not create share link" }, { status: 500 });
  }
}

/** DELETE /api/share?tripId=...&token=... — revoke one link. */
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  const tripId = params.get("tripId");
  const token = params.get("token");
  if (!tripId || !token) {
    return NextResponse.json({ error: "tripId and token required" }, { status: 400 });
  }
  try {
    tx.deleteShareToken(token, tripId);
    return NextResponse.json({ tokens: tx.listShareTokens(tripId) });
  } catch (err) {
    console.error("[api/share] revoke failed:", err);
    return NextResponse.json({ error: "Could not revoke share link" }, { status: 500 });
  }
}
