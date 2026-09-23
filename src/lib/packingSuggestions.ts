/*
 * Packing suggestions from the on-device model.
 *
 * Split into a pure half (prompt building + response normalising) and a thin
 * IO half, so the interesting logic is testable in Node with no native bridge
 * present. The IO half is deliberately the boring part.
 *
 * The contract that matters: this module only ever PRODUCES candidates. It
 * never writes to the packing list. Adding is the user's click, handled by the
 * calling component -- a model that silently edits the user's list is a bug,
 * not a feature.
 */

import type { Reservation } from "./types";

/** A single candidate the user may choose to add. */
export interface PackingSuggestion {
  name: string;
  /** Short reason, shown under the name. Optional -- the model may omit it. */
  reason?: string;
}

/**
 * A booked activity, reduced to the few facts worth spending context on.
 *
 * Deliberately not the whole Reservation: confirmation codes, costs and ids
 * are noise to a packing model and each one costs context on a small window.
 */
export interface PlannedActivity {
  /** Venue or event, e.g. "Noma", "Blue Lagoon". */
  title: string;
  /** "HH:MM" 24h, or "" when unknown. A time is a strong signal: 19:30 reads
   *  as dinner, 07:00 as an early start that needs layers. */
  time?: string;
  /** Free text the user wrote, e.g. "jacket required". */
  notes?: string;
}

export interface SuggestContext {
  /** Trip destination, e.g. "Tokyo, Japan". */
  destination: string;
  /** Trip length in days, when known. */
  days?: number;
  /** Month the trip starts, 1-12, when known. Drives climate reasoning. */
  month?: number;
  /**
   * Booked activities and other non-transport plans. Grounds the model in what
   * the trip will actually involve, so a dinner reservation can pull in a
   * formal outfit rather than the model guessing from the destination alone.
   */
  activities?: PlannedActivity[];
  /** Names already on the list, so the model avoids re-suggesting them. */
  existing?: string[];
}

/** How many suggestions to ask for. Enough to be useful, few enough to scan. */
export const MAX_SUGGESTIONS = 12;

/**
 * How many booked activities to describe in the prompt.
 *
 * Capped because the on-device model has a small context window: a long tail of
 * activities pushes the output-format instruction out, and a malformed reply
 * costs more than the extra grounding is worth. Eight covers a normal trip and
 * keeps the prompt in the same size class as the weather-only version.
 */
export const MAX_ACTIVITIES_IN_PROMPT = 8;

/** Characters of user notes per activity. Notes are free text and can be
 *  paragraphs; a sentence is enough to carry "jacket required". */
const MAX_NOTE_CHARS = 80;


const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Describe the trip in one compact line.
 *
 * Kept terse on purpose: the on-device model has a small context window, and
 * padding the prompt with prose measurably degrades output on short prompts.
 * Only facts the user actually gave are included -- an invented "beach trip"
 * would steer the model toward irrelevant items.
 */
export function describeTrip(ctx: SuggestContext): string {
  const parts: string[] = [];
  const dest = ctx.destination?.trim();
  if (dest) parts.push(dest);
  if (typeof ctx.days === "number" && ctx.days > 0) {
    parts.push(`${ctx.days} day${ctx.days === 1 ? "" : "s"}`);
  }
  if (typeof ctx.month === "number" && ctx.month >= 1 && ctx.month <= 12) {
    parts.push(`in ${MONTHS[ctx.month - 1]}`);
  }
  return parts.join(", ");
}

/**
 * Turn booked activities into compact lines for the prompt.
 *
 * Returns [] when there is nothing usable, so the caller can omit the section
 * entirely rather than emit an empty heading that wastes context and invites
 * the model to fill the gap by inventing.
 *
 * Order is preserved (the caller sorts by trip order) because a dinner on the
 * last night and a hike on the first carry different packing weight, and the
 * model has no other way to tell them apart. Blank titles are dropped: an
 * activity with no name is not something the model can reason about.
 */
export function describeActivities(activities: PlannedActivity[] = []): string[] {
  return activities
    .map((a) => {
      const title = (a?.title ?? "").trim();
      if (!title) return null;

      const bits: string[] = [];
      const time = (a?.time ?? "").trim();
      if (time) bits.push(`at ${time}`);

      const notes = (a?.notes ?? "").replace(/\s+/g, " ").trim();
      if (notes) {
        const clipped =
          notes.length > MAX_NOTE_CHARS
            ? `${notes.slice(0, MAX_NOTE_CHARS).trimEnd()}…`
            : notes;
        bits.push(`(${clipped})`);
      }

      return bits.length > 0 ? `${title} ${bits.join(" ")}` : title;
    })
    .filter((line): line is string => line !== null)
    .slice(0, MAX_ACTIVITIES_IN_PROMPT);
}

/**
 * Which reservation types count as "activities" for packing purposes.
 *
 * Transport is excluded on purpose. A flight, train, ferry or car booking says
 * how you arrive, not what you do when you get there -- and a flight's
 * location/locationTo fields would otherwise read as an event name and pull in
 * suggestions for the airport rather than for the trip.
 *
 * "lodging" is excluded for the same reason: where you sleep is already
 * implied by a multi-day trip, and including it tends to produce a generic
 * "hotel toiletries" cluster that crowds out the specific items we want.
 *
 * "other" is INCLUDED because it is the catch-all users reach for when a plan
 * does not fit the listed types -- a spa day, a wine tasting, a wedding. That
 * is exactly the signal worth having.
 */
const ACTIVITY_TYPES = new Set(["activity", "other"]);

/**
 * Reduce a trip's reservations to the activities worth telling the model about.
 *
 * Confirmed and unconfirmed bookings are both included: a reservation held
 * without a confirmation code is still a plan the user is packing for, and
 * `confirmed` answers "is this settled", not "is this happening". Dropping the
 * unconfirmed ones would hide exactly the tentative dinner that needs an
 * outfit decision.
 *
 * Reservations are assumed already filtered and date-ordered by the caller
 * (getReservationsForTrip), so the most chronologically relevant land first
 * when the cap truncates.
 */
export function activitiesFromReservations(
  reservations: Array<Pick<Reservation, "type" | "title" | "startTime" | "notes">>
): PlannedActivity[] {
  return reservations
    .filter((r) => ACTIVITY_TYPES.has(r.type))
    .map((r) => ({
      title: r.title,
      time: r.startTime,
      notes: r.notes,
    }));
}

/**
 * Build the prompt for the on-device model.
 *
 * Two constraints are stated explicitly because the model otherwise ignores
 * them: do not repeat what is already packed, and return JSON only. The
 * existing-item list is capped -- a long list pushes the instruction out of
 * the small context window, so the tail is dropped rather than the rule.
 *
 * Booked activities are included when present. They are what lets a dinner
 * reservation pull in a formal outfit: without them the model only knows
 * WHERE and WHEN the trip is, not what it involves, so it can only reach for
 * climate and generic travel items. When there are none we say nothing about
 * activities at all -- an explicit "do not invent activities" guard was
 * removed here, because with real bookings supplied it suppressed exactly the
 * reasoning we want, and an empty section would invite invention anyway.
 */
export function buildPackingPrompt(ctx: SuggestContext, existing: string[] = []): string {
  const trip = describeTrip(ctx) || "an unspecified trip";
  const seen = existing
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
  const activities = describeActivities(ctx.activities);

  const lines = [
    `Suggest ${MAX_SUGGESTIONS} things to pack for a trip to ${trip}.`,
    "Prefer specific, useful items over generic ones.",
    `Return JSON only, shaped exactly like: {"items":[{"name":"...","reason":"..."}]}`,
    `Include at most ${MAX_SUGGESTIONS} items.`,
  ];

  if (activities.length > 0) {
    lines.push(
      "Planned activities -- pack for what these require:",
      ...activities.map((a) => `- ${a}`)
    );
  }

  if (seen.length > 0) {
    lines.push(`Do not suggest any of these, already packed: ${seen.join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * Whether a suggestion may be added right now.
 *
 * This is the click-time gate, and it exists because the list can change
 * between generating suggestions and clicking one: another tab, a sync, or an
 * earlier click in the same session. Returns the reason rather than a bare
 * boolean so the caller can distinguish "nothing to do" (already present)
 * from "not a usable item" (blank), and so this decision is testable without
 * rendering the component.
 *
 * Deliberately does NOT consult `existing` from generate time -- only the
 * live list -- because the stale copy is exactly what would let a duplicate
 * through.
 */
export function addability(
  suggestionName: string,
  isAlreadyOnList: boolean
): "ok" | "blank" | "duplicate" {
  if (!suggestionName.trim()) return "blank";
  if (isAlreadyOnList) return "duplicate";
  return "ok";
}

/*
 * ---------------------------------------------------------------------------
 * Wiring decisions
 *
 * The functions below are the component's own decisions, lifted out of
 * PackingSuggestions.tsx. They were inline in the JSX/effect before, which
 * meant the only way to check them was to render the component -- and this
 * repo has no DOM test runner, so they went unchecked. Moving them here makes
 * each one a pure function of its inputs: no React, no bridge, no clock.
 *
 * None of them write anything. The click handler still performs the write;
 * these decide WHAT would be written and WHETHER the UI offers to write it.
 * Keeping that boundary is what preserves the feature's contract that nothing
 * reaches the packing list without a user click.
 * ---------------------------------------------------------------------------
 */

/** Whether the generate button is live, and what it should say. */
export interface GenerateControlState {
  /** True only when the model is available and no generation is in flight. */
  enabled: boolean;
  /** Button label: "Thinking…" while generating, "Suggest again" after a try. */
  label: "Thinking…" | "Suggest again" | "Suggest items";
  /** True while a generation is in flight, so the caller can show a spinner. */
  generating: boolean;
}

/**
 * Resolve the generate control's enabled/label state.
 *
 * The availability test is `=== true` rather than truthiness on purpose: a
 * report that never arrived (null, while the check is still settling or after
 * it threw) must leave the button dead, never enable it by accident. Guessing
 * "probably available" would open the one path that calls the native model.
 *
 * `hasGenerated` means "the user has pressed this button before", not "the
 * last press returned something" -- a press that produced zero usable items
 * still happened, and reverting the label to "Suggest items" would read as if
 * it had been ignored.
 */
export function generateControlState(
  availability: AvailabilityReportLike | null,
  generating: boolean,
  hasGenerated: boolean
): GenerateControlState {
  return {
    enabled: availability?.available === true && !generating,
    label: generating ? "Thinking…" : hasGenerated ? "Suggest again" : "Suggest items",
    generating,
  };
}

/**
 * Which of the three candidate-area states to render.
 *
 * `null` (never generated) and `[]` (generated, nothing usable) are different
 * situations that need different messages, so the empty-list case cannot be
 * collapsed into "nothing to show": telling a user nothing was found when they
 * have not asked yet is wrong, and so is showing an empty area when the model
 * replied with only items they already have.
 */
export function suggestionsViewState(
  suggestions: PackingSuggestion[] | null
): "idle" | "empty" | "list" {
  if (suggestions === null) return "idle";
  return suggestions.length > 0 ? "list" : "empty";
}

/** One row as the component renders it, with its add affordance resolved. */
export interface SuggestionRow {
  name: string;
  reason?: string;
  /** The one-click payload, or null when there is nothing to add. */
  payload: AddPayload | null;
  /** True while this exact name is being written. */
  adding: boolean;
  /** False for a blank name: the row is dead rather than a live button. */
  canAdd: boolean;
}

/** What a click on a row submits to the app's item action. */
export interface AddPayload {
  tripId: string;
  categoryName: string;
  categoryIcon: string;
  /** Trimmed: a padded name must not become a second, distinct entry. */
  name: string;
  quantity: number;
}

/**
 * Build the add payload for a suggestion.
 *
 * Named separately from the row model because this is the exact argument list
 * handed to `item.create(tripId, categoryId, name, icon, quantity)`, and a
 * transposed pair here is invisible in review but wrong at runtime. Keeping it
 * a value means the wiring can be asserted without a rendered component.
 *
 * The name is trimmed for the same reason `addability` trims: the model pads
 * output, and " Socks" and "Socks" are the same physical item to a traveller
 * even though they are different strings to a database.
 */
export function addPayload(
  tripId: string,
  suggestion: PackingSuggestion,
  categoryName: string,
  categoryIcon: string
): AddPayload {
  return {
    tripId,
    categoryName,
    categoryIcon,
    name: suggestion.name.trim(),
    quantity: 1,
  };
}

/**
 * Map raw suggestions to render rows, resolving each row's addability.
 *
 * `isOnList` is a callback rather than a snapshot of existing names so the
 * caller can consult the LIVE list at render time: the whole duplicate
 * problem is that the list changes after suggestions were generated, and a
 * captured array would reintroduce exactly the staleness the click-time gate
 * exists to defeat.
 *
 * `adding` is consulted by the trimmed name, matching how the click handler
 * keys its in-flight set -- if they disagreed, a row could show no spinner
 * while its own add was running and invite a double click.
 */
export function buildSuggestionRows(
  suggestions: PackingSuggestion[],
  isOnList: (name: string) => boolean,
  adding: ReadonlySet<string>,
  tripId: string,
  categoryName: string,
  categoryIcon: string
): SuggestionRow[] {
  return suggestions.map((suggestion) => {
    const name = suggestion.name.trim();
    const state = addability(name, isOnList(name));
    return {
      name: suggestion.name,
      reason: suggestion.reason,
      payload: state === "ok"
        ? addPayload(tripId, suggestion, categoryName, categoryIcon)
        : null,
      adding: adding.has(name),
      canAdd: state === "ok",
    };
  });
}

/**
 * Normalise a bridge response into the candidate list.
 *
 * The bridge returns `null` for every failure -- absent plugin, thrown native
 * call, unparseable JSON -- and `null` is not an array, so `normalizeSuggestions`
 * already yields `[]`. This wrapper exists so that "the model failed" and "the
 * model replied with nothing usable" are pinned to the same, single outcome
 * instead of a second null-check living inline in the component where nothing
 * tests it.
 */
export function suggestionsFromResponse(
  response: unknown,
  existing: string[] = []
): PackingSuggestion[] {
  return normalizeSuggestions(response, existing);
}

/**
 * The candidate list after one name has been added.
 *
 * The removed row is filtered by trimmed name, because that trimmed name is
 * what was written to the list: leaving a padded `" Socks "` row behind would
 * offer a second click that the click-time gate then refuses, which reads as
 * a broken button rather than as "this is done".
 */
export function suggestionsAfterAdd(
  suggestions: PackingSuggestion[] | null,
  addedName: string
): PackingSuggestion[] | null {
  if (suggestions === null) return null;
  const key = addedName.trim();
  return suggestions.filter((s) => s.name.trim() !== key);
}

/**
 * The rows still offering a live add, after filtering out in-flight names.
 *
 * Used to decide whether ANY candidate remains actionable. The count is taken
 * from `canAdd` and `adding` rather than from a flat "seen" map: a row the
 * user just clicked is on the list, so offering it again is the duplicate the
 * feature exists to prevent.
 */
export function addableRowCount(rows: SuggestionRow[]): number {
  return rows.filter((r) => r.canAdd && !r.adding).length;
}

/** The availability shape these decisions need; kept structural to avoid a cycle. */
export interface AvailabilityReportLike {
  available: boolean;
  reason: string;
  message: string;
}

/**
 * Plain-language reason the feature is off, for the tooltip and inline note.
 *
 * Lives here rather than in the component because it is a pure switch over the
 * report, and because it is user-facing copy: an untested branch here means a
 * user is told nothing, or the wrong thing, at the exact moment the control is
 * dead and they need to know why.
 */
export function unavailableHint(report: AvailabilityReportLike | null): string {
  if (!report) return "Checking device support…";
  if (report.available) return "";
  /* The plugin already sends a user-safe `message`; prefer it so the wording
     lives in one place. The switch is the fallback for the reasons that can
     arrive with an empty message. */
  if (report.message) return report.message;
  switch (report.reason) {
    case "os_too_old":
      return "Packing suggestions need a newer version of iOS.";
    case "device_not_eligible":
      return "This device doesn't support on-device Apple Intelligence.";
    case "not_enabled":
      return "Turn on Apple Intelligence in Settings to use packing suggestions.";
    case "model_not_ready":
      return "The on-device model is still getting ready — try again shortly.";
    default:
      return "On-device suggestions aren't available right now.";
  }
}

/**
 * Normalise a raw model response into suggestions.
 *
 * Tolerant by necessity: the model may return `{items:[...]}`, a bare array
 * as the object's only value, or entries as plain strings. Anything without a
 * usable non-empty name is dropped rather than rendered as a blank row.
 *
 * Deduplicates case-insensitively against both itself and `existing`, so a
 * model that ignores the "already packed" instruction cannot produce a
 * suggestion the user already has.
 */
export function normalizeSuggestions(
  raw: unknown,
  existing: string[] = []
): PackingSuggestion[] {
  const entries = extractArray(raw);
  if (!entries) return [];

  const taken = new Set(existing.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const out: PackingSuggestion[] = [];

  for (const entry of entries) {
    const item = toSuggestion(entry);
    if (!item) continue;

    const key = item.name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);

    out.push(item);
    if (out.length >= MAX_SUGGESTIONS) break;
  }

  return out;
}

/** Pull the array of candidates out of whatever shape the model produced. */
function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  // The prompted key first, then the usual near-misses, then a single array
  // value of any name -- models rename the key often.
  for (const key of ["items", "suggestions", "packingList", "list"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  const arrays = Object.values(obj).filter(Array.isArray);
  return arrays.length === 1 ? (arrays[0] as unknown[]) : null;
}

/** Coerce one entry into a suggestion, or null when it has no usable name. */
function toSuggestion(entry: unknown): PackingSuggestion | null {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const rec = entry as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name.trim()
    : typeof rec.item === "string" ? rec.item.trim()
    : "";
  if (!name) return null;

  const rawReason = typeof rec.reason === "string" ? rec.reason.trim()
    : typeof rec.why === "string" ? rec.why.trim()
    : "";

  return rawReason ? { name, reason: rawReason } : { name };
}
