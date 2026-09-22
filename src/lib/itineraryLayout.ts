import type { Category, PackingItem, Reservation, Task } from "./types";
import { inItineraryOrder } from "./itineraryOrder";

/*
 * Ordering and grouping shared by the app's itinerary and the printable
 * itinerary.
 *
 * These lived inline in the components. They are extracted here because the
 * printed document must agree with the screen: if the app sorted bookings one
 * way and the printout another, the sheet of paper in someone's hand would
 * disagree with the phone in their hand, and the paper is the one that gets
 * trusted at a check-in desk. One definition, two consumers.
 *
 * Everything here is a pure function over plain data — no React, no Leaflet, no
 * SQLite. That keeps it trivially unit-testable and usable from a server
 * component (the print route renders on the server).
 */

/**
 * Sort bookings the way the whole app sorts them.
 *
 * Delegates to `inItineraryOrder` rather than reimplementing a comparator. That
 * function carries the rules the map and the on-screen list depend on —
 * `orderManual` for hand-dragged rows, and a timed booking outranking an untimed
 * one on the same date. A naive date-then-time sort looks equivalent and is not:
 * it re-orders every manually sequenced day, so the printed itinerary would
 * silently disagree with the screen.
 *
 * `includeUnmapped` is on, and that matters. By default `inItineraryOrder` drops
 * a booking carrying neither a date nor a location, because the map cannot place
 * it on a route. A printed itinerary is not a route: a booking someone entered
 * with a title and no date yet is still a booking, and silently omitting it from
 * the document would be data loss on the one artifact that gets carried in a
 * bag. Undated rows sort last (see the function's own ordering rules), so they
 * collect at the end rather than disrupting the days.
 *
 * Returns a new array; callers never get their input mutated.
 */
export function sortReservations(reservations: Reservation[]): Reservation[] {
  return inItineraryOrder(reservations, { includeUnmapped: true });
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) =>
    (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99")
  );
}

/** A single day's worth of bookings, keyed by ISO date. */
export type DayGroup = {
  /** ISO `yyyy-mm-dd`, or "" for the undated bucket. */
  date: string;
  reservations: Reservation[];
};

/**
 * Group reservations into days for the printed itinerary.
 *
 * Grouped by `startDate` only, not by date range: a hotel booked for the 3rd to
 * the 8th belongs on the 3rd, under "check in". Spreading it across six days
 * would put the same booking on six lines and bury the one fact that matters.
 * The end date is rendered inside the entry instead (see `reservationWhen`).
 *
 * Undated bookings collect into a trailing group with `date: ""` so they are
 * still printed — dropping them would silently lose data from the document.
 * Returns [] for no bookings, so callers can render their own empty state.
 */
export function groupByDay(reservations: Reservation[]): DayGroup[] {
  const sorted = sortReservations(reservations);

  /*
   * Accumulate by date key rather than detecting runs of equal dates.
   *
   * In practice `inItineraryOrder` never emits a non-contiguous date sequence —
   * that was checked by brute force over 65,536 date/rank combinations — so a
   * run-detecting loop would give the same answer today. Keying by date is used
   * anyway because it does not DEPEND on that invariant holding: the ordering
   * helper is free to change (its own docs describe dragging a row above a
   * chronologically earlier one), and a grouper that assumes adjacency would then
   * silently print a duplicate day heading with a day's bookings split across it.
   * The invariant is worth not relying on; it is asserted in the tests rather
   * than assumed here.
   *
   * Insertion order of the map is the sorted order of first appearance, so days
   * come out chronologically, and the undated bucket (key "") still lands last
   * because the ordering helper sinks undated rows.
   */
  const byDate = new Map<string, Reservation[]>();
  for (const r of sorted) {
    const date = r.startDate || "";
    const bucket = byDate.get(date);
    if (bucket) bucket.push(r);
    else byDate.set(date, [r]);
  }

  return Array.from(byDate, ([date, group]) => ({ date, reservations: group }));
}

/**
 * Human-readable time span for one booking, for the printed line.
 *
 * Handles the four real shapes: no dates at all, a single date, a single
 * date with a start time, and a date range (a stay, or an overnight train).
 * Kept as a plain string rather than a Date because these are calendar dates,
 * not instants — parsing them into Date objects would drag timezone handling
 * into a document that has no timezone.
 */
export function reservationWhen(r: Reservation): string {
  const start = r.startDate || "";
  const end = r.endDate || "";
  const time = r.startTime || "";

  if (!start) return "";
  if (end && end !== start) {
    // Range: the day heading already shows the start date, so only the end
    // needs spelling out here.
    return `until ${end}`;
  }
  if (time) return time;
  return "";
}

/** Packing items grouped by category, in category sort order. */
export type PackingGroup = {
  category: Category;
  items: PackingItem[];
};

/**
 * Group packing items under their categories for the printed checklist.
 *
 * Only categories that actually contain items are returned — an empty heading
 * on paper is just noise. Items within a category keep their stored `order`,
 * which is the order the user dragged them into.
 */
export function groupPacking(
  categories: Category[],
  items: PackingItem[]
): PackingGroup[] {
  const byCategory = [...categories].sort((a, b) => a.order - b.order);

  return byCategory
    .map((category) => ({
      category,
      items: items
        .filter((i) => i.categoryId === category.id)
        .sort((a, b) => a.order - b.order),
    }))
    .filter((g) => g.items.length > 0);
}
