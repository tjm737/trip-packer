/*
 * Session resolution for route handlers.
 *
 * This module is the ONLY place that answers "who is making this request".
 * Everything downstream takes an already-resolved actor, which is what keeps the
 * answer from being re-derived (and eventually mis-derived) in each handler.
 *
 * The previous version of this app took the acting user from a client-settable
 * `activeUserId` with a `user.switch` op — i.e. the client told the server who
 * it was. That is not authentication, and no amount of checking downstream
 * repairs it. Here the identity comes from a session row keyed by a cookie the
 * client cannot forge.
 */

import { cookies } from "next/headers";

import { getSessionRecords, readState } from "./db";
import { SESSION_COOKIE, readCookie, verifySessionToken } from "./auth";

/**
 * The authenticated actor.
 *
 * Defined here rather than imported from the mutate route: the route imports
 * this module, so taking the type from the route would make the dependency
 * circular. Keeping it in the lower-level module means the arrow only points one
 * way.
 */
export type ActingUser = { id: string; isOwner: boolean };

/**
 * Resolve the acting user for the current request.
 *
 * Returns null when there is no session, the token is invalid, the token has
 * expired, or the session's user no longer exists. Callers treat null as 401.
 * Returning null rather than a default identity is the point: every failure
 * mode must fail closed, because a fallback here is an auth bypass.
 */
export async function getActingUser(): Promise<ActingUser | null> {
  const jar = await cookies();
  const cookieHeader = jar.toString();
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;

  /*
   * Verified against the stored rows. The userId comes from the matched row,
   * never from the token — the token is opaque and carries no identity a client
   * could edit into existence.
   */
  const session = verifySessionToken(token, getSessionRecords());
  if (!session) return null;

  /*
   * The user is re-read from the database rather than trusted from the session
   * row alone. An account deleted after a token was issued must not keep
   * working, and the only way to notice that is to look.
   */
  const state = readState();
  const user = state?.users?.find((u) => u.id === session.userId);
  if (!user) return null;

  return { id: user.id, isOwner: user.isOwner === true };
}

/**
 * The acting user, or a thrown error.
 *
 * For handlers where the absence of a session is exceptional rather than a
 * branch. Prefer getActingUser where a 401 is an ordinary outcome.
 */
export async function requireActingUser(): Promise<ActingUser> {
  const actor = await getActingUser();
  if (!actor) throw new Error("UNAUTHENTICATED");
  return actor;
}

/**
 * Whether the request carries a valid session, without needing the user object.
 *
 * Avoids the database read that getActingUser performs, for gates where the
 * identity itself is not needed.
 */
export async function hasValidSession(): Promise<boolean> {
  const jar = await cookies();
  const token = readCookie(jar.toString(), SESSION_COOKIE);
  if (!token) return false;
  return verifySessionToken(token, getSessionRecords()) !== null;
}
