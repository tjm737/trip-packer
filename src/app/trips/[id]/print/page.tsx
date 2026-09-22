import type { Metadata } from "next";
import Link from "next/link";
import { readState } from "@/lib/db";
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
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
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
  const state = readState();
  const trip = state?.trips.find((t) => t.id === id);

  if (!state || !trip) {
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
