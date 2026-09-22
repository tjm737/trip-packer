/*
 * Profile screen — the signed-in user editing their own account.
 *
 * A server component so the target account is resolved from the session rather
 * than from client state. `state.activeUserId` is a persisted client preference
 * (which traveler the UI is looking at) and is NOT the authenticated identity;
 * editing whichever traveler happened to be selected would let a signed-in user
 * rename somebody else. The id comes from the session cookie, and the API
 * enforces the same rule server-side, so this is a correctness guard as well as
 * a convenience.
 *
 * Only display name and avatar colour are editable. Credentials are deliberately
 * absent: db.updateUser is allow-listed to those two columns, and email/password
 * changes need machinery (uniqueness, re-authentication, session revocation)
 * that this screen does not attempt.
 */

import { redirect } from "next/navigation";
import { getActingUser } from "@/lib/session";
import { ProfileClient } from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const actor = await getActingUser();

  // The (app) layout already guards this, but a page that renders account data
  // should not depend on a parent layout never being refactored. Middleware also
  // does not cover this path.
  if (!actor) redirect("/login?from=%2Fprofile");

  return <ProfileClient userId={actor.id} />;
}
