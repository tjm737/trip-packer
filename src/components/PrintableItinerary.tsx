import type { Category, PackingItem, Reservation, ReservationType, Task, Trip } from "@/lib/types";
import { formatDate, formatDateRange, nightsBetween } from "@/lib/dates";
import {
  groupByDay,
  groupPacking,
  reservationWhen,
  sortReservations,
  sortTasks,
} from "@/lib/itineraryLayout";

/*
 * The printable itinerary.
 *
 * Deliberately a server component with no client state: the output is a
 * document, and the whole thing is rendered from plain props. Everything here
 * uses the shared ordering helpers from `itineraryLayout` so the paper agrees
 * with the screen.
 *
 * Styling note: this is the ONE place in the app that is intentionally light.
 * The app is dark, but a printed page is not a screen — a dark background is
 * either stripped by the browser (leaving white text invisible) or floods the
 * page with toner. So these classes are literal light-theme values rather than
 * theme tokens: `text-black`, `border-gray-300`, and so on. Do not "fix" them to
 * use the theme ramp; the theme ramp is for screens.
 */

const TYPE_LABEL: Record<ReservationType, string> = {
  flight: "Flight",
  lodging: "Stay",
  car: "Car",
  train: "Train",
  ferry: "Ferry",
  activity: "Activity",
  other: "Booking",
};

/** Weekday name for a day heading, e.g. "Wed". Parse is safe: the input is ISO. */
function weekday(iso: string): string {
  if (!iso) return "";
  // Parse as UTC and read UTC parts, so the label cannot shift a day in a
  // timezone behind UTC. These are calendar dates, not instants.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()] ?? "";
}

/*
 * `formatDate` returns null for a missing or invalid date. This document renders
 * that as an empty string rather than "null", and keeping the coercion in one
 * helper means no call site has to remember the difference.
 */
function fmt(value: string | null | undefined): string {
  return formatDate(value) ?? "";
}

function BookingRow({ r }: { r: Reservation }) {
  const when = reservationWhen(r);
  const nights = r.type === "lodging" ? nightsBetween(r.startDate, r.endDate) : 0;

  return (
    <div className="print-item">
      <div className="print-item-head">
        <span className="print-item-title">{r.title}</span>
        <span className="print-item-type">
          {TYPE_LABEL[r.type] ?? "Booking"}
          {r.confirmed === false ? " — draft" : ""}
        </span>
      </div>

      <div className="print-item-meta">
        {when && <span>{when}</span>}
        {nights > 0 && <span>{nights} night{nights === 1 ? "" : "s"}</span>}
        {r.location && <span>{r.location}</span>}
      </div>

      {/* The confirmation code is the one thing you read off the paper at a
          desk, so it gets its own emphasised line rather than being buried in
          the metadata row. */}
      {r.confirmation && (
        <div className="print-item-conf">
          Confirmation: <strong>{r.confirmation}</strong>
        </div>
      )}

      {r.notes && <div className="print-item-notes">{r.notes}</div>}
    </div>
  );
}

export function PrintableItinerary({
  trip,
  reservations,
  tasks,
  categories,
  items,
}: {
  trip: Trip;
  reservations: Reservation[];
  tasks: Task[];
  categories: Category[];
  items: PackingItem[];
}) {
  const days = groupByDay(reservations);
  const dated = days.filter((d) => d.date);
  const undated = days.find((d) => !d.date);
  const sortedTasks = sortTasks(tasks);
  const packing = groupPacking(categories, items);

  const packedCount = items.filter((i) => i.checked).length;
  const dateRange = formatDateRange(trip.startDate, trip.endDate);
  const nights =
    trip.startDate && trip.endDate ? nightsBetween(trip.startDate, trip.endDate) : 0;

  return (
    <article className="print-sheet">
      <header className="print-header">
        <h1>{trip.name}</h1>
        <div className="print-header-meta">
          {trip.destination && <span>{trip.destination}</span>}
          {dateRange && dateRange !== "No dates set" && <span>{dateRange}</span>}
          {nights > 0 && <span>{nights} night{nights === 1 ? "" : "s"}</span>}
          <span>
            {sortReservations(reservations).length} booking
            {sortReservations(reservations).length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <section className="print-section">
        <h2>Itinerary</h2>
        {days.length === 0 ? (
          <p className="print-empty">No bookings added yet.</p>
        ) : (
          <>
            {dated.map((day) => (
              // A day is the unit that must not be torn across pages.
              <div className="print-day" key={day.date}>
                <h3 className="print-day-head">
                  <span className="print-day-date">{fmt(day.date)}</span>
                  <span className="print-day-dow">{weekday(day.date)}</span>
                </h3>
                {day.reservations.map((r) => (
                  <BookingRow key={r.id} r={r} />
                ))}
              </div>
            ))}

            {undated && (
              <div className="print-day">
                <h3 className="print-day-head">
                  <span className="print-day-date">Unscheduled</span>
                </h3>
                {undated.reservations.map((r) => (
                  <BookingRow key={r.id} r={r} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {sortedTasks.length > 0 && (
        <section className="print-section print-avoid-break">
          <h2>Before you go</h2>
          <ul className="print-checklist">
            {sortedTasks.map((t) => (
              <li key={t.id}>
                <span className="print-box">{t.done ? "x" : ""}</span>
                <span className={t.done ? "print-done" : undefined}>{t.title}</span>
                {t.dueDate && <span className="print-due">due {fmt(t.dueDate)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {packing.length > 0 && (
        <section className="print-section">
          <h2>
            Packing list
            <span className="print-count">
              {packedCount}/{items.length} packed
            </span>
          </h2>
          {packing.map((g) => (
            <div className="print-pack-group print-avoid-break" key={g.category.id}>
              <h3 className="print-pack-head">{g.category.name}</h3>
              <ul className="print-checklist print-cols">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <span className="print-box">{i.checked ? "x" : ""}</span>
                    <span className={i.checked ? "print-done" : undefined}>
                      {i.name}
                      {i.quantity > 1 ? ` (${i.quantity})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <footer className="print-footer">
        Printed {fmt(new Date().toISOString().slice(0, 10))} · TripPlanner
      </footer>
    </article>
  );
}
