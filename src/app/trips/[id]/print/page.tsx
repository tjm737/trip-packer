import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readState } from "@/lib/db";
import { getActingUser } from "@/lib/session";
import { canReadEntityById } from "@/lib/access";
import { PrintableItinerary } from "@/components/PrintableItinerary";
import { PrintNowButton } from "@/components/PrintNowButton";
import { normalizeTheme } from "@/lib/theme";

/*
 * Printable itinerary.
 *
 * Server-rendered straight from SQLite, like the share page. It deliberately
 * does NOT go through AppContext: the provider fetches the whole app state and
 * would hand this page the account list, and a document that is about to be
 * printed has no business carrying other people's emails.
 *
 * Outside the (app) layout group, so no sidebar or tabs are rendered. The only
 * chrome on the page is a toolbar that hides itself when actually printing —
 * see globals.css, where `.print-toolbar` is display:none under @media print.
 *
 * `force-dynamic` because the itinerary must reflect the database at the moment
 * the user prints, not whatever a build cached.
 *
 * ---------------------------------------------------------------------------
 * SECURITY: this page checks the session AND the trip's ownership itself, and
 * it must keep doing both.
 *
 * Middleware matches /trips/:path* and redirects a request with NO cookie at
 * all, which makes a bare curl test look like this route is protected. It is
 * not: middleware runs on the Edge runtime, where better-sqlite3 cannot load,
 * so it can only ask whether a cookie is *present*, never whether it is valid.
 * A forged `tp_session=anything` passes it.
 *
 * Every other page under (app)/ is a client component that fetches through
 * fetchState() → the session-checked API, so that boundary catches a forged
 * cookie. This page reads the database directly, so no handler ever runs and
 * nothing else would reject it.
 *
 * A SESSION CHECK ALONE IS NOT ENOUGH, and this page used to stop there. That
 * was exploitable: `readState()` is unscoped — it returns every account's rows —
 * so any signed-in user who knew or guessed another user's trip id could print
 * the whole itinerary, booking confirmation codes included. `getActingUser()`
 * answers "who is this", and `canReadEntityById(..., "trip", id)` answers "may
 * they read THIS trip", resolving the owner server-side rather than trusting
 * the id in the URL. Both are required; neither is redundant with the other.
 *
 * Verified by forging a session for a second account and requesting a trip it
 * did not own: the request returned 200 with a fully rendered document. See
 * docs/security/print-trip-authorization.md.
 *
 * If this page is ever moved under (app)/, re-verify: the route group supplies
 * chrome, not auth. Middleware matches on PATH, and `(app)` is not a path
 * segment, so the move silently removes even the redirect.
 * ---------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  /*
   * This guard is not redundant with the one in the page component. Next runs
   * generateMetadata independently, and it is resolved BEFORE the page body's
   * redirect takes effect — so without this, the trip NAME is rendered into
   * <title> on a response that otherwise redirects to the sign-in form. That
   * leaks the existence and name of another user's trip to anyone who can
   * guess an id (they are UUIDs, but they travel in URLs, screenshots and
   * shared links, and this is a private-trip disclosure either way).
   *
   * Verified by probing the forged-cookie response's <title> directly.
   */
  const actor = await getActingUser();
  if (!actor) {
    return { title: "Trip not available", robots: { index: false, follow: false } };
  }

  /*
   * Ownership, not just identity. See the SECURITY note above: without this,
   * any signed-in user could have their own account name reflected into the
   * <title> of someone else's trip. Resolve the trip's owner from the database
   * rather than trusting the id in the URL.
   */
  const state = readState();
  if (!state || !canReadEntityById(state, actor.id, "trip", id)) {
    return { title: "Trip not available", robots: { index: false, follow: false } };
  }

  const trip = readState()?.trips.find((t) => t.id === id);
  return {
    title: trip ? `${trip.name} — Itinerary` : "Trip not available",
    // A private itinerary should never be indexed, printed or not.
    robots: { index: false, follow: false },
  };
}

export default async function PrintTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const { autoprint } = await searchParams;

  /*
   * See the SECURITY note above: middleware would let a forged cookie through,
   * and this page never goes near the API, so this is the only thing standing
   * between a guessed trip id and the itinerary. Redirect rather than render an
   * error, so a signed-out visitor with a stale bookmark lands on the sign-in
   * form and continues to where they were headed.
   */
  const actor = await getActingUser();
  if (!actor) {
    redirect(`/login?from=${encodeURIComponent(`/trips/${id}/print`)}`);
  }

  /*
   * Identity is not permission. `readState()` returns every account's rows, so
   * rendering from it without this check disclosed any trip to any signed-in
   * user. Resolve ownership server-side from the bare id.
   *
   * A 404-shaped "Trip not available" rather than a redirect: redirecting would
   * tell an unauthorised caller that the trip exists and that someone else owns
   * it. The two must be indistinguishable to a caller who may not read it.
   */
  const state = readState();
  if (!state || !canReadEntityById(state, actor.id, "trip", id)) {
    return (
      <main className="print-sheet">
        <h1>Trip not available</h1>
        <p className="print-empty">
          This itinerary either does not exist or is not shared with your account.
          <br />
          <Link href="/">Back to trips</Link>
        </p>
      </main>
    );
  }

  const trip = state.trips.find((t) => t.id === id);

  if (!trip) {
    return (
      <main className="print-sheet">
        <h1>Trip not available</h1>
        <p className="print-empty">
          This trip may have been deleted. <Link href="/">Back to trips</Link>
        </p>
      </main>
    );
  }

  const reservations = state.reservations.filter((r) => r.tripId === trip.id);
  const tasks = state.tasks.filter((t) => t.tripId === trip.id);
  const categories = state.categories.filter((c) => c.tripId === trip.id);
  const items = state.items.filter((i) => i.tripId === trip.id);

  /*
   * The print sheet is always light (a printed page is not a screen), but the
   * surrounding page background should match the user's chosen theme so opening
   * this URL on screen does not flash white at a dark-theme user before they
   * print. Setting the class on <html> here mirrors what the root layout's
   * pre-paint script does for the rest of the app.
   */
  const theme = normalizeTheme(state.users.find((u) => u.id === trip.userId)?.theme);

  return (
    <div className={theme === "light" ? "" : "dark"}>
      <PrintNowButton auto={autoprint === "1"} tripId={trip.id} tripName={trip.name} />
      <PrintableItinerary
        trip={trip}
        reservations={reservations}
        tasks={tasks}
        categories={categories}
        items={items}
      />
    </div>
  );
}
