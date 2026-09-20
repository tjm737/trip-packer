import { NextResponse } from "next/server";
import { readState, tx } from "@/lib/db";

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
 *   - Categories/items are included because the packing list is genuinely
 *     useful to a travel companion.
 *
 * Anything added to AppState in future must be considered against this list —
 * the default is to leave it out.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  let tripId: string | undefined;
  try {
    tripId = tx.resolveShareToken(token);
  } catch (err) {
    console.error("[api/shared] lookup failed:", err);
    return NextResponse.json({ error: "Could not load trip" }, { status: 500 });
  }

  // An unknown or revoked token is a 404 with no further detail — the caller
  // learns nothing about whether the trip exists.
  if (!tripId) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }

  const state = readState();
  const trip = state?.trips.find((t) => t.id === tripId);
  if (!state || !trip) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }

  return NextResponse.json({
    trip,
    reservations: state.reservations.filter((r) => r.tripId === tripId),
    tasks: state.tasks.filter((t) => t.tripId === tripId),
    categories: state.categories.filter((c) => c.tripId === tripId),
    items: state.items.filter((i) => i.tripId === tripId),
  });
}
