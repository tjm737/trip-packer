"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plane,
  BedDouble,
  Car,
  TrainFront,
  Ship,
  Ticket,
  CalendarCheck,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  Clock,
  MapPin,
  ArrowRight,
  Map as MapIcon,
  Hash,
  Wallet,
  StickyNote,
} from "lucide-react";

import { useApp } from "@/lib/AppContext";
import { subscribeEditRequests } from "@/lib/editRequest";
import { Reservation, ReservationType } from "@/lib/types";
import { formatDate, isValidDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

/*
 * Is this location string something a maps provider can actually resolve?
 *
 * The `location` field is free text, and users reasonably type both "12 Baker
 * Street, London" and "near the airport". Handing the second to a maps provider
 * is worse than showing no button: it resolves to *something* — a confidently
 * wrong pin, the same failure mode as OSRM silently relocating an
 * out-of-coverage endpoint. So the check is deliberately conservative and the
 * button simply does not appear when the text is not a place.
 *
 * Two classes are rejected:
 *
 *   - vague descriptors ("near MUC", "somewhere in the centre"), which have no
 *     single coordinate;
 *   - anything with too little to go on (a bare "TBD"), which would resolve to
 *     nothing useful.
 *
 * Airport codes are deliberately *kept*: "PHL" and "MUC (T1)" are real,
 * resolvable places and are exactly what a traveller needs at a counter.
 */
const VAGUE_LOCATION =
  /\b(near|nearby|around|somewhere|tbd|tba|unknown|anywhere|unspecified|n\/a)\b/i;

export function isMappableLocation(value: string | undefined | null): boolean {
  const text = (value ?? "").trim();
  if (text.length < 2) return false;
  // A bare placeholder or a single stray character is not a destination.
  if (!/[a-z0-9]/i.test(text)) return false;
  return !VAGUE_LOCATION.test(text);
}

/*
 * A Google Maps search URL for a location.
 *
 * The documented `search` endpoint with `query` is used rather than the
 * `/maps/place/` form: `query` accepts a free-form string and needs no place
 * ID, which is all we have — the app stores text, never a Google identifier.
 * `api=1` is Google's marker for the supported cross-platform URL scheme, and
 * the whole thing is returned as a plain https link so it opens the Maps app on
 * iOS and Android and a new tab on desktop.
 */
export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

/*
 * The location to send to a maps provider for a booking.
 *
 * Travel bookings have two ends; a map link is only ever for one of them, so
 * the primary location is preferred and the destination is the fallback (a
 * flight whose origin was left blank still has somewhere worth showing). The
 * booking title is appended as a hint when it is not already part of the
 * address, because "Sofitel London Heathrow" resolves far better than
 * "Terminal 5" on its own.
 */
/*
 * Titles that describe a stay rather than name a venue.
 *
 * A title is only useful to a maps provider when it is the *name of a place* —
 * "Hidalgo", "Arunda Sektkellerei". Many are descriptions instead: "Fantastic
 * Penthouse, Lake View", "Reykjavík hotel (not yet booked)", "PHL to Iceland".
 * Appending those produces a long, low-signal query that geocoders handle
 * worse than the plain location, so they are filtered out and the location is
 * used alone.
 */
const DESCRIPTIVE_TITLE =
  /\b(not yet booked|to be booked|tbd|tba|penthouse|apartment|flat|house|home|room|hotel|airbnb|vrbo|booking|stay|rental|guesthouse|hostel|lodge|to\s+[a-z]+|from\s+[a-z]+)\b/i;

export function mappableLocation(r: {
  location?: string;
  locationTo?: string;
  title?: string;
}): string | null {
  const loc = (r.location ?? "").trim();
  const to = (r.locationTo ?? "").trim();

  /*
   * Prefer a resolvable location. When neither end is usable — "near MUC" is
   * the real case — fall back to the title *only if it names a place*, since a
   * hotel whose location the user left vague often has a perfectly good town as
   * its name ("Erding").
   */
  let primary: string | null = null;
  let fromTitleOnly = false;
  if (isMappableLocation(loc)) primary = loc;
  else if (isMappableLocation(to)) primary = to;
  else if ((r.title ?? "").trim().length >= 3 && isMappableLocation(r.title)) {
    primary = r.title!.trim();
    fromTitleOnly = true;
  }
  if (!primary) return null;

  // When the location itself came from the title there is nothing to append.
  if (fromTitleOnly) return primary;

  const title = (r.title ?? "").trim();
  if (!title || title.length < 3) return primary;
  // Flight numbers (BA936) and booking codes are not places.
  if (/^[A-Z]{2}\d{1,4}$/.test(title)) return primary;
  // Descriptions of a stay make a worse query than the address alone.
  if (DESCRIPTIVE_TITLE.test(title)) return primary;
  // The departure→arrival form of a travel title names two places at once.
  if (/\b(to|→)\b/.test(title)) return primary;
  if (primary.toLowerCase().includes(title.toLowerCase())) return primary;

  return `${primary}, ${title}`;
}

/*
 * Reservations: the flights, beds and cars that make up the trip.
 *
 * Distinct from the packing list and the task list. A reservation is a record
 * of something already booked — its value is the confirmation number and the
 * time you have to be somewhere, which is what you need at a counter.
 *
 * Two deliberate structural choices:
 *
 *   1. `type` drives which fields the form shows. A lodging booking has no
 *      arrival airport and a flight has no checkout, so showing every field
 *      for every type would mean half of them are noise.
 *
 *   2. Fields that do not apply are stored as "" rather than omitted, so a
 *      half-completed booking (hotel booked, check-in time unknown) still
 *      saves cleanly and can be filled in later.
 */

const TYPES: {
  value: ReservationType;
  label: string;
  icon: typeof Plane;
  /** Colour of the leading icon chip, keeping the emerald/zinc palette. */
  tone: string;
}[] = [
  { value: "flight", label: "Flight", icon: Plane, tone: "text-sky-400 bg-sky-400/10" },
  { value: "lodging", label: "Lodging", icon: BedDouble, tone: "text-violet-400 bg-violet-400/10" },
  { value: "car", label: "Car", icon: Car, tone: "text-amber-400 bg-amber-400/10" },
  { value: "train", label: "Train", icon: TrainFront, tone: "text-emerald-400 bg-emerald-400/10" },
  { value: "ferry", label: "Ferry", icon: Ship, tone: "text-cyan-400 bg-cyan-400/10" },
  { value: "activity", label: "Activity", icon: Ticket, tone: "text-rose-400 bg-rose-400/10" },
  { value: "other", label: "Other", icon: CalendarCheck, tone: "text-zinc-400 bg-zinc-400/10" },
];

const typeMeta = (t: ReservationType) => TYPES.find((x) => x.value === t) ?? TYPES[TYPES.length - 1];

/**
 * Which fields each type actually uses. Driving the form off this keeps the
 * two-location concept (departure → arrival) for travel types and a single
 * location for things that happen in one place.
 */
export const FIELDS: Record<
  ReservationType,
  { fromLabel?: string; toLabel?: string; startLabel: string; endLabel?: string }
> = {
  flight: { fromLabel: "From", toLabel: "To", startLabel: "Departure", endLabel: "Arrival" },
  train: { fromLabel: "From", toLabel: "To", startLabel: "Departure", endLabel: "Arrival" },
  ferry: { fromLabel: "From", toLabel: "To", startLabel: "Departure", endLabel: "Arrival" },
  lodging: { fromLabel: "Address", startLabel: "Check-in", endLabel: "Check-out" },
  car: { fromLabel: "Pickup location", startLabel: "Pickup", endLabel: "Drop-off" },
  activity: { fromLabel: "Location", startLabel: "Starts", endLabel: "Ends" },
  other: { fromLabel: "Location", startLabel: "Starts", endLabel: "Ends" },
};

export type Draft = {
  type: ReservationType;
  title: string;
  confirmation: string;
  location: string;
  locationTo: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  cost: string;
  notes: string;
};

export const emptyDraft = (type: ReservationType = "flight"): Draft => ({
  type,
  title: "",
  confirmation: "",
  location: "",
  locationTo: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  cost: "",
  notes: "",
});

export const toDraft = (r: Reservation): Draft => ({
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

/** "16:45" → "4:45 PM". Leaves anything unparseable untouched. */
function formatTime(t: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export function TripReservations({ tripId }: { tripId: string }) {
  const { reservation, helpers } = useApp();
  const items = helpers.getReservations(tripId);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const canAdd = draft.title.trim().length > 0 && !busy;

  const submitNew = async () => {
    if (!canAdd) return;
    setBusy(true);
    try {
      await reservation.create(tripId, draft);
      setDraft(emptyDraft(draft.type));
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: Reservation) => {
    setEditingId(r.id);
    setEditDraft(toDraft(r));
  };

  /*
   * Honour an "edit this booking" request from elsewhere on the page (today:
   * the map's stop rows). Reading the record at fire time rather than trusting
   * the caller's copy means the editor always opens on current stored values.
   *
   * The records are read through a ref so the subscription is installed once
   * but always sees the latest data — capturing `items` directly in a
   * mount-only effect would freeze it at the empty first render.
   */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /* The panel's own root, so an external request can bring it into view. */
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return subscribeEditRequests((id) => {
      const r = itemsRef.current.find((x) => x.id === id);
      if (!r) return;
      setEditingId(r.id);
      setEditDraft(toDraft(r));
      /*
       * The reservations panel sits below the map, so an "Open full editor"
       * click from a map stop would otherwise appear to do nothing. Wait a
       * frame for the editor to mount, then bring the row into view.
       */
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector(`[data-reservation-id="${id}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
  }, []);

  const submitEdit = async () => {
    if (!editingId || !editDraft.title.trim() || busy) return;
    setBusy(true);
    try {
      // `type` is intentionally absent: changing a booking's category is a
      // delete-and-re-add, not an edit.
      const { type: _type, ...updates } = editDraft;
      await reservation.update(editingId, updates);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await reservation.delete(id);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The form lives in its own component-ish block because the add form and the
   * inline edit form are the same fields. Rendering it from one place is what
   * keeps the labels ("Check-in" vs "Departure") honest for both.
   */
  const renderFields = (
    d: Draft,
    set: (updater: (prev: Draft) => Draft) => void,
    onTypeChange?: (t: ReservationType) => void
  ) => {
    const f = FIELDS[d.type];
    return (
      <div className="space-y-3">
        {onTypeChange && (
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const active = d.type === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onTypeChange(t.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    active
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-white/8 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <Input
          value={d.title}
          onChange={(e) => set((p) => ({ ...p, title: e.target.value }))}
          placeholder={
            d.type === "flight"
              ? "e.g. KEF → SEA, Icelandair 614"
              : d.type === "lodging"
                ? "e.g. Blue Lagoon Guesthouse"
                : "e.g. Hertz rental car"
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              {f.fromLabel}
            </label>
            <Input
              value={d.location}
              onChange={(e) => set((p) => ({ ...p, location: e.target.value }))}
              placeholder="City, airport or address"
            />
          </div>
          {f.toLabel && (
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
                {f.toLabel}
              </label>
              <Input
                value={d.locationTo}
                onChange={(e) => set((p) => ({ ...p, locationTo: e.target.value }))}
                placeholder="City or airport"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              {f.startLabel} date
            </label>
            <Input
              type="date"
              value={d.startDate}
              onChange={(e) => set((p) => ({ ...p, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              {f.startLabel} time
            </label>
            <Input
              type="time"
              value={d.startTime}
              onChange={(e) => set((p) => ({ ...p, startTime: e.target.value }))}
            />
          </div>
        </div>

        {f.endLabel && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
                {f.endLabel} date
              </label>
              <Input
                type="date"
                value={d.endDate}
                onChange={(e) => set((p) => ({ ...p, endDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
                {f.endLabel} time
              </label>
              <Input
                type="time"
                value={d.endTime}
                onChange={(e) => set((p) => ({ ...p, endTime: e.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              Confirmation
            </label>
            <Input
              value={d.confirmation}
              onChange={(e) => set((p) => ({ ...p, confirmation: e.target.value }))}
              placeholder="Booking reference"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              Cost
            </label>
            <Input
              value={d.cost}
              onChange={(e) => set((p) => ({ ...p, cost: e.target.value }))}
              placeholder="e.g. 612.40 USD"
            />
          </div>
        </div>

        <Input
          value={d.notes}
          onChange={(e) => set((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Notes — seat, bag, check-in details"
        />
      </div>
    );
  };

  return (
    <div ref={rootRef} className="surface-raised rounded-xl border border-white/8 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-zinc-200">Reservations</h2>
          {items.length > 0 && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
              {items.length}
            </span>
          )}
        </div>

        {!adding && (
          <Tooltip label="Add a booking">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(emptyDraft());
                setAdding(true);
              }}
              className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:text-emerald-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </Tooltip>
        )}
      </div>

      {items.length === 0 && !adding && (
        <p className="py-2 text-sm text-zinc-500">
          No bookings yet. Add flights, lodging or a rental car so the details are
          in one place when you need them.
        </p>
      )}

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="surface-inset mb-3 rounded-lg border border-white/8 p-3">
              {renderFields(draft, setDraft, (t) => setDraft((p) => ({ ...p, type: t })))}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={submitNew} disabled={!canAdd} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {busy ? "Saving…" : "Add booking"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setDraft(emptyDraft());
                  }}
                  className="gap-1.5 text-zinc-400"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {(showAll ? items : items.slice(0, 4)).map((r) => {
          const meta = typeMeta(r.type);
          const Icon = meta.icon;
          const editing = editingId === r.id;
          const f = FIELDS[r.type];

          if (editing) {
            return (
              <div
                key={r.id}
                data-reservation-id={r.id}
                className="surface-inset rounded-lg border border-emerald-500/20 p-3"
              >
                {renderFields(editDraft, setEditDraft)}
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" onClick={submitEdit} disabled={busy} className="gap-1.5">
                    <Check className="h-3.5 w-3.5" />
                    {busy ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    className="gap-1.5 text-zinc-400"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            );
          }

          const hasWhen = isValidDate(r.startDate);
          const travel = Boolean(f.toLabel);
          // Where the "Map" link points, or null when the stored text is not a
          // resolvable place. Computed per row rather than per render so the
          // link either exists or does not, with no half-state.
          const mapsQuery = mappableLocation(r);

          return (
            <div
              key={r.id}
              className="group rounded-lg border border-white/8 bg-white/[0.02] p-3 transition-colors hover:border-white/10"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    meta.tone
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-zinc-100">{r.title}</p>
                    <div className="flex shrink-0 items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100">
                      <Tooltip label="Edit booking">
                        <button
                          onClick={() => startEdit(r)}
                          className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                          aria-label="Edit booking"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete booking">
                        <button
                          onClick={() => remove(r.id)}
                          className="rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-rose-400"
                          aria-label="Delete booking"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>

                  {/* Where */}
                  {(r.location || r.locationTo) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                      <MapPin className="h-3 w-3 shrink-0 text-zinc-500" />
                      {travel && r.location && r.locationTo ? (
                        <>
                          <span className="truncate">{r.location}</span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-zinc-600" />
                          <span className="truncate">{r.locationTo}</span>
                        </>
                      ) : (
                        <span className="truncate">{r.location || r.locationTo}</span>
                      )}

                      {/*
                        * Map link, shown only when the stored text is something
                        * a maps provider can resolve — see `mappableLocation`.
                        *
                        * An anchor rather than a button because it navigates:
                        * the browser gives it middle-click, cmd-click, "copy
                        * link" and long-press-to-open-in-app for free, none of
                        * which a click handler would provide.
                        *
                        * The accessible name names the destination, so a screen
                        * reader hearing a list of identical "Open in Maps" links
                        * still knows which booking each one belongs to.
                        */}
                      {mapsQuery && (
                        <Tooltip label={`Open ${mapsQuery} in Google Maps`}>
                          <a
                            href={googleMapsUrl(mapsQuery)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${mapsQuery} in Google Maps`}
                            title={`Open ${mapsQuery} in Google Maps`}
                            // `-my-1 py-1` grows the tap target to a reliable
                            // 24px without adding height to the row: the extra
                            // padding is pulled back out by the negative margin,
                            // which is why this does not shift the layout.
                            className="-my-1 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-emerald-400"
                          >
                            <MapIcon className="h-3 w-3" />
                            <span className="hidden sm:inline">Map</span>
                          </a>
                        </Tooltip>
                      )}
                    </div>
                  )}

                  {/* When */}
                  {(hasWhen || r.startTime || r.endTime) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-zinc-500" />
                        {hasWhen ? formatDate(r.startDate) : "No date"}
                        {r.startTime && <span className="text-zinc-300">{formatTime(r.startTime)}</span>}
                      </span>
                      {isValidDate(r.endDate) && (
                        <span className="text-zinc-500">
                          → {formatDate(r.endDate)}
                          {r.endTime && ` ${formatTime(r.endTime)}`}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Confirmation and cost */}
                  {(r.confirmation || r.cost || r.notes) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {r.confirmation && (
                        <span className="inline-flex items-center gap-1.5 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                          <Hash className="h-3 w-3" />
                          {r.confirmation}
                        </span>
                      )}
                      {r.cost && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-400">
                          <Wallet className="h-3 w-3 text-zinc-500" />
                          {r.cost}
                        </span>
                      )}
                      {r.notes && (
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500">
                          <StickyNote className="h-3 w-3 shrink-0" />
                          <span className="truncate">{r.notes}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {items.length > 4 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full rounded-lg py-1.5 text-xs text-zinc-500 transition-colors hover:bg-white/[0.02] hover:text-zinc-300"
          >
            {showAll ? "Show less" : `Show all ${items.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
