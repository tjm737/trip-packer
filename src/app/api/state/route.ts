import { NextResponse } from "next/server";

import { readState } from "@/lib/db";

export const dynamic = "force-dynamic";

/*
 * GET /api/state — the single read endpoint the client hydrates from.
 *
 * Returns `{ state: null }` rather than 404 when the database is empty, so the
 * client can tell "no data yet, initialize me" apart from "the server is
 * broken" without inspecting status codes.
 */
export async function GET() {
  try {
    return NextResponse.json({ state: readState() });
  } catch (err) {
    console.error("[api/state] read failed:", err);
    return NextResponse.json({ error: "Failed to read state" }, { status: 500 });
  }
}
