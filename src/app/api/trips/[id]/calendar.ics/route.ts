import { NextResponse } from "next/server";

import { readState } from "@/lib/db";
import { scopeStateForUser } from "@/lib/access";
import { getActingUser } from "@/lib/session";
import { inItineraryOrder } from "@/lib/itineraryOrder";
import { buildCalendar, calendarFilename } from "@/lib/calendar";

export const dynamic = "force-dynamic";

/*
 * GET /api/trips/[id]/calendar.ics — the itinerary as a downloadable .ics.
 *
 * Access control goes through `scopeStateForUser`, the same function
 * `/api/state` uses, rather than a bespoke ownership check. That matters
 * because visibility here is not simple ownership: a trip can be shared with
 * other accounts, so "am I the owner" is the wrong question and answering it
 * myself would either over-expose shared trips or under-expose them.
 * Scoping to the actor and then looking for the trip inside the scoped state
 * means the visibility rules live in exactly one place.
 *
 * A trip the caller cannot see returns 404, not 403: a 403 confirms the id
 * exists, which leaks the existence of other people's trips to anyone willing
 * to enumerate ids.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const actor = await getActingUser();
    if (!actor) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const state = readState();
    if (!state) {
      return NextResponse.json({ error: "No data" }, { status: 404 });
    }

    const scoped = scopeStateForUser(state, actor.id);
    if (!scoped) {
      // The actor has no resolvable access at all. Treated as not-found rather
      // than forbidden, for the same enumeration reason.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    /*
     * `scopeStateForUser` returns a structural type built for *access
     * decisions* — `trips` is `{ id, userId }` and the rest are id-only
     * shadows. It is the right thing to ask "may this actor see this trip", but
     * it is not a data source: the rows are missing every field the calendar
     * needs.
     *
     * So it is used as a gate, and the real typed rows are read from `state`.
     * This is also the safer direction — a trip that fails the gate exits
     * before any full row is touched.
     */
    const visible = scoped.trips.some((t) => t.id === id);
    if (!visible) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const trip = state.trips.find((t) => t.id === id);
    if (!trip) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const reservations = state.reservations.filter((r) => r.tripId === id);

    /*
     * Export in the order the user arranged, so the calendar matches the
     * itinerary they see rather than insertion order. `inItineraryOrder` is the
     * same helper the itinerary view uses — reusing it means drag-reordering a
     * trip reorders the export too.
     */
    const ordered = inItineraryOrder(reservations, { includeUnmapped: false });

    const ics = buildCalendar({ trip, reservations: ordered });
    const filename = calendarFilename(trip.name);

    return new NextResponse(ics, {
      status: 200,
      headers: {
        /*
         * text/calendar with an explicit charset. Some clients ignore the body
         * if the type is wrong, and any trip name with an accent needs the
         * charset declared or it is mojibaked in the calendar list.
         */
        "Content-Type": "text/calendar; charset=utf-8",
        /*
         * `filename` is sanitised by `calendarFilename` (no slashes, no ".."),
         * which is what keeps a crafted trip name from injecting a header or
         * escaping the download directory. Do not interpolate a raw trip name
         * here.
         */
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Itineraries change; never let a proxy or the SW serve a stale export.
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[calendar] export failed:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
