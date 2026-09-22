/*
 * Sign-in page.
 *
 * Exists so the public landing page can link to a real route instead of
 * mounting LoginDialog itself. LoginDialog is a controlled component that uses
 * the client apiUrl helper and the toast manager, so pulling it into the
 * landing page would have made a page that otherwise renders statically into a
 * client component — and the landing page's whole advantage is that it reads no
 * session and hydrates nothing.
 *
 * The post-sign-in behaviour matches the dashboard's: a full reload. Signing in
 * changes which account every client-side cache belongs to, and reloading is
 * the only way to guarantee no data from the previous session survives in a
 * store. See the same reasoning in SidebarContent.tsx.
 *
 * A visitor who is already signed in has no reason to be here, so this bounces
 * them to the dashboard rather than showing a second sign-in form over a valid
 * session.
 */

import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/session";
import { SignInClient } from "./SignInClient";

export const metadata = {
  title: "Sign in — TripPlanner",
};

export default async function LoginPage() {
  // Server-side check: no flash of a sign-in form for someone already signed in.
  if (await hasValidSession()) redirect("/");

  return <SignInClient />;
}
