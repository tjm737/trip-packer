import { NextResponse } from "next/server";

import { readState } from "@/lib/db";
import { scopeStateForUser } from "@/lib/access";
import { getActingUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/*
 * GET /api/state — the single read endpoint the client hydrates from.
 *
 * Returns `{ state: null }` rather than 404 when the database is empty, so the
 * client can tell "no data yet, initialize me" apart from "the server is
 * broken" without inspecting status codes.
 *
 * The response is scoped to the authenticated user. This endpoint previously
 * returned readState() verbatim with no session check at all, which meant any
 * caller who could reach the URL received every account and every trip in the
 * database. Scoping here is what bounds the exposure.
 */
export async function GET() {
  try {
    const actor = await getActingUser();
    if (!actor) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const state = readState();
    if (!state) {
      // Empty database. A fresh install has no accounts, and no session can
      // exist without an account, so this is unreachable while authenticated —
      // but returning null is still the honest answer rather than an error.
      return NextResponse.json({ state: null });
    }

    const scoped = scopeStateForUser(state, actor.id);
    if (!scoped) {
      return NextResponse.json({ error: "Not permitted" }, { status: 403 });
    }

    return NextResponse.json({ state: scoped });
  } catch (err) {
    console.error("[api/state] read failed:", err);
    return NextResponse.json({ error: "Failed to read state" }, { status: 500 });
  }
}
