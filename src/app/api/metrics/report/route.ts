import { NextResponse } from "next/server";

import { tx } from "@/lib/db";
import { getActingUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/*
 * GET /api/metrics?days=7 — the read side.
 *
 * Admin-only. The counts themselves are anonymised, but the aggregate is still
 * a picture of how the product is used and there is no reason for a regular
 * account to see it. `isOwner` is the same check the account-creation UI uses,
 * so there is one definition of "admin" in the app rather than a new one here.
 *
 * Defaults to 7 days: long enough to see a week's rhythm, short enough that the
 * numbers reflect the current build rather than every version ever shipped.
 */

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

export async function GET(request: Request) {
  try {
    const actor = await getActingUser();
    if (!actor?.isOwner) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const rawDays = Number(url.searchParams.get("days"));
    const days = Number.isFinite(rawDays)
      ? Math.min(Math.max(Math.trunc(rawDays), 1), MAX_DAYS)
      : DEFAULT_DAYS;

    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const events = tx.countMetricsSince(since);
    const sessions = tx.countSessionsSince(since);

    return NextResponse.json({
      ok: true,
      days,
      since,
      sessions,
      events,
    });
  } catch (err) {
    console.error("[api/metrics] report failed:", err);
    return NextResponse.json({ error: "Report failed" }, { status: 500 });
  }
}
