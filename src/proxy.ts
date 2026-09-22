/*
 * Route protection for the authenticated area.
 *
 * Scope: this guards /trips/*, which is where real trip data is read and
 * written, and it deliberately does NOT guard "/". The root path has to stay
 * reachable for a logged-out visitor so it can render the public landing page;
 * gating it here would redirect every first-time visitor to /login and they
 * would never see the product described.
 *
 * This is a redirect layer, not the security boundary. The actual boundary is
 * in the API routes, which all check the session and return 401 — see
 * /api/state, which previously returned readState() verbatim with no session
 * check at all. This layer can be bypassed in ways an API check cannot (a
 * direct fetch, a prefetch, a future route that forgets to call it), so it
 * exists to give a human a sensible destination, while the data itself is
 * protected at the source.
 *
 * The session cookie is only checked for PRESENCE here, not validity. A forged
 * cookie gets past this and is rejected downstream with a 401 — the login page
 * redirects on a valid session via the server-side hasValidSession(), so the
 * false-positive case degrades to "sees a sign-in form and is bounced to the
 * dashboard", not to "sees someone's trips".
 *
 * NOTE (was middleware.ts): this file is the renamed `proxy` convention. Unlike
 * middleware, proxy runs on the NODE runtime, so it *could* now import
 * better-sqlite3 and validate the session properly — verified by compiling with
 * the import present. It deliberately still does not: validating here would put
 * a database read on the hot path of every /trips request, and it cannot remove
 * the API-side checks that are the real boundary anyway. Presence-only is fine
 * for a redirect hint. If you ever do add a lookup, keep the API checks too —
 * this file is still not the boundary.
 *
 * The security-critical direct-DB page is NOT covered by this matcher's
 * redirect alone: /trips/[id]/print reads SQLite itself and guards with
 * hasValidSession() in both the page body and generateMetadata(). See the
 * SECURITY note in that file before touching either.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

export function proxy(request: NextRequest) {
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSessionCookie) {
    // Carry the attempted destination through so a signed-out visitor following
    // a link to a specific trip lands there after signing in, rather than on
    // the dashboard with no idea where they were going.
    const url = request.nextUrl.clone();
    const from = url.pathname + url.search;
    url.pathname = "/login";
    url.search = "";
    if (from && from !== "/") url.searchParams.set("from", from);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * /trips/new and /trips/[id]/edit are write surfaces, so they belong behind
   * the boundary as much as the read views do. The pattern intentionally does
   * not include /api — those routes enforce the session themselves and return
   * JSON, which a redirect would break for fetch() callers.
   */
  matcher: ["/trips/:path*"],
};
