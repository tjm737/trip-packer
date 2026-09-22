/*
 * What a share link is allowed to reveal.
 *
 * A share link is the only unauthenticated read path in the app, so what it
 * exposes is a privacy decision, not a display preference. This module owns that
 * decision in one place: the same section keys are used by the dialog that sets
 * them, the API that validates them, and the public endpoint that enforces them,
 * so those three cannot drift into disagreeing about what "hidden" means.
 *
 * Deliberately free of React, fetch, and database imports. The enforcement point
 * is the public API route (server-side), and the toggle UI is a client
 * component; both import this, so it must stay pure and side-effect free.
 */

import type { Trip, Reservation, Task, Category, PackingItem } from "./types";

/**
 * The sections a share link can show or hide.
 *
 * `itinerary` is the spine of the page and cannot be hidden — a share link that
 * shows nothing is not a share link, it is a dead URL. Everything else is
 * optional. See `SHAREABLE_SECTIONS` for the set the UI offers.
 */
export const SHARE_SECTIONS = ["itinerary", "packing", "tasks", "confirmations"] as const;

export type ShareSection = (typeof SHARE_SECTIONS)[number];

/**
 * Sections the owner is allowed to turn off.
 *
 * `itinerary` is excluded because hiding it would leave a page with a title and
 * nothing else.
 *
 * `map` and `notes` are deliberately absent from the type entirely, not merely
 * from this list. The shared view does not render a map or the trip's free-text
 * notes, so a toggle for either would be a control that changes nothing — worse
 * than no control, because an owner would tick it believing they had hidden
 * something. If those sections are ever added to the shared view, they get added
 * here at the same time, so the toggle and the thing it controls ship together.
 */
export const SHAREABLE_SECTIONS: readonly ShareSection[] = [
  "packing",
  "tasks",
  "confirmations",
] as const;

/** Human labels, kept beside the keys so a new section cannot be added unlabelled. */
export const SHARE_SECTION_LABELS: Record<ShareSection, string> = {
  itinerary: "Itinerary",
  packing: "Packing list",
  tasks: "To-do list",
  confirmations: "Booking confirmation numbers",
};

/** What a link shows when nobody has chosen: everything. */
export const DEFAULT_VISIBILITY: ShareVisibility = {
  itinerary: true,
  packing: true,
  tasks: true,
  confirmations: true,
};

export type ShareVisibility = Record<ShareSection, boolean>;

/**
 * Coerce anything into a complete, valid visibility record.
 *
 * Called on every read path — including the database row and the request body —
 * because a stored value can be missing (a row written before this feature
 * existed), partial, or hand-edited. Normalising at the boundary means the
 * render code can trust the shape and never has to ask "is this key present".
 *
 * Absent keys default to VISIBLE, which is the important part. The alternative
 * (default to hidden) would mean that a row saved before this feature existed
 * silently starts hiding sections the owner never chose to hide; failing open
 * here matches the previous behaviour exactly, so shipping this cannot change
 * what an existing link already shows.
 *
 * `itinerary` is forced on after the spread: an attacker-supplied `{"itinerary":
 * false}` would otherwise produce a share page with no content.
 */
export function normalizeVisibility(raw: unknown): ShareVisibility {
  const out: ShareVisibility = { ...DEFAULT_VISIBILITY };

  if (raw && typeof raw === "object") {
    const src = raw as Record<string, unknown>;
    for (const key of SHARE_SECTIONS) {
      const value = src[key];
      // Only a real boolean counts. A string "false" or 0 is a coercion trap and
      // is ignored rather than guessed at.
      if (typeof value === "boolean") out[key] = value;
    }
  }

  out.itinerary = true;
  return out;
}

/**
 * Parse a stored JSON blob into visibility, tolerating anything.
 *
 * Never throws. A corrupt or truncated value in the column must not take the
 * public share page down with a 500 — the failure mode for unparseable settings
 * is "shows the defaults", which is strictly better than "the link is broken".
 */
export function parseStoredVisibility(json: string | null | undefined): ShareVisibility {
  if (!json) return { ...DEFAULT_VISIBILITY };
  try {
    return normalizeVisibility(JSON.parse(json));
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
}

/** Serialise for storage. Only the known keys are written, never the input object. */
export function serializeVisibility(visibility: ShareVisibility): string {
  return JSON.stringify(normalizeVisibility(visibility));
}

/**
 * Whether a section is visible.
 *
 * A helper rather than `v[section]` so an unknown section name coming from a
 * URL param is treated as hidden instead of `undefined` (falsy) leaking into a
 * render condition in a way that reads as a bug.
 */
export function isVisible(visibility: ShareVisibility, section: string): boolean {
  return (SHARE_SECTIONS as readonly string[]).includes(section)
    ? visibility[section as ShareSection] === true
    : false;
}

/**
 * A shared trip's data, already filtered to what the link may reveal.
 *
 * Note what filtering does per section: hiding a section removes the underlying
 * rows, not just the markup. Hiding the packing list must not still ship the
 * packing items to the browser, or the "hidden" data is sitting in a fetch
 * response for anyone who opens devtools. That is the whole point of doing this
 * on the server.
 */
export type SharedTripPayload = {
  trip: {
    id: string;
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    notes: string;
    icon: string;
  };
  visibility: ShareVisibility;
  reservations: Reservation[];
  tasks: Task[];
  categories: Category[];
  items: PackingItem[];
};

/**
 * Filter a trip's rows down to the visible sections.
 *
 * Exported and pure so the enforcement can be unit-tested without a database or
 * an HTTP layer — the tests assert that hidden data is actually absent from the
 * payload, which is the property that matters.
 */
export function filterForShare(
  trip: Trip,
  visibility: ShareVisibility,
  rows: {
    reservations: Reservation[];
    tasks: Task[];
    categories: Category[];
    items: PackingItem[];
  }
): SharedTripPayload {
  const v = normalizeVisibility(visibility);

  const reservations = v.itinerary ? rows.reservations : [];

  /*
   * Confirmation references are stripped from the booking rows themselves rather
   * than by dropping the itinerary.
   *
   * A confirmation number is often the single most sensitive field on a booking
   * (it can be enough to change or cancel a reservation), but its absence must
   * not cost the recipient the flight time. So the value is blanked, leaving the
   * row and every other field intact.
   */
  const safeReservations = v.confirmations
    ? reservations
    : reservations.map((r) => ({ ...r, confirmation: "" }));

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      // Kept as-is: the shared view does not render trip notes at all, so there
      // is no toggle for them (see SHAREABLE_SECTIONS). Included here for
      // completeness of the trip header rather than as a reveal control.
      notes: trip.notes,
      icon: trip.icon,
    },
    visibility: v,
    reservations: safeReservations,
    tasks: v.tasks ? rows.tasks : [],
    // Categories and items are the packing list; hidden together or not at all,
    // since categories without items render as empty headings.
    categories: v.packing ? rows.categories : [],
    items: v.packing ? rows.items : [],
  };
}
