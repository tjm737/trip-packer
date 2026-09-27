import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readState } from "@/lib/db";
import { getActingUser } from "@/lib/session";
import { canReadEntityById } from "@/lib/access";
import { buildClaimDocument } from "@/lib/bagClaim";
import { BAG_KIND_LABELS } from "@/lib/types";
import { PrintableBagClaim } from "@/components/PrintableBagClaim";
import { PrintNowButton } from "@/components/PrintNowButton";
import { normalizeTheme } from "@/lib/theme";

/*
 * Printable baggage claim sheet for one bag.
 *
 * Server-rendered straight from SQLite, like the itinerary print page and the
 * share page. It deliberately does NOT go through AppContext: the provider
 * fetches the whole app state and would hand this page every account's rows,
 * and a claim document has no business carrying other people's data.
 *
 * Outside the (app) layout group, so no sidebar or tabs are rendered. The only
 * chrome is a toolbar that hides itself when actually printing.
 *
 * `force-dynamic` because the contents must reflect the database at the moment
 * the user prints. A cached claim sheet listing last week's bag is worse than
 * no sheet at all -- the traveller would hand the airline a document that is
 * quietly out of date.
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
 * fetchState() -> the session-checked API, so that boundary catches a forged
 * cookie. This page reads the database directly, so no handler ever runs and
 * nothing else would reject it.
 *
 * A SESSION CHECK ALONE IS NOT ENOUGH: `readState()` is unscoped -- it returns
 * every account's rows -- so any signed-in user who knew or guessed another
 * user's trip id could print that trip's bag contents. `getActingUser()`
 * answers "who is this", and `canReadEntityById(..., "trip", id)` answers "may
 * they read THIS trip", resolving the owner server-side rather than trusting
 * the id in the URL. Both are required; neither is redundant with the other.
 *
 * The BAG is then checked against the trip that was just authorised. Without
 * this second check, a legitimate trip id plus someone else's bag id would
 * read a bag belonging to a trip the caller cannot see -- authorising the
 * container does not authorise an arbitrary bagId from the URL. See
 * docs/security/print-trip-authorization.md for the same class of bug on the
 * itinerary page.
 * ---------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";

/**
 * Resolve the bag only if the caller may read the trip that owns it.
 *
 * Shared by generateMetadata and the page so the two cannot disagree -- they
 * have to reach the same verdict, and duplicating the logic is how one of them
 * silently drifts. Returns null for "not yours, or does not exist", which the
 * callers render as the same 404-shaped page on purpose.
 */
async function resolveAuthorisedBag(id: string, bagId: string) {
  const actor = await getActingUser();
  if (!actor) return { kind: "unauthenticated" as const };

  const state = readState();
  if (!state || !canReadEntityById(state, actor.id, "trip", id)) {
    return { kind: "forbidden" as const };
  }

  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return { kind: "forbidden" as const };

  /*
   * The bag must belong to THIS trip. Checking only that a bag with this id
   * exists would let a caller pair their own trip id with another trip's bag
   * id and read a bag they cannot otherwise see.
   *
   * `bags` is optional on AppState -- the field was added with the feature, and
   * a snapshot written by an older build has no key at all. A missing array
   * means "no bags", which correctly fails this lookup rather than throwing.
   */
  const bag = (state.bags ?? []).find((b) => b.id === bagId && b.tripId === trip.id);
  if (!bag) return { kind: "forbidden" as const };

  return { kind: "ok" as const, state, trip, bag };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; bagId: string }>;
}): Promise<Metadata> {
  const { id, bagId } = await params;

  /*
   * This guard is not redundant with the one in the page component. Next runs
   * generateMetadata independently, and it is resolved BEFORE the page body's
   * redirect takes effect -- so without this, the BAG NAME is rendered into
   * <title> on a response that otherwise redirects to the sign-in form. That
   * leaks the existence and name of another user's bag to anyone who can guess
   * an id. Verified by probing the forged-cookie response's <title> directly.
   */
  const found = await resolveAuthorisedBag(id, bagId);
  if (found.kind !== "ok") {
    return { title: "Not available", robots: { index: false, follow: false } };
  }

  return {
    title: `${found.bag.name} — Baggage claim`,
    // A document describing a private bag's contents should never be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function BagClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; bagId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id, bagId } = await params;
  const { autoprint } = await searchParams;

  const found = await resolveAuthorisedBag(id, bagId);

  /*
   * See the SECURITY note above: middleware would let a forged cookie through,
   * and this page never goes near the API, so this is the only thing standing
   * between a guessed id and a bag's contents. Redirect rather than render an
   * error, so a signed-out visitor with a stale bookmark lands on the sign-in
   * form and continues to where they were headed.
   */
  if (found.kind === "unauthenticated") {
    redirect(`/login?from=${encodeURIComponent(`/trips/${id}/bags/${bagId}/claim`)}`);
  }

  /*
   * A 404-shaped "Not available" rather than a redirect for the forbidden case:
   * redirecting would tell an unauthorised caller that the trip or bag exists.
   * The two must be indistinguishable to a caller who may not read it.
   */
  if (found.kind === "forbidden") {
    return (
      <main className="print-sheet">
        <h1>Not available</h1>
        <p className="print-empty">
          This bag claim either does not exist or is not shared with your account.
          <br />
          <Link href="/">Back to trips</Link>
        </p>
      </main>
    );
  }

  const { state, trip, bag } = found;

  const categories = state.categories.filter((c) => c.tripId === trip.id);
  const items = state.items.filter((i) => i.tripId === trip.id && i.bagId === bag.id);

  const doc = buildClaimDocument(trip, bag, items, categories, BAG_KIND_LABELS);

  /*
   * The sheet is always light (a printed page is not a screen), but the
   * surrounding page background should match the user's chosen theme so opening
   * this URL on screen does not flash white at a dark-theme user before they
   * print.
   */
  const theme = normalizeTheme(state.users.find((u) => u.id === trip.userId)?.theme);

  return (
    <div className={theme === "light" ? "" : "dark"}>
      {/*
        The toolbar title names the bag, not the trip: the user came here from
        one bag's row, and on a screen that looks like the itinerary view the
        trip name alone would not say which sheet this is.
      */}
      <PrintNowButton auto={autoprint === "1"} tripId={trip.id} tripName={bag.name} />
      <PrintableBagClaim doc={doc} />
    </div>
  );
}
