import { NextResponse } from "next/server";

import { tx } from "@/lib/db";
import { getActingUser } from "@/lib/session";
import { sanitizeBatch } from "@/lib/metrics";
import { clientIpFrom, takeLoginToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/*
 * POST /api/metrics — record a batch of usage events.
 *
 * Deliberately UNAUTHENTICATED. The most interesting question this table can
 * answer is "did anyone who is NOT already a user show up", which is exactly
 * the population that has no session. Requiring auth would leave the funnel
 * with its top cut off and the landing page invisible.
 *
 * That means this endpoint is an open write. It is therefore bounded three
 * ways, because an unbounded open write on the same SQLite connection as real
 * data is a denial-of-service on the app itself:
 *
 *   1. Batch cap (MAX_BATCH in lib/metrics.ts), enforced before any row work.
 *   2. A name allowlist, so an attacker cannot create arbitrary series.
 *   3. The same IP rate limiter the login route uses. Reusing it rather than
 *      inventing a second mechanism is deliberate: one lockout policy, one
 *      place to reason about it.
 *
 * Nothing in the request body is echoed back, and nothing identifying is
 * stored. See the schema comment in db.ts for what that means concretely.
 */

/** Rate-limit key namespace, so metrics traffic cannot spend the login budget. */
const RATE_KEY_PREFIX = "metrics:";

export async function POST(request: Request) {
  try {
    // One token per request from a bucket per IP. Separate namespace from
    // logins on purpose: sharing `takeLoginToken`'s store is fine and keeps one
    // limiter implementation, but sharing a KEY would let a busy app session
    // drain the budget that protects sign-in — or, worse, let someone flush
    // telemetry to lock a real user out of logging in.
    const ip = clientIpFrom(request.headers);
    if (!takeLoginToken(`${RATE_KEY_PREFIX}${ip}`)) {
      return NextResponse.json({ ok: true, recorded: 0 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: true, recorded: 0 });
    }

    const payload = body as { events?: unknown } | null;
    const { events, rejected } = sanitizeBatch(payload?.events);

    if (rejected > 0) {
      // Log a count, never the payload: the whole point of this table is that
      // unknown shapes do not get persisted, so they must not get logged
      // either.
      console.warn(`[api/metrics] dropped ${rejected} invalid event(s)`);
    }

    if (events.length === 0) {
      return NextResponse.json({ ok: true, recorded: 0 });
    }

    /*
     * Attribute to the acting user when there is one. A failure here must not
     * lose the events: attribution is a nice-to-have, and an anonymous row is
     * still a valid count. Same reasoning as the session lookup being inside
     * its own guard rather than the outer try.
     */
    let userId: string | null = null;
    try {
      const actor = await getActingUser();
      userId = actor?.id ?? null;
    } catch {
      userId = null;
    }

    tx.recordMetrics(
      events.map((e) => ({
        name: e.name,
        userId,
        sessionId: e.sessionId,
        meta: e.meta,
      }))
    );

    return NextResponse.json({ ok: true, recorded: events.length });
  } catch (err) {
    console.error("[api/metrics] failed:", err);
    // Always 200. Telemetry must never surface as an error the user can see,
    // and the client cannot act on a failure anyway.
    return NextResponse.json({ ok: false, recorded: 0 });
  }
}
