/*
 * Root route. Decides between the public landing page and the dashboard.
 *
 * A server component with no "use client", because the decision has to be made
 * from the session cookie — which only the server can read, and which must be
 * read before any HTML is sent. Doing this on the client would mean shipping the
 * dashboard's markup to a logged-out visitor and swapping it out after a fetch,
 * which both leaks the shape of the private UI and produces a visible flash of
 * the wrong page.
 *
 * This is a presentation decision, not the security boundary. It chooses what a
 * visitor is shown; the data itself is protected in the API routes, which check
 * the session and return 401. An unauthenticated visitor therefore gets the
 * landing page from here and no data even if they were shown the dashboard,
 * because /api/state will not serve them either.
 *
 * Not a redirect: a logged-out visitor at "/" is exactly who the landing page is
 * for, so sending them to /welcome (or anywhere else) would add a hop to the
 * most common first impression. Only /trips/* redirects, because those routes
 * have no meaningful logged-out rendering — see src/middleware.ts.
 */

import { hasValidSession } from "@/lib/session";
import DashboardClient from "./(app)/DashboardClient";
import LandingPage from "@/components/LandingPage";

/*
 * Sessions are read from cookies, so this route cannot be statically rendered —
 * without this, Next would prerender one of the two branches and serve it to
 * everyone.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await hasValidSession())) {
    return <LandingPage />;
  }

  return <DashboardClient />;
}
