import type { Metadata } from "next";
import { readState, tx } from "@/lib/db";
import { SharedTripView } from "@/components/SharedTripView";
import { filterForShare } from "@/lib/shareVisibility";

/*
 * Public read-only trip page.
 *
 * Rendered on the server straight from SQLite rather than through AppContext:
 * the provider fetches the whole app state and would hand a viewer the account
 * list. Reading here keeps the exposure to exactly this one trip.
 *
 * Deliberately outside the (app) layout group, so no sidebar, nav, or user
 * switcher is rendered — a link holder sees the itinerary and nothing else.
 *
 * This is a SECOND rendering path for the same page as /api/shared/[token] (that
 * endpoint serves the client-side refresh), so the link's visibility rules must
 * be applied here too. Filtering in only one of the two would mean the sections
 * an owner hid appear in the server-rendered HTML until the client refetches —
 * and are readable by anyone who views source. Both paths call filterForShare so
 * they cannot disagree.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const resolved = tx.resolveShareToken(token);
  const trip = resolved
    ? readState()?.trips.find((t) => t.id === resolved.tripId)
    : undefined;

  // Never index a private itinerary, even a live link.
  if (!trip) {
    return { title: "Trip not available", robots: { index: false, follow: false } };
  }
  return {
    title: `${trip.name} — TripPlanner`,
    description: trip.destination ? `Itinerary for ${trip.destination}` : "Shared itinerary",
    robots: { index: false, follow: false },
  };
}

export default async function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = tx.resolveShareToken(token);
  const state = readState();
  const trip = resolved ? state?.trips.find((t) => t.id === resolved.tripId) : undefined;

  if (!state || !resolved || !trip) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold text-zinc-100">This link is no longer available</h1>
        <p className="text-sm text-zinc-400">
          The trip may have been removed, or the person who shared it revoked the link.
        </p>
      </div>
    );
  }

  const payload = filterForShare(trip, resolved.visibility, {
    reservations: state.reservations.filter((r) => r.tripId === trip.id),
    tasks: state.tasks.filter((t) => t.tripId === trip.id),
    categories: state.categories.filter((c) => c.tripId === trip.id),
    items: state.items.filter((i) => i.tripId === trip.id),
  });

  return (
    <SharedTripView
      trip={payload.trip}
      reservations={payload.reservations}
      tasks={payload.tasks}
      categories={payload.categories}
      items={payload.items}
      visibility={payload.visibility}
    />
  );
}
