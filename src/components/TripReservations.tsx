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
  ExternalLink,
  CheckCheck,
  CircleDashed,
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

/*
 * Confirmed vs draft, as a small pill.
 *
 * Always visible rather than revealed on hover: the entire question this field
 * answers — "what still needs a decision?" — is one you ask by scanning the
 * whole list, and a state you can only see by hovering is a state you cannot
 * scan. This is also why it sits before the edit/delete icons in the DOM: those
 * are per-row actions, this is row *content*.
 *
 * It is a button because tapping it is the primary way to change the state —
 * making people open the full editor to tick one box would be three taps and a
 * form for a single bit. It is therefore never disabled, and carries an
 * aria-label naming the action rather than the state, so a screen reader
 * announces what pressing it will do.
 */
function StatusPill({
  confirmed,
  onToggle,
}: {
  confirmed: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip label={confirmed ? "Mark as draft" : "Mark as confirmed"}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={confirmed}
        aria-label={confirmed ? "Mark as draft" : "Mark as confirmed"}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5",
          "text-[11px] font-medium transition-colors",
          confirmed
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
        )}
      >
        {confirmed ? (
          <CheckCheck className="h-3 w-3" />
        ) : (
          <CircleDashed className="h-3 w-3" />
        )}
        {confirmed ? "Confirmed" : "Draft"}
      </button>
    </Tooltip>
  );
}

/*
 * The same confirmed/draft choice, but for use inside a form.
 *
 * The row pill writes straight to the database, which is right for a one-tap
 * toggle but wrong in here: a form that persists as you touch it makes Cancel a
 * lie. This one edits the draft and nothing reaches the database until Save, so
 * the two controls are separate components rather than one with a mode flag.
 *
 * Both options are laid out and the current one is marked, instead of a single
 * button that flips. In a form the question is "which of these is it?", and
 * showing both states as a choice answers that without the user having to
 * predict what a tap would do.
 */
function StatusToggle({
  confirmed,
  onChange,
}: {
  confirmed: boolean;
  onChange: (next: boolean) => void;
}) {
  // These tones are applied only to the ACTIVE option, so they have to carry
  // the whole selected/unselected distinction on their own. Measured on the
  // rendered screenshot, an /10 fill over the panel read as (49,54,52) against
  // (46,46,46) for the unselected option — a 2-point green delta nobody can see.
  // The border is what actually signals selection, so it is solid rather than
  // alpha (alpha blends with whatever is behind it, so its contrast is not
  // knowable from this file) and the fill is raised to make the state legible
  // at a glance.
  const options = [
    {
      value: true,
      label: "Confirmed",
      icon: CheckCheck,
      tone: "border-emerald-500 bg-emerald-500/25 text-emerald-200",
    },
    {
      value: false,
      label: "Draft",
      icon: CircleDashed,
      tone: "border-amber-500 bg-amber-500/25 text-amber-200",
    },
  ];

  return (
    <div>
      <span className="mb-1.5 block text-xs text-zinc-400">Status</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
        {options.map((o) => {
          const OIcon = o.icon;
          const active = confirmed === o.value;
          return (
            <Tooltip
              key={o.label}
              label={
                o.value
                  ? "This booking is booked and paid for"
                  : "Not booked yet — still deciding"
              }
            >
              <button
                type="button"
                onClick={() => onChange(o.value)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  active
                    ? o.tone
                    : "border-white/8 bg-white/[0.02] text-zinc-400 hover:text-zinc-200"
                )}
              >
                <OIcon className="h-3.5 w-3.5" />
                {o.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

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
 * The first http(s) link in a booking's notes, if there is one.
 *
 * Notes are free text and the field was never meant to carry links, but the
 * itinerary importer already writes one in: it stores
 * `"<note> · <listing url>"`, so every Airbnb/VRBO import lands here with the
 * listing URL sitting in the notes string. Rather than migrate the schema for
 * data users can equally well type by hand, the URL is read back out at render
 * time.
 *
 * Only http/https is matched. Deliberately NOT matched:
 *
 *   - `javascript:` and `data:` — rendering user text as a clickable link is
 *     exactly where those become an XSS vector, and this string comes from an
 *     imported file. Rejecting them by only accepting http(s) is safer than
 *     escaping them.
 *   - bare `www.foo.com` / `foo.com/x` — without a scheme the "is this a link"
 *     guess gets ambiguous (in "Arrive 8.30am, email john.co" the domain-shaped
 *     tail is not a link), and guessing wrong turns note text into a button.
 *     A pasted link has a scheme; that is the signal used here.
 *
 * The match stops at whitespace, then trailing punctuation is trimmed, because
 * a URL at the end of a sentence swallows the full stop: "see https://x.com/a."
 * must not produce a link to `a.`.
 */
const NOTE_URL = /\bhttps?:\/\/[^\s<>"')\]]+/i;

export function noteUrl(notes: string): string {
  const match = NOTE_URL.exec(notes || "");
  if (!match) return "";
  // Trailing sentence punctuation, and a closing paren only when unbalanced
  // (Wikipedia-style URLs legitimately end in ")").
  let url = match[0].replace(/[.,;:!?]+$/, "");
  const opens = (url.match(/\(/g) || []).length;
  const closes = (url.match(/\)/g) || []).length;
  if (closes > opens) url = url.replace(/\)+$/, "");
  return url;
}

/*
 * What to call the link button.
 *
 * The host, minus "www." and the public suffix, title-cased: airbnb.com →
 * "Airbnb", booking.com → "Booking.com" is not achievable this way, so known
 * brands are mapped explicitly. The label matters more than it looks — several
 * bookings in one list will each show a button, and "Open listing" repeated six
 * times tells the user nothing about which is which, which is the same failure
 * already fixed for the Maps links.
 */
const LINK_LABELS: Record<string, string> = {
  "airbnb.com": "Airbnb",
  "booking.com": "Booking.com",
  "vrbo.com": "VRBO",
  "expedia.com": "Expedia",
  "hotels.com": "Hotels.com",
  "tripadvisor.com": "Tripadvisor",
  "agoda.com": "Agoda",
  "hostelworld.com": "Hostelworld",
  "rentalcars.com": "Rentalcars",
  "hertz.com": "Hertz",
  "avis.com": "Avis",
  "sixt.com": "Sixt",
  "lufthansa.com": "Lufthansa",
  "united.com": "United",
  "delta.com": "Delta",
  "aa.com": "American",
  "ba.com": "British Airways",
};

/*
 * Second-level labels that are part of the public suffix, not the site name.
 * Needed so "tickets.example.co.uk" resolves to "Example" rather than "Co".
 * A full Public Suffix List is overkill here - these are the ones that actually
 * appear in travel booking URLs - and the cost of a miss is only a slightly
 * off button caption, never a broken link.
 */
const MULTI_PART_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "co.kr", "com.br", "com.mx", "co.za", "co.in",
]);

/*
 * What to call the link button.
 *
 * Known brands are mapped explicitly. Everything else falls back to the booking
 * title, then to a host fragment.
 *
 * The title is preferred over the host because the host is often not a name at
 * all: the real list produced "Open Michelin listing" three times for three
 * different restaurants (all on guide.michelin.com), "Bz" for a hotel on
 * spitalerhof.bz.it, and "Wurzer-alm". Three buttons with identical captions in
 * one list is the same "which one is which" failure already fixed for the Maps
 * links - the title is the name the user themselves gave the booking, so it
 * always disambiguates. The host is kept only for the case where the title is
 * missing or is not a name.
 */
export function noteLinkLabel(url: string | null, title = ""): string {
  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (LINK_LABELS[host]) return LINK_LABELS[host];
    const cleanTitle = (title || "").trim();
    if (cleanTitle) return cleanTitle;
    const parts = host.split(".");
    if (parts.length < 2) return host || "Link";
    // Walk back past the suffix, then take the label before it:
    //   airbnb.com            -> airbnb
    //   tickets.example.co.uk -> example
    let i = parts.length - 2;
    const tail2 = parts.slice(-2).join(".");
    if (MULTI_PART_SUFFIX.has(tail2) && parts.length >= 3) i = parts.length - 3;
    const core = parts[i];
    if (!core) return "Link";
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "Link";
  }
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
  confirmed: boolean;
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
  // A booking added by hand is one you have made; a draft is the exception you
  // opt into, not the state you start in.
  confirmed: true,
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
  confirmed: r.confirmed,
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

  // Pending decisions in this trip. Counted from the full list, not the
  // collapsed `Show all` slice, so the badge does not change meaning when the
  // list is expanded.
  const draftCount = items.filter((r) => !r.confirmed).length;

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

  /*
   * Flip a booking between confirmed and draft.
   *
   * Optimistic on purpose: the AppContext `update` publishes the new state
   * immediately and rolls back on failure, so the pill responds on tap instead
   * of after a round trip. The mutation is also the same one the editor uses,
   * so toggling here and toggling in the form cannot drift apart.
   */
  const toggleConfirmed = async (r: Reservation) => {
    await reservation.update(r.id, { confirmed: !r.confirmed });
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
        <StatusToggle
          confirmed={d.confirmed}
          onChange={(next) => set((p) => ({ ...p, confirmed: next }))}
        />

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
          {/*
            Surface the draft count here because it is the one thing about this
            list you cannot see at a glance once it is long — the pills are
            per-row, so counting them means reading every row. Only shown when
            non-zero: a permanent "0 drafts" is noise.
          */}
          {draftCount > 0 && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              {draftCount} draft{draftCount === 1 ? "" : "s"}
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
          // A listing URL living in the notes, if any. Computed alongside
          // mapsQuery for the same reason: the button either exists or does
          // not, never half-present.
          const linkHref = noteUrl(r.notes);
          const linkLabel = noteLinkLabel(linkHref, r.title);

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
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-100">
                        {r.title}
                      </p>
                      <StatusPill
                        confirmed={r.confirmed}
                        onToggle={() => toggleConfirmed(r)}
                      />
                    </div>
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
                      {/*
                        * The row's outbound actions, grouped so they stay
                        * adjacent and together at the right edge.
                        *
                        * `ml-auto` belongs on this wrapper, NOT on each link.
                        * With an auto margin on both, the free space is split
                        * between them and the first action floats in the middle
                        * of the row: Map measured at x=245 with the Airbnb link
                        * at x=354, 79px apart, on the Erding row. One auto
                        * margin on the container right-aligns the pair and
                        * leaves them touching.
                        *
                        * `gap-2` not `gap-1.5`: each pill carries `-ml-1` to
                        * widen its left hit area, and that negative margin eats
                        * into the gap. At `gap-1.5` the two visible boxes sat
                        * 2px apart - close enough to read as a rendering error
                        * rather than as two separate controls.
                        */}
                      <div className="ml-auto flex shrink-0 items-center gap-2">
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
                            // `min-h-6` keeps that floor on mobile, where the
                            // "Map" label is hidden and the 12px icon would
                            // otherwise collapse the target to 20px.
                            // sage-300 at rest, matching the Confirmed pill's text
                            // colour so the row's two interactive elements read as
                            // the same family. Brightens to sage-400 on hover.
                            //
                            // Underlined because colour alone is not an affordance:
                            // the pill beside it is also sage, so hue cannot be the
                            // only thing separating a status badge from a control.
                            // This mirrors the existing sage link in TripTasks
                            // (underline + underline-offset-2 + focus-ring) rather
                            // than inventing a second link style.
                            // Icon size steps up on mobile: every action icon in
                            // this row (edit, delete, add, confirm) is h-3.5, and
                            // only decorative metadata glyphs are h-3. Below the sm
                            // breakpoint the "Map" label is hidden, so the icon is
                            // the entire target - at 12px it read as dim metadata
                            // rather than a sage control. h-3.5 there, h-3 from sm
                            // up where the label carries the affordance.
                            //
                            // Mobile sizing: the icon is the whole target below sm
                            // (label hidden), so it gets a thumb-sized 32px row and
                            // a 16px glyph. The extra height is pulled back out by
                            // the -my-2 negative margin, so the card does not grow -
                            // the pill simply overlaps the line's leading rather
                            // than pushing the layout. From sm up the label returns
                            // and carries the affordance, so it drops back to a
                            // compact 12px icon with no vertical padding.
                            //
                            // The mobile affordance is a tinted background, not an
                            // underline: text-decoration only paints under text
                            // runs, so with the label display:none an underline had
                            // nothing to draw under.
                            //
                            // The border carries the affordance and is a SOLID
                            // token, not an alpha one. Alpha blends with whatever
                            // card surface sits behind it, which made the measured
                            // contrast unpredictable: emerald-400/30 measured
                            // 1.62:1 and /50 only 2.21:1 against the card, both
                            // under the 3:1 WCAG minimum for non-text UI. Solid
                            // emerald-500 measures 3.73:1 and is stable across
                            // surfaces. It is also the darker sage, so it does not
                            // compete with the brighter emerald-300 icon
                            // (which differs by only 1.02:1 - the icon would
                            // vanish against an emerald-300/400 border).
                            // The fill stays subtle; the border does the work.
                            // Pushed to the right edge on mobile by the wrapper's
                            // `ml-auto` (see the group comment above), which is
                            // why this element does not carry one itself.
                            // Without the push the link sat immediately after the
                            // location text, so its x position moved with the
                            // length of the destination - measured anywhere
                            // between x=167 and x=216 on the same screen, with
                            // up to 187px of dead space to its right. Pinning it
                            // right puts every row's Map control in one column.
                            //
                            // The right side of the negative margin is dropped on
                            // mobile: `-mx-1` widens the tap target, but the
                            // wrapper's `ml-auto` resolves against the margin
                            // box, so the visible box landed 4px past the row's
                            // right edge. `-ml-1` keeps the extra left hit area,
                            // `mr-0` keeps the visible edge flush. From sm up the
                            // link is inline again, so the original
                            // `-mx-1 sm:mx-0` behaviour is restored.
                            className="-ml-1 mr-0 -my-2 inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-emerald-500 bg-emerald-500/20 px-1.5 py-2 text-[11px] text-emerald-300 underline underline-offset-2 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:mx-0 sm:my-1 sm:min-h-6 sm:justify-start sm:rounded sm:border-0 sm:bg-transparent sm:px-1.5 sm:py-1 sm:hover:bg-emerald-500/10 sm:hover:text-emerald-400"
                          >
                            <MapIcon className="h-4 w-4 sm:h-3 sm:w-3" strokeWidth={2} />
                            <span className="hidden sm:inline">Map</span>
                          </a>
                        </Tooltip>
                      )}

                      {/*
                        * Link button, shown when the notes contain an http(s)
                        * URL - which the itinerary importer already produces,
                        * storing `<note> · <listing url>`.
                        *
                        * Same construction as the Map link beside it, on
                        * purpose: both are "go somewhere else" actions in the
                        * same row, so they share the sage pill, the solid
                        * emerald border (alpha borders measured unpredictably
                        * against the card), the 32px mobile tap target and the
                        * ml-auto right alignment. A second, differently-styled
                        * button here would read as a different kind of thing.
                        *
                        * The label names the destination host ("Airbnb") rather
                        * than saying "Link", because a list of bookings will
                        * show several of these and identical captions tell the
                        * user nothing.
                        *
                        * An anchor, not a button: it navigates, so middle-click,
                        * cmd-click, "copy link" and long-press-to-open-in-app
                        * come for free. `noopener noreferrer` on an external
                        * target, and the accessible name includes the host.
                        */}
                      {linkHref && (
                        <Tooltip label={`Open ${linkLabel} listing`}>
                          <a
                            href={linkHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${linkLabel} listing`}
                            title={`Open ${linkLabel} listing`}
                            className="-ml-1 mr-0 -my-2 inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-emerald-500 bg-emerald-500/20 px-1.5 py-2 text-[11px] text-emerald-300 underline underline-offset-2 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:mx-0 sm:my-1 sm:min-h-6 sm:justify-start sm:rounded sm:border-0 sm:bg-transparent sm:px-1.5 sm:py-1 sm:hover:bg-emerald-500/10 sm:hover:text-emerald-400"
                          >
                            <ExternalLink className="h-4 w-4 sm:h-3 sm:w-3" strokeWidth={2} />
                            <span className="hidden sm:inline">{linkLabel}</span>
                          </a>
                        </Tooltip>
                      )}
                      </div>
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
