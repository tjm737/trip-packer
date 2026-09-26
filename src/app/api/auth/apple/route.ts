import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  SESSION_TTL_MS,
  clientIpFrom,
  createSessionToken,
  retryAfterSeconds,
  serializeSessionCookie,
  sessionExpiry,
  takeLoginToken,
} from "@/lib/auth";
import {
  claimIsTrue,
  fetchAppleKeys,
  verifyAppleIdentityToken,
} from "@/lib/appleAuth";
import { resolveAccount } from "@/lib/appleAccount";
import { AVATAR_COLORS } from "@/lib/constants";
import { tx } from "@/lib/db";

/*
 * Sign in with Apple.
 *
 * The client posts the `identityToken` it got from ASAuthorization, plus the
 * name Apple only hands over on FIRST authorisation. Everything else is
 * derived server-side.
 *
 * The one rule this file exists to enforce: nothing in the request body is
 * believed until the token's signature has been checked against Apple's
 * published keys. The body is attacker-controlled text. Without verification,
 * `{"identityToken":"{\"sub\":\"<victim>\"}"}` would be a complete
 * authentication bypass, so `verifyAppleIdentityToken` runs before any account
 * is read or written, and every field the resolver uses comes from the VERIFIED
 * payload rather than from the request.
 *
 * Deliberately NOT rate-limited per-email like /api/login: there is no email
 * guess to throttle, and a valid token cannot be brute-forced by trying
 * passwords. The per-IP token bucket is kept because the endpoint does a
 * network fetch to Apple, which makes it a cheap way to make the server do
 * outbound work.
 */

/** The audience an identity token must carry: one of our own app identifiers. */
function appleAudience(): string {
  /*
   * A token minted for a different app must not authenticate here, so the
   * audience is checked against our own identifiers. APPLE_APP_ID covers the
   * bundle id (native Sign in with Apple); APPLE_SERVICES_ID covers web sign-in,
   * which uses a Services ID. Either may be unset.
   *
   * Falling back to the bundle id rather than to "no check": a missing
   * configuration must not silently disable the audience requirement, or a
   * token issued to a different app would authenticate here.
   */
  const configured = [process.env.APPLE_APP_ID, process.env.APPLE_SERVICES_ID].find(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );
  return configured ? configured.trim() : "com.tylermorgan.tripplanner";
}

type AppleBody = {
  identityToken?: unknown;
  /** Apple's `fullName`, only present on the very first authorisation. */
  fullName?: unknown;
};

/** Apple sends { givenName, familyName } (or null). Join them, or null. */
function nameFromApple(fullName: unknown): string | null {
  if (!fullName || typeof fullName !== "object") return null;
  const f = fullName as { givenName?: unknown; familyName?: unknown };
  const parts = [f.givenName, f.familyName]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v !== "");
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function POST(request: Request) {
  try {
    const ip = clientIpFrom(request.headers);
    if (!takeLoginToken(ip)) {
      const retry = retryAfterSeconds(ip);
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.max(retry, 1)) } }
      );
    }

    let body: AppleBody;
    try {
      body = (await request.json()) as AppleBody;
    } catch {
      return NextResponse.json({ error: "Malformed request" }, { status: 400 });
    }

    if (typeof body.identityToken !== "string" || body.identityToken === "") {
      return NextResponse.json({ error: "Missing identity token" }, { status: 400 });
    }

    // Fetch Apple's keys and verify. Any failure here is generic on purpose:
    // distinguishing "bad signature" from "expired" from "wrong audience"
    // tells an attacker which part of a forged token to fix next.
    let verified;
    try {
      const keys = await fetchAppleKeys();
      verified = verifyAppleIdentityToken(body.identityToken, keys, appleAudience());
    } catch (err) {
      console.error("[api/auth/apple] key fetch failed:", err);
      return NextResponse.json({ error: "Could not verify Apple sign-in" }, { status: 401 });
    }

    if (!verified.ok) {
      // Logged, never returned. Telling a caller whether the signature, the
      // issuer, the audience, or the expiry was wrong is a map of which part of
      // a forged token to fix next.
      console.error("[api/auth/apple] rejected:", verified.reason);
      return NextResponse.json({ error: "Could not verify Apple sign-in" }, { status: 401 });
    }

    const { sub, email } = verified.payload;
    const emailVerified = claimIsTrue(verified.payload.email_verified);

    const accounts = tx.listAccounts();
    const decision = resolveAccount(
      accounts,
      sub,
      email ?? null,
      emailVerified,
      nameFromApple(body.fullName)
    );

    if (decision.action === "reject") {
      return NextResponse.json({ error: "Could not verify Apple sign-in" }, { status: 401 });
    }

    let userId: string;
    let name: string;
    let isOwner: boolean;

    if (decision.action === "sign-in") {
      userId = decision.account.id;
      isOwner = Boolean(decision.account.isOwner);

      /*
       * A sign-in that matched by email has not yet been bound to this Apple
       * subject. Bind it now so the next sign-in takes the `sub` path, which
       * is stable even if the user later changes their Apple ID's address.
       *
       * Guarded on `via === "verified-email"` so the sub path does not rewrite
       * a value with itself. A failure to bind is logged but not fatal — the
       * user is legitimately authenticated either way, and refusing the login
       * would be worse than retrying the bind next time.
       */
      if (decision.via === "verified-email") {
        try {
          tx.setAppleUserId(userId, sub);
        } catch (err) {
          console.error("[api/auth/apple] could not bind subject:", err);
        }
      }

      name = decision.account.name;
    } else {
      userId = randomUUID();
      const existingCount = accounts.length;
      name = decision.name;
      tx.insertAppleAccount({
        id: userId,
        name,
        /*
         * Reuse the profile colour palette by rotating through it on account
         * count, matching how the create-account CLI and the user.add op pick
         * a colour. Not random, so it is stable for a given database.
         */
        avatarColor: AVATAR_COLORS[existingCount % AVATAR_COLORS.length],
        createdAt: new Date().toISOString(),
        email: decision.email,
        appleUserId: decision.appleUserId,
      });
      /*
       * A brand-new account. It is never an owner: ownership is a property of
       * the person who set the instance up, and minting one here would let
       * anyone with an Apple ID take over the instance by registering.
       */
      isOwner = false;
    }

    const { token, tokenHash } = createSessionToken();
    tx.insertSession(tokenHash, userId, sessionExpiry());

    const secure = new URL(request.url).protocol === "https:";
    const response = NextResponse.json({
      ok: true,
      user: { id: userId, name, isOwner },
      /*
       * Tells the client whether this call CREATED the account, so the UI can
       * distinguish "welcome" from "welcome back". Nothing security-relevant
       * depends on it.
       */
      created: decision.action === "create",
    });

    const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
    response.headers.append(
      "Set-Cookie",
      serializeSessionCookie(token, maxAgeSeconds, secure)
    );
    return response;
  } catch (err) {
    console.error("[api/auth/apple] failed:", err);
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}

/** Exported for a smoke test that the import graph is intact. */
export const runtime = "nodejs";
