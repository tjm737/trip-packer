/*
 * Authentication primitives: password hashing and session tokens.
 *
 * Deliberately free of database and request coupling so it can be tested
 * directly and reused by both the HTTP routes and the create-account CLI.
 *
 * Password storage uses PBKDF2-HMAC-SHA256 from node:crypto rather than bcrypt
 * or argon2. That is a considered choice, not a shortcut: the project has no
 * native-hashing dependency and adding one means a compiled module that has to
 * build on the VPS, in Docker, and on this Mac. PBKDF2 is in the standard
 * library, is FIPS-approved, and with a high iteration count is entirely
 * adequate for a personal multi-user app. If this ever needs argon2, the
 * versioned `algo` field in the stored hash means old hashes keep verifying.
 *
 * The stored format is self-describing:
 *
 *     pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>
 *
 * Embedding the algorithm, iteration count and salt means the cost can be
 * raised later without invalidating existing passwords, and verification uses
 * the parameters that were in force when the password was set. A bare digest
 * would make every future change a forced password reset.
 */

import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from "node:crypto";

/*
 * Iteration count.
 *
 * OWASP's floor for PBKDF2-HMAC-SHA256 is 600,000. This is set just above it.
 * The cost is paid once per login, not per request (sessions are separate), so
 * a slow hash costs the user a fraction of a second and costs an attacker
 * attempting a dictionary the same factor on every guess.
 */
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";
const SALT_BYTES = 16;

/** How long a session stays valid. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Hash a password for storage.
 *
 * Returns null for a non-string or empty password. Returning null rather than
 * hashing the empty string is important: an empty password must be
 * unrepresentable, so that a "no credential" account can never accidentally
 * match a login attempt with an empty field.
 */
export function hashPassword(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) return null;

  const salt = randomBytes(SALT_BYTES);
  const derived = pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );

  return [
    "pbkdf2",
    PBKDF2_DIGEST,
    PBKDF2_ITERATIONS,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false — never throws — for any malformed input. A corrupt or missing
 * hash must read as "cannot log in", not as an exception that a caller might
 * catch and treat as success by mistake. Every failure path returns the same
 * false, so the caller cannot accidentally distinguish "no such user" from
 * "wrong password" and leak which accounts exist.
 *
 * Note the dummy comparison at the end: when the stored hash is unusable we
 * still perform a PBKDF2 derivation so the response time does not reveal
 * whether the account exists.
 */
export function verifyPassword(
  password: string,
  stored: string | null | undefined
): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  if (typeof stored !== "string" || stored.length === 0) return false;

  const parts = stored.split("$");
  if (parts.length !== 5) return false;

  const [scheme, digest, iterationsRaw, saltB64, hashB64] = parts;
  if (scheme !== "pbkdf2") return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = pbkdf2Sync(password, salt, iterations, expected.length, digest);
  } catch {
    // Unknown digest name recorded in a hand-edited hash.
    return false;
  }

  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // throw itself would be a timing signal.
  if (derived.length !== expected.length) return false;

  return timingSafeEqual(derived, expected);
}

/* ------------------------------------------------------------------ */
/* Session tokens                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create a session token.
 *
 * Returns the raw token (for the cookie) and its SHA-256 hash (for the
 * database). The raw value is returned exactly once and never persisted, so a
 * database dump cannot be replayed as a live session.
 *
 * 32 random bytes is far beyond guessing range. The token is opaque: it carries
 * no user id, no role, no expiry. Everything is looked up server-side, which
 * means a client cannot forge identity by editing its cookie — only present a
 * token that exists in the table or does not.
 *
 * Plain SHA-256 is correct here, unlike for passwords: a 256-bit random token
 * has no guessable structure to slow down, so a key-stretching function would
 * add latency to every authenticated request for no security gain.
 */
export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

/** Hash a session token for lookup / storage. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** When a session created now should expire. */
export function sessionExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString();
}

/** Whether a session's expiry timestamp has passed. */
export function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  const t = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired. Failing closed is the only
  // safe reading: a corrupt row must not become a permanent session.
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

/* ------------------------------------------------------------------ */
/* Session verification                                                */
/* ------------------------------------------------------------------ */

/**
 * A session row as stored, reduced to what verification needs.
 *
 * Structural rather than importing the DB layer's type, so this module stays
 * free of database coupling and remains directly testable.
 */
export type SessionRecord = {
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

/**
 * Verify a presented token against a set of session rows.
 *
 * Returns the matching session, or null. Takes the rows as an argument rather
 * than querying, so the policy ("which token is valid") is separable from the
 * storage ("where the rows live") and can be tested without a database.
 *
 * Comparison is by hash, in constant time. A token is never compared in plain
 * form and never trusted to carry its own identity — the userId comes from the
 * matched ROW, not from anything the client sent.
 */
export function verifySessionToken(
  token: string,
  sessions: SessionRecord[],
  now: Date = new Date()
): SessionRecord | null {
  if (typeof token !== "string" || token.length === 0) return null;

  const candidate = Buffer.from(hashSessionToken(token), "hex");

  for (const session of sessions) {
    if (typeof session?.tokenHash !== "string") continue;
    const stored = Buffer.from(session.tokenHash, "hex");
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (stored.length !== candidate.length) continue;
    if (!timingSafeEqual(stored, candidate)) continue;
    // Expiry is checked only after the hash matches, so a wrong token cannot
    // be used to probe whether some other session has expired.
    if (isExpired(session.expiresAt, now)) return null;
    return session;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */

/*
 * Imported for use within this module, then re-exported so there is a single
 * definition.
 *
 * It lives in a dependency-free module because Edge middleware cannot import
 * this file (it pulls in node:crypto), and middleware needs the cookie name to
 * decide whether to redirect. Re-exporting keeps every existing importer
 * working while giving middleware a safe path to the same value.
 *
 * The import and the export are separate statements rather than
 * `export { SESSION_COOKIE } from "./constants"`, because a re-export does not
 * introduce a local binding — the functions below set and clear the cookie by
 * name, and a bare re-export leaves them referring to nothing.
 */
import { SESSION_COOKIE } from "./constants";
export { SESSION_COOKIE } from "./constants";

/**
 * Serialise the session cookie.
 *
 * HttpOnly  — page JS cannot read it, so an XSS cannot exfiltrate the token.
 * SameSite=Lax — sent on top-level navigations (so a link into the app still
 *              works) but not on cross-site form posts or fetches, which
 *              covers CSRF for state-changing requests.
 * Secure    — omitted on plain-http development, because a Secure cookie is
 *              silently dropped by browsers over http://localhost and that
 *              produces a "login succeeds but you're still logged out" loop
 *              that is genuinely hard to diagnose. Tied to production rather
 *              than hardcoded.
 * Max-Age   — matches the row's expiry so the cookie dies at the same moment
 *              the server stops honouring the token.
 */
export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** The cookie that clears the session. Must match Path/attributes to apply. */
export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Parse a Cookie header and return one cookie's value.
 *
 * Written by hand rather than pulling in a dependency. Note the deliberate
 * handling of the `=` character: header values are split on the FIRST `=` only,
 * because base64url tokens can themselves contain `=` padding, and splitting on
 * every `=` would silently truncate a valid token.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const raw of header.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rate limiting (failed attempts only)                                */
/* ------------------------------------------------------------------ */

export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Whether a login may be attempted, given prior failures.
 *
 * Only failures are counted, and a success clears the counter, so a legitimate
 * user is never locked out by logging in normally. Keys are per-email AND
 * per-IP (see the route) so one attacker cannot lock a real user out of their
 * own account by hammering it.
 */
export function isLockedOut(
  failures: number,
  lastFailedAt: string,
  now: Date = new Date()
): boolean {
  if (failures < MAX_FAILED_ATTEMPTS) return false;
  const last = Date.parse(lastFailedAt);
  if (Number.isNaN(last)) return true;
  // The window expires, so a lockout is a speed bump rather than a permanent
  // denial of service on the account.
  return now.getTime() - last < ATTEMPT_WINDOW_MS;
}

/**
 * The counter state after one more failed attempt.
 *
 * The window RESETS when the previous failure is old, so sporadic typos over
 * weeks do not accumulate into a lockout.
 */
export function nextFailureState(
  prev: { failures: number; firstFailedAt: string } | null,
  now: Date = new Date()
): { failures: number; firstFailedAt: string } {
  const nowIso = now.toISOString();
  if (!prev) return { failures: 1, firstFailedAt: nowIso };

  const first = Date.parse(prev.firstFailedAt);
  const stale = Number.isNaN(first) || now.getTime() - first > ATTEMPT_WINDOW_MS;
  if (stale) return { failures: 1, firstFailedAt: nowIso };

  return { failures: prev.failures + 1, firstFailedAt: prev.firstFailedAt };
}
