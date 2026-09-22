import { NextResponse } from "next/server";

import { tx } from "@/lib/db";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  hashSessionToken,
  readCookie,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/*
 * POST /api/logout — revoke the current session.
 *
 * The session row is deleted, not just the cookie. Clearing only the cookie
 * would leave a valid token in the database: anyone who had captured it could
 * keep using it, and a "logged out" device would still hold a working
 * credential if the cookie were restored from a backup or an old tab.
 *
 * Always reports success. A caller cannot distinguish "your session was
 * revoked" from "there was no session", which avoids turning this into an
 * oracle for whether a token was valid.
 */
export async function POST(request: Request) {
  try {
    const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
    if (token) {
      // Deleted by hash, matching how the row was stored. The raw token is
      // never persisted, so it cannot be used directly as a lookup key.
      tx.deleteSessionByTokenHash(hashSessionToken(token));
    }

    const secure = new URL(request.url).protocol === "https:";
    const response = NextResponse.json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie(secure));
    return response;
  } catch (err) {
    console.error("[api/logout] failed:", err);
    // Still clear the cookie: a client that cannot drop its token would retry
    // forever, and the failure is server-side rather than a bad request.
    const secure = new URL(request.url).protocol === "https:";
    const response = NextResponse.json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie(secure));
    return response;
  }
}
