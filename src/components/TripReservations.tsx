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
                      : "border-white/5 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
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
    <div ref={rootRef} className="surface-raised rounded-xl border border-white/5 p-4 sm:p-5">
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
            <div className="surface-inset mb-3 rounded-lg border border-white/5 p-3">
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

          return (
            <div
              key={r.id}
              className="group rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-colors hover:border-white/10"
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
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
