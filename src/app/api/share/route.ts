import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readState, tx } from "@/lib/db";
import { getActingUser } from "@/lib/session";
import { assertCanWriteTrip } from "@/lib/access";
import { normalizeVisibility } from "@/lib/shareVisibility";

/*
 * Share-link management.
 *
 * Deliberately separate from /api/mutate: that endpoint returns the entire app
 * state, which must never be reachable with a share token. Keeping share
 * operations on their own route means the public read path cannot accidentally
 * inherit a state-dumping response.
 *
 * This route manages *links* and is therefore NOT public. Only
 * /api/shared/[token] is unauthenticated. Every handler here enforces two
 * things, in this order:
 *
 *   1. There is a valid session (getActingUser).
 *   2. The session's user may WRITE the trip in question (assertCanWriteTrip).
 *
 * Both are load-bearing and neither is optional. Without (1) anyone on the
 * internet can mint a link; without (2) any signed-in user can mint a link to
 * any other user's trip, which is the same disclosure one step removed. Sharing
 * is a write operation on the trip — it changes who can read it — so it takes
 * the write permission, not merely "is signed in".
 *
 * A viewer member is deliberately refused: they were granted read access to
 * someone else's trip, and letting them re-share it would let a viewer escalate
 * to granting access to third parties without the owner knowing.
 */

type Guard =
  | { ok: true; tripId: string }
  | { ok: false; response: NextResponse };

/**
 * Narrow the guard union to its failure branch.
 *
 * A plain `if (!guard.ok)` does not narrow a union whose members both declare
 * `ok` as a literal here, because the discriminant is only usable when TS can
 * prove the negation excludes the success member. Routing through a predicate
 * makes the intent explicit and keeps the call sites free of casts.
 */
function isFailure(g: Guard): g is { ok: false; response: NextResponse } {
  return g.ok === false;
}

/**
 * Resolve and authorize the trip named by `tripId`.
 *
 * Returns the same 403 for "no such trip" and "not yours", so a caller cannot
 * enumerate trip ids by comparing status codes. 403 rather than 404 for the
 * signed-out case is intentional: the caller is authenticated but not allowed,
 * which is exactly what 403 means.
 */
async function authorizeTrip(tripId: string | null): Promise<Guard> {
  if (!tripId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "tripId required" }, { status: 400 }),
    };
  }

  const actor = await getActingUser();
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sign in required" }, { status: 401 }),
    };
  }

  const state = readState();
  if (!state) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not allowed" }, { status: 403 }),
    };
  }

  // Collapses "unknown trip" and "no permission" into one response on purpose.
  if (!assertCanWriteTrip(state, actor.id, tripId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not allowed" }, { status: 403 }),
    };
  }

  return { ok: true, tripId };
}

/** GET /api/share?tripId=... — list active links for a trip. */
export async function GET(req: Request) {
  const tripId = new URL(req.url).searchParams.get("tripId");
  const guard = await authorizeTrip(tripId);
  if (isFailure(guard)) return guard.response;

  try {
    return NextResponse.json({ tokens: tx.listShareTokens(guard.tripId) });
  } catch (err) {
    console.error("[api/share] list failed:", err);
    return NextResponse.json({ error: "Could not load share links" }, { status: 500 });
  }
}

/** POST /api/share — create a link. */
export async function POST(req: Request) {
  let body: { tripId?: string; visibility?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const guard = await authorizeTrip(body.tripId ?? null);
  if (isFailure(guard)) return guard.response;

  try {
    const token = randomUUID();
    /*
     * `normalizeVisibility` is the only thing that decides what a legal setting
     * looks like: unknown keys are dropped, non-booleans are ignored, and
     * `itinerary` is forced on. Passing the raw body through would let a
     * hand-crafted request store a shape the public endpoint cannot render.
     */
    tx.createShareToken(token, guard.tripId, normalizeVisibility(body.visibility));
    return NextResponse.json({ token, tokens: tx.listShareTokens(guard.tripId) });
  } catch (err) {
    console.error("[api/share] create failed:", err);
    return NextResponse.json({ error: "Could not create share link" }, { status: 500 });
  }
}

/**
 * PATCH /api/share — change what an existing link reveals.
 *
 * Same authorization as every other handler here: a valid session that may write
 * the trip. Editing visibility is a write to the trip's exposure, so it takes the
 * write permission rather than merely being signed in — and a viewer is refused
 * for the same reason they cannot create a link.
 */
export async function PATCH(req: Request) {
  let body: { tripId?: string; token?: string; visibility?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const guard = await authorizeTrip(body.tripId ?? null);
  if (isFailure(guard)) return guard.response;

  if (!body.token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  try {
    /*
     * The update is scoped to the authorized trip, so a token belonging to
     * another trip cannot be retuned even by someone who can write this one —
     * the same protection DELETE relies on. `changes === 0` means the token does
     * not belong to this trip (or was revoked a moment ago); reporting it is
     * better than returning a refreshed list that silently lacks the edit.
     */
    const changed = tx.updateShareTokenVisibility(
      body.token,
      guard.tripId,
      normalizeVisibility(body.visibility)
    );
    if (changed === 0) {
      return NextResponse.json({ error: "That link no longer exists" }, { status: 404 });
    }
    return NextResponse.json({ tokens: tx.listShareTokens(guard.tripId) });
  } catch (err) {
    console.error("[api/share] update failed:", err);
    return NextResponse.json({ error: "Could not update share link" }, { status: 500 });
  }
}

/** DELETE /api/share?tripId=...&token=... — revoke one link. */
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  const guard = await authorizeTrip(params.get("tripId"));
  if (isFailure(guard)) return guard.response;

  const token = params.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  try {
    // Scoped to the authorized trip, so a token belonging to a different trip
    // cannot be revoked even by someone who can write this one.
    tx.deleteShareToken(token, guard.tripId);
    return NextResponse.json({ tokens: tx.listShareTokens(guard.tripId) });
  } catch (err) {
    console.error("[api/share] revoke failed:", err);
    return NextResponse.json({ error: "Could not revoke share link" }, { status: 500 });
  }
}
