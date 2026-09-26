import { createPublicKey, createVerify } from "node:crypto";

/*
 * Apple identity-token verification.
 *
 * The client (native Sign in with Apple) hands the server a JWT signed by
 * Apple. NOTHING in that token may be trusted until the signature has been
 * verified against Apple's published public keys. A client that simply posts
 * `{ appleUserId: "000123.abc" }` can claim to be anyone: the value is a
 * string, and strings are forgeable. Signature verification is the entire
 * difference between authentication and an open door.
 *
 * This module is deliberately free of I/O. `verifyIdentityToken` takes the
 * already-fetched JWKS, so every claim check is testable without a network or
 * a clock, and the fetch/cache lives in the caller (see appleKeys.ts).
 *
 * Why not a JWT library: this is one algorithm (RS256) with a fixed issuer and
 * audience. Hand-rolling ~60 lines against node:crypto is smaller than a
 * dependency and keeps the security-critical path in-repo where it can be read
 * and tested directly.
 */

/** Apple's issuer claim. Exact match required. */
export const APPLE_ISSUER = "https://appleid.apple.com";

/** A JWK, narrowed to the fields this module actually reads. */
export type ApplePublicKey = {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

export type AppleIdentityPayload = {
  /** Stable, per-team user identifier. This is the primary key for an account. */
  sub: string;
  /** The user's email. May be a private relay address. */
  email?: string;
  /** True when `email` is an Apple private relay address. */
  email_verified?: boolean | string;
  /** Present only on the FIRST authorisation for a given app+user pair. */
  is_private_email?: boolean | string;
  aud?: string;
  iss?: string;
  exp?: number;
  iat?: number;
};

export type VerifyResult =
  | { ok: true; payload: AppleIdentityPayload }
  | { ok: false; reason: string };

type JwtParts = { header: Record<string, unknown>; payload: AppleIdentityPayload; signature: Buffer; signingInput: Buffer };

/*
 * A JWKS decode that refuses anything unexpected rather than coercing it.
 * `kty` must be RSA and both modulus and exponent must be present; a key missing
 * either cannot verify anything and should be skipped, not guessed at.
 */
export function publicKeyFromJwk(jwk: ApplePublicKey) {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || !jwk.kid) return null;
  try {
    return createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  } catch {
    return null;
  }
}

/** Split a JWT and decode the two JSON segments. Signature stays binary. */
export function decodeJwt(token: string): JwtParts | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: Record<string, unknown>;
  let payload: AppleIdentityPayload;
  try {
    header = JSON.parse(Buffer.from(rawHeader, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!header || typeof header !== "object") return null;
  if (!payload || typeof payload !== "object") return null;

  return {
    header,
    payload,
    signature: Buffer.from(rawSignature, "base64url"),
    signingInput: Buffer.from(`${rawHeader}.${rawPayload}`, "utf8"),
  };
}

/**
 * Verify signature and claims.
 *
 * `nowMs` is injectable so expiry behaviour is testable without waiting.
 * Every check below is a hard requirement; there is no "lenient" mode, because
 * a lenient mode is the thing an attacker asks for.
 */
export function verifyIdentityToken(
  token: string,
  keys: ApplePublicKey[],
  audience: string,
  nowMs: number = Date.now()
): VerifyResult {
  const decoded = decodeJwt(token);
  if (!decoded) return { ok: false, reason: "malformed token" };

  const { header, payload, signature, signingInput } = decoded;

  // Only RS256 is accepted. A token that asks for "none" (the classic JWT
  // downgrade) or a symmetric algorithm must not be honoured, even if it
  // somehow verifies.
  if (header.alg !== "RS256") return { ok: false, reason: "unexpected alg" };

  const kid = header.kid;
  if (typeof kid !== "string" || kid.length === 0) {
    return { ok: false, reason: "missing kid" };
  }

  const candidates = keys.filter((k) => k.kid === kid);
  if (candidates.length === 0) return { ok: false, reason: "unknown key id" };

  let verified = false;
  for (const jwk of candidates) {
    const key = publicKeyFromJwk(jwk);
    if (!key) continue;
    try {
      verified = createVerify("RSA-SHA256").update(signingInput).verify(key, signature);
    } catch {
      verified = false;
    }
    // Try every key with this kid before giving up: a key rotation can briefly
    // publish two keys under the same id, and one of them may be valid.
    if (verified) break;
  }
  if (!verified) return { ok: false, reason: "signature mismatch" };

  if (payload.iss !== APPLE_ISSUER) return { ok: false, reason: "bad issuer" };

  /*
   * Audience must equal our bundle id (native) or services id (web). Without
   * this check, a token minted for ANY other app that also uses Sign in with
   * Apple would be accepted here — a token for someone else's app is still a
   * validly-signed Apple token.
   */
  if (typeof payload.aud !== "string" || payload.aud !== audience) {
    return { ok: false, reason: "bad audience" };
  }

  if (typeof payload.exp !== "number") return { ok: false, reason: "missing exp" };
  // No skew allowance in the permissive direction. An expired token is expired.
  if (payload.exp * 1000 <= nowMs) return { ok: false, reason: "token expired" };

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "missing sub" };
  }

  return { ok: true, payload };
}

/**
 * Apple sends `email_verified` and `is_private_email` as either a boolean or
 * the strings "true"/"false" depending on the flow. Coerce rather than compare
 * truthiness: the string "false" is truthy in JS, which would turn an
 * unverified relay address into a verified one.
 */
export function claimIsTrue(value: boolean | string | undefined): boolean {
  if (value === true) return true;
  if (value === "true") return true;
  return false;
}
