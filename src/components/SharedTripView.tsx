"use client";

import { useMemo, useState } from "react";
import {
  Plane,
  BedDouble,
  Car,
  TrainFront,
  Ship,
  Ticket,
  CalendarDays,
  Clock,
  MapPin,
  Hash,
  Check,
  ListChecks,
  Backpack,
  ExternalLink,
} from "lucide-react";
import type { Reservation, Task, Category, PackingItem, ReservationType } from "@/lib/types";
import { formatDateRange, formatDate } from "@/lib/dates";
import { noteUrl, noteLinkLabel } from "@/components/TripReservations";
import { Tooltip } from "@/components/ui/tooltip";
import type { ShareVisibility, SharedTripPayload } from "@/lib/shareVisibility";

/*
 * Read-only rendering of a shared trip.
 *
 * A client component only so the packing checklist can be collapsed on a phone.
 * There is no editing, no app state, and no persistence — every mutation path
 * lives behind AppContext, which this never touches.
 */

const TYPE_META: Record<ReservationType, { icon: typeof Plane; label: string }> = {
  flight: { icon: Plane, label: "Flight" },
  lodging: { icon: BedDouble, label: "Stay" },
  car: { icon: Car, label: "Car" },
  train: { icon: TrainFront, label: "Train" },
  ferry: { icon: Ship, label: "Ferry" },
  activity: { icon: Ticket, label: "Activity" },
  other: { icon: CalendarDays, label: "Booking" },
};

/** Sort by date then time; undated entries sink rather than jumping to the top. */
function byWhen(a: Reservation, b: Reservation): number {
  const ad = a.startDate || "9999-99-99";
  const bd = b.startDate || "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.startTime || "99:99";
  const bt = b.startTime || "99:99";
  return at < bt ? -1 : at > bt ? 1 : 0;
}

export function SharedTripView({
  trip,
  reservations,
  tasks,
  categories,
  items,
  visibility,
}: {
  /*
   * The subset of a trip a share link may render — NOT the full `Trip`.
   *
   * Deliberately narrower than the database row: `userId` (who owns the trip) and
   * `archived`/timestamps are not the viewer's business, and typing this prop as
   * a full Trip is what would tempt a future change into spreading the row. The
   * shape mirrors `SharedTripPayload["trip"]`, so the page cannot pass a field
   * the payload does not carry.
   */
  trip: SharedTripPayload["trip"];
  reservations: Reservation[];
  tasks: Task[];
  categories: Category[];
  items: PackingItem[];
  /*
   * What this link is allowed to reveal.
   *
   * Optional and defaulted so the component still renders for callers that have
   * not been updated, and so a missing value can never mean "hide everything".
   *
   * NOTE: this is presentation only. The rows for a hidden section have already
   * been removed from the payload by filterForShare on the server, so hiding a
   * section here is a second line of defence, not the control itself. Gating on
   * visibility in the view while still shipping the data would be a cosmetic
   * fix; that is why the filtering is done in one place server-side and the
   * empty arrays simply render as nothing.
   */
  visibility?: ShareVisibility;
}) {
  const [showPacking, setShowPacking] = useState(false);

  // Fail open on a missing record: `undefined` means "not told to hide anything",
  // which preserves the pre-feature behaviour for any older caller.
  const canSee = (section: keyof ShareVisibility): boolean => visibility?.[section] !== false;

  const sorted = useMemo(
    () => [...reservations].sort(byWhen),
    [reservations]
  );
  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => (a.dueDate || "9999-99-99").localeCompare(b.dueDate || "9999-99-99")),
    [tasks]
  );

  // formatDateRange returns a placeholder when both dates are empty; this view
  // omits the row entirely in that case, so normalise the placeholder to "".
  const rawRange = formatDateRange(trip.startDate, trip.endDate);
  const dateRange = rawRange === "No dates set" ? "" : rawRange;
  const packedCount = items.filter((i) => i.checked).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-emerald-400">
          <span>Shared itinerary</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-100 sm:text-3xl">
          <span className="mr-2">{trip.icon}</span>
          {trip.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
          {trip.destination && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" />
              {trip.destination}
            </span>
          )}
          {dateRange && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {dateRange}
            </span>
          )}
        </div>
        <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
          This is a read-only view. Changes you make here are not saved.
        </p>
      </header>

      {/* Itinerary */}
      <section className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          <CalendarDays className="h-4 w-4" />
          Itinerary
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
            {sorted.length}
          </span>
        </h2>

        {sorted.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
            No bookings have been added yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((r) => {
              const meta = TYPE_META[r.type] ?? TYPE_META.other;
              const Icon = meta.icon;
              const when = formatDate(r.startDate);
              /*
               * Link button for a URL in the notes.
               *
               * Derived from the notes text itself, so it inherits whatever
               * happens to the notes: no separate field to keep in sync, and no
               * URL to leak if the notes are ever emptied. The only visibility
               * rule that applies is the confirmation-number toggle, which does
               * not touch notes — a link in the notes is information the owner
               * typed into a field the viewer can already read in full.
               */
              const linkHref = noteUrl(r.notes);
              const linkLabel = noteLinkLabel(linkHref, r.title);
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-zinc-800 text-emerald-400">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <h3 className="font-medium text-zinc-100">{r.title}</h3>
                        <span className="text-xs uppercase tracking-wide text-zinc-500">
                          {meta.label}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                        {when && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {when}
                            {r.startTime && ` · ${r.startTime}`}
                            {r.endTime && r.endDate === r.startDate && ` – ${r.endTime}`}
                          </span>
                        )}
                        {r.endDate && r.endDate !== r.startDate && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            until {formatDate(r.endDate)}
                            {r.endTime && ` ${r.endTime}`}
                          </span>
                        )}
                        {canSee("confirmations") && r.confirmation && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Hash className="h-3.5 w-3.5" />
                            {r.confirmation}
                          </span>
                        )}
                      </div>

                      {/* Location: flights and trains have both ends. */}
                      {(r.location || r.locationTo) && (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                          <span className="truncate">
                            {r.location}
                            {r.locationTo && (
                              <>
                                <span className="mx-1.5 text-zinc-600">→</span>
                                {r.locationTo}
                              </>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Notes, with a link button when they contain a URL. */}
                      {r.notes && (
                        <div className="mt-2 flex flex-wrap items-start gap-2">
                          <p className="min-w-0 flex-1 whitespace-pre-line text-xs text-zinc-500">
                            {r.notes}
                          </p>
                          {/*
                            * The same noteUrl/noteLinkLabel helpers the owner's
                            * itinerary uses, imported rather than reimplemented:
                            * the two views must agree on what counts as a link
                            * and on what to call it, and a copy here would drift
                            * the moment either side changed.
                            *
                            * The parent is flex-wrap so a long note pushes the
                            * button onto its own line on a phone instead of
                            * squeezing both into one row.
                            */}
                          {linkHref && (
                            <Tooltip label={`Open ${linkLabel} listing`}>
                              <a
                                href={linkHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${linkLabel} listing`}
                                title={`Open ${linkLabel} listing`}
                                className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-emerald-500 bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-300 underline underline-offset-2 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring"
                              >
                                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                                <span>{linkLabel}</span>
                              </a>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Tasks */}
      {canSee("tasks") && sortedTasks.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            <ListChecks className="h-4 w-4" />
            To do
          </h2>
          <ul className="space-y-1.5">
            {sortedTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-2.5 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2"
              >
                <span
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                    t.done
                      ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                      : "border-zinc-600"
                  }`}
                >
                  {t.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className={`text-sm ${t.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}
                  >
                    {t.title}
                  </span>
                  {t.dueDate && (
                    <span className="ml-2 text-xs text-zinc-500">{formatDate(t.dueDate)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Packing — collapsed by default, it is the least useful thing to a companion. */}
      {canSee("packing") && items.length > 0 && (
        <section className="mb-6">
          <button
            type="button"
            onClick={() => setShowPacking((v) => !v)}
            aria-expanded={showPacking}
            className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900"
          >
            <Backpack className="h-4 w-4 text-zinc-400" />
            <span className="flex-1 text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Packing list
            </span>
            <span className="text-xs text-zinc-500">
              {packedCount}/{items.length} packed
            </span>
            <span className="text-xs text-zinc-500">{showPacking ? "Hide" : "Show"}</span>
          </button>

          {showPacking && (
            <div className="mt-2 space-y-3">
              {categories.map((c) => {
                const catItems = items.filter((i) => i.categoryId === c.id);
                if (catItems.length === 0) return null;
                return (
                  <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      {c.icon} {c.name}
                    </h3>
                    <ul className="space-y-1">
                      {catItems.map((i) => (
                        <li key={i.id} className="flex items-center gap-2 text-sm">
                          <span
                            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                              i.checked
                                ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                                : "border-zinc-600"
                            }`}
                          >
                            {i.checked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          <span className={i.checked ? "text-zinc-500 line-through" : "text-zinc-300"}>
                            {i.name}
                            {i.quantity > 1 && (
                              <span className="ml-1.5 text-xs text-zinc-500">×{i.quantity}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-zinc-800 pt-4 text-center text-xs text-zinc-600">
        Shared from TripPlanner
      </footer>
    </div>
  );
}
