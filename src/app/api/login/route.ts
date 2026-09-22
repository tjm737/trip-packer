import { NextResponse } from "next/server";

import { tx } from "@/lib/db";
import {
  SESSION_TTL_MS,
  clientIpFrom,
  createSessionToken,
  isLockedOut,
  nextFailureState,
  retryAfterSeconds,
  serializeSessionCookie,
  takeLoginToken,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/*
 * POST /api/login — exchange email + password for a session cookie.
 *
 * Three properties this endpoint is responsible for:
 *
 * 1. It must not reveal whether an email is registered. "No such account" and
 *    "wrong password" return the same body and status, so the endpoint cannot
 *    be used to enumerate accounts. The timing differs slightly (a real account
 *    runs PBKDF2, a missing one does not), which is a known and accepted
 *    limitation for this app rather than an oversight.
 *
 * 2. Failure counting is per email, not per IP. A per-IP counter would let one
 *    attacker lock out everyone behind a shared address, and would not stop a
 *    distributed attempt against a single account.
 *
 * 3. There is ALSO a per-IP token bucket (see takeLoginToken in lib/auth).
 *    Those two limits do different jobs and both are needed: per-email caps
 *    guesses against one account, per-IP caps total request volume. Without the
 *    second, an attacker sprays one guess across thousands of addresses and
 *    never trips a per-email counter.
 */

/** The single response for every authentication failure. */
const REJECTED = { error: "Invalid email or password" };

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(REJECTED, { status: 401 });
  }

  try {
    /*
     * Global per-IP limit, checked BEFORE the per-email counter and before
     * PBKDF2 runs. Ordering matters: this is the cheap check, and putting it
     * first means a flood costs a Map lookup instead of a 600,000-iteration
     * hash. It also means an attacker cannot use the endpoint as a CPU
     * amplifier by pricing each request in milliseconds of server work.
     */
    const ip = clientIpFrom(request.headers);
    if (!takeLoginToken(ip)) {
      const retry = retryAfterSeconds(ip);
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.max(retry, 1)) } }
      );
    }

    const attempts = tx.getLoginAttempts(email);
    if (attempts && isLockedOut(attempts.failures, attempts.lastFailedAt)) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }

    const user = tx.getUserByEmail(email);

    // A missing account and a wrong password must take the same path. The
    // short-circuit keeps `user` narrowed below without a non-null assertion.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const next = nextFailureState(
        attempts ? { failures: attempts.failures, firstFailedAt: attempts.firstFailedAt } : null
      );
      const nowIso = new Date().toISOString();
      tx.recordLoginFailure(email, next.failures, next.firstFailedAt, nowIso);
      return NextResponse.json(REJECTED, { status: 401 });
    }

    // Success clears the counter, so a legitimate login resets the window.
    tx.clearLoginAttempts(email);

    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    tx.insertSession(tokenHash, user.id, expiresAt);

    const secure = new URL(request.url).protocol === "https:";
    const response = NextResponse.json({
      ok: true,
      user: { id: user.id, name: user.name, isOwner: Boolean(user.isOwner) },
    });

    // The cookie is httpOnly so a script on the page cannot read the token,
    // sameSite=lax so a cross-site form post cannot authenticate as the user.
    // maxAge matches the server-side session TTL: if the cookie outlived the
    // row, the client would present a token that can never be valid.
    const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(token, maxAgeSeconds, secure)
    );
    return response;
  } catch (err) {
    console.error("[api/login] failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}

/** Exported for a smoke test that the import graph is intact. */
