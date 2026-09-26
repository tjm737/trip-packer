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

/**
 * Avatar colours, indexed by a stable hash of the account id.
 *
 * Lives here rather than in lib/storage so server code -- the Sign in with
 * Apple route, in particular -- can assign a colour without importing the
 * client bundle. It was moved out of storage.ts when that route needed it;
 * storage.ts re-exports it so existing importers are unaffected.
 *
 * These are Tailwind classes, so the values have to appear literally (Tailwind
 * cannot see a computed class name at build time). Keep the list in step with
 * the safelist in tailwind.config if one is ever added.
 */
export const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-500",
];
