/*
 * Constants shared between the Node runtime and Edge middleware.
 *
 * Why this file exists: middleware runs on the Edge runtime, which cannot load
 * `node:crypto` or `better-sqlite3`. Importing SESSION_COOKIE from lib/auth
 * therefore fails at build time with "Cannot find module '@/lib/auth'", and
 * lib/session re-exports it from the same module, so both are unusable from
 * middleware.
 *
 * The alternative — restating the cookie name as a string literal in
 * middleware.ts — was tried first and is worse: the value was guessed as
 * "trip_packer_session" when the real one is "tp_session", and because
 * middleware redirects on a MISSING cookie, that typo would have redirected
 * every signed-in user to /login. A silent, total lockout from a plausible
 * looking string. Importing one definition is what makes that class of drift
 * impossible rather than merely unlikely.
 *
 * Keep this module dependency-free. It is imported by middleware, so anything
 * added here must be safe on the Edge runtime.
 */

/**
 * Name of the session cookie.
 *
 * Must stay in sync with what lib/auth writes in serializeSessionCookie() and
 * clears in the logout path. lib/auth re-exports this, so existing importers
 * of SESSION_COOKIE from there continue to work; new code that might run in
 * middleware should import from here.
 */
export const SESSION_COOKIE = "tp_session";
