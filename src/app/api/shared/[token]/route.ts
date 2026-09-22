import { NextResponse } from "next/server";
import { readState, tx } from "@/lib/db";
import { filterForShare, type ShareVisibility } from "@/lib/shareVisibility";

/*
 * Public read-only trip endpoint.
 *
 * The only unauthenticated route in the app. It returns a deliberately narrowed
 * projection rather than the app state:
 *
 *   - `users` is omitted entirely. A share link should expose the itinerary,
 *     not the account list, and the trip owner's name is not the viewer's
 *     business.
 *   - `settings` (active user, notification config) is never included.
 *   - Categories/items are included only when the link's owner has left the
 *     packing section visible — see below.
 *
 * Anything added to AppState in future must be considered against this list —
 * the default is to leave it out.
 *
 * Visibility is enforced HERE, not in the view. Filtering in React would render
 * a tidier page while still shipping every booking, note and packing item to the
 * browser, where anyone can read them out of the network response. A hidden
 * section has to be absent from the payload for the setting to mean anything.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let share: { tripId: string; visibility: import("@/lib/shareVisibility").ShareVisibility } | undefined;
  try {
    share = tx.resolveShareToken(token);
  } catch (err) {
    console.error("[api/shared] lookup failed:", err);
    return NextResponse.json({ error: "Could not load trip" }, { status: 500 });
  }

  // An unknown or revoked token is a 404 with no further detail — the caller
  // learns nothing about whether the trip exists.
  if (!share) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }

  const state = readState();
  const trip = state?.trips.find((t) => t.id === share.tripId);
  if (!state || !trip) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }

  /*
   * Field-by-field rather than spreading `trip`, and the filtering is delegated
   * to filterForShare so the same rules are unit-testable without HTTP.
   *
   * A spread would publish whatever columns the table happens to have, so both
   * `userId` (the owner's identity) and `shareToken` would go out with every
   * request. `userId` is not the viewer's business, and re-publishing the token
   * the caller already holds turns any HTML cache or proxy log into a
   * credential store. Listing the fields also means a future column is private
   * by default instead of leaking the moment it is added.
   */
  const payload = filterForShare(trip, share.visibility, {
    reservations: state.reservations.filter((r) => r.tripId === share.tripId),
    tasks: state.tasks.filter((t) => t.tripId === share.tripId),
    categories: state.categories.filter((c) => c.tripId === share.tripId),
    items: state.items.filter((i) => i.tripId === share.tripId),
  });

  return NextResponse.json(payload);
}
