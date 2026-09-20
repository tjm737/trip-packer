"use client";

import type { AppState } from "./types";
import {
  createReservation,
  createTask,
  createTrip,
} from "./storage";
import type { ParsedItinerary } from "./itineraryImport";

/**
 * Create a trip and all of its records from a parsed itinerary.
 *
 * Deliberately sequential rather than parallel: each `create*` call reads the
 * current state to derive its own `order`, and firing them concurrently means
 * every call reads the same stale count and they all claim the same position.
 * The last response is also the only snapshot guaranteed to include every
 * earlier write, so it is the one worth keeping.
 *
 * A failure part-way leaves the trip partially populated. The thrown message
 * says so explicitly, because re-running the import would duplicate whatever
 * already landed.
 */
export async function importItinerary(
  userId: string,
  parsed: ParsedItinerary
): Promise<{ state: AppState; tripId: string; created: number }> {
  const { state: afterTrip, trip } = await createTrip(userId, {
    name: parsed.trip.name,
    destination: parsed.trip.destination,
    startDate: parsed.trip.startDate,
    endDate: parsed.trip.endDate,
    notes: parsed.trip.notes,
    icon: parsed.trip.icon,
  });

  let state = afterTrip;
  let created = 0;

  for (const r of parsed.reservations) {
    try {
      // `order` is assigned by createReservation from the live count, so the
      // parsed index is not passed — doing so would fight the server.
      const res = await createReservation(trip.id, {
        type: r.type,
        title: r.title,
        confirmation: r.confirmation,
        location: r.location,
        locationTo: r.locationTo,
        startDate: r.startDate,
        startTime: r.startTime,
        endDate: r.endDate,
        endTime: r.endTime,
        cost: r.cost,
        notes: r.notes,
      });
      state = res.state;
      created++;
    } catch (err) {
      throw new Error(
        `Imported ${created} of ${parsed.reservations.length} reservations, then failed on "${r.title}": ${
          err instanceof Error ? err.message : String(err)
        }. The trip was created — add what is missing by hand rather than re-importing, which would duplicate the ${created} that already landed.`
      );
    }
  }

  for (const t of parsed.tasks) {
    try {
      const res = await createTask(trip.id, t.title, t.dueDate);
      state = res.state;
      created++;
    } catch (err) {
      throw new Error(
        `Imported the reservations, then failed on task "${t.title}": ${
          err instanceof Error ? err.message : String(err)
        }. The trip exists — add the remaining tasks by hand.`
      );
    }
  }

  return { state, tripId: trip.id, created };
}
