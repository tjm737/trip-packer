/*
 * Trip conflict checking, on-device.
 *
 * WHAT THIS IS
 * ------------
 * Reads a trip's reservations and asks Apple's on-device model what does not
 * add up: two things at once, a stay that does not cover the night you land, a
 * transfer that cannot be made, a day that is unrealistic. The model returns
 * structured findings, which the UI renders as a reviewable list.
 *
 * WHY THE MODEL DECIDES, AND WHAT CODE STILL OWNS
 * -----------------------------------------------
 * The model does the JUDGEMENT -- what counts as a conflict, how much slack a
 * transfer needs, whether "dinner" and a 21:00 show actually collide. That is
 * genuinely fuzzy and is the reason to use a model at all.
 *
 * Code does NOT second-guess those findings, with one exception, because it is
 * the one failure mode that is worse than having no feature:
 *
 *   A fabricated date. "Your hotel starts the 15th but you land the 14th" is
 *   alarming, actionable, and completely wrong if both are really the 14th.
 *   The user is being told something is broken about a trip they may have
 *   already paid for.
 *
 * So every finding must cite the reservations it is about, and normalisation
 * drops any finding that cites an id it was not given, or that quotes a date
 * absent from those reservations. That is not re-deriving the conflict -- it is
 * refusing to display a conflict about data that does not exist. The model
 * still decides what the conflict IS.
 *
 * The other deliberate limit: no severity inflation. Everything returns as
 * "warning" or "note" and is presented as "worth a look", never as an error.
 * A trip plan is a plan, not a database with constraints -- a late dinner and
 * an early flight is a choice the traveller is allowed to make.
 */

import { getReservationsForTrip } from "./storage";
import type { Reservation, Trip } from "./types";

/** How much the model thinks a finding matters. Never an "error": see above. */
export type ConflictSeverity = "warning" | "note";

export interface Conflict {
  severity: ConflictSeverity;
  /** Short headline, e.g. "Two activities overlap". */
  title: string;
  /** One or two sentences explaining the problem in plain language. */
  detail: string;
  /** Reservation ids this finding is about. Always non-empty (enforced). */
  reservationIds: string[];
}

/** Compact, prompt-safe view of one reservation. */
export interface ConflictInput {
  id: string;
  type: string;
  title: string;
  location: string;
  locationTo: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  confirmed: boolean;
}

/*
 * Field caps. A small on-device model has a small context window, and an
 * over-long digest evicts the output-format instructions -- which surfaces to
 * the user as a button that does nothing rather than as an error. Titles and
 * locations are free text, so they are truncated rather than trusted.
 */
const MAX_TITLE = 80;
const MAX_LOCATION = 60;
const MAX_NOTES_RESERVATIONS = 40;

function clip(value: string, max: number): string {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/*
 * A weekday is precomputed for every date and put IN the prompt.
 *
 * The model has no clock and is unreliable at weekday arithmetic, but weekday
 * awareness is exactly what makes the useful findings possible -- "you land
 * Sunday evening and the museum is closed Mondays" is a real conflict that
 * needs the weekday, not just the date. Computing it here is cheap and removes
 * the need for the model to derive it.
 */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "2026-10-14" -> "Wednesday". Empty for a non-date. */
export function weekdayOf(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "";
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAYS[d.getUTCDay()];
}

/** True for yyyy-mm-dd naming a real calendar date. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Build the prompt-safe view of a trip's reservations.
 *
 * Ordering is chronological with undated rows last, and stable within a date,
 * so the same trip always produces the same prompt -- otherwise a model that
 * is merely sensitive to input order looks like it is giving inconsistent
 * advice.
 */
export function buildConflictInputs(reservations: Reservation[]): ConflictInput[] {
  return reservations
    .slice()
    .sort((a, b) => {
      const da = a.startDate || "9999-99-99";
      const db = b.startDate || "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      const ta = a.startTime || "99:99";
      const tb = b.startTime || "99:99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, MAX_NOTES_RESERVATIONS)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: clip(r.title, MAX_TITLE),
      location: clip(r.location, MAX_LOCATION),
      locationTo: clip(r.locationTo, MAX_LOCATION),
      startDate: r.startDate || "",
      startTime: r.startTime || "",
      endDate: r.endDate || "",
      endTime: r.endTime || "",
      confirmed: Boolean(r.confirmed),
    }));
}

/**
 * Render the trip as the compact line-per-reservation digest the model reads.
 *
 * Each line carries the weekday beside the date, and an end date is only
 * emitted when it differs from the start -- a flight with startDate ==
 * endDate is one day, and repeating it invites the model to treat it as a
 * multi-day block.
 */
export function formatConflictDigest(inputs: ConflictInput[]): string {
  if (inputs.length === 0) return "(no reservations)";
  return inputs
    .map((r) => {
      const parts: string[] = [`[${r.id}]`, r.type, `"${r.title}"`];

      if (r.startDate) {
        const day = weekdayOf(r.startDate);
        parts.push(day ? `${r.startDate} (${day})` : r.startDate);
        if (r.startTime) parts.push(`from ${r.startTime}`);
      } else {
        parts.push("(no date)");
      }

      if (r.endDate && r.endDate !== r.startDate) {
        const day = weekdayOf(r.endDate);
        parts.push(`to ${day ? `${r.endDate} (${day})` : r.endDate}`);
        if (r.endTime) parts.push(`until ${r.endTime}`);
      } else if (r.endTime && r.endTime !== r.startTime) {
        parts.push(`until ${r.endTime}`);
      }

      if (r.location) parts.push(`at ${r.location}`);
      if (r.locationTo) parts.push(`-> ${r.locationTo}`);
      if (!r.confirmed) parts.push("[NOT CONFIRMED]");

      return parts.join(" ");
    })
    .join("\n");
}

/**
 * The prompt.
 *
 * Written for a small model with no world knowledge and no clock. Three things
 * carry the weight:
 *
 *  1. The output contract is stated first and repeated at the end, because the
 *     end of the prompt is what survives a tight context window.
 *  2. Findings must cite reservation ids from the digest. An id is the only
 *     thing the normaliser can check, and citations are what let the UI show
 *     the problem on the itinerary rather than in a detached list.
 *  3. The count of reservations is stated, so "no problems found" is a
 *     legitimate answer the model is allowed to give. Without that, a model
 *     asked to find conflicts will always find some.
 */
export function buildConflictPrompt(tripName: string, digest: string, count: number): string {
  return [
    "You are reviewing a travel itinerary for problems a traveller would want to know about.",
    `Trip: ${clip(tripName, MAX_TITLE)}`,
    "",
    "Reservations (one per line, oldest first):",
    digest,
    "",
    "Look for genuine, specific problems, for example:",
    "- two reservations that overlap in time and cannot both be attended",
    "- accommodation that does not cover a night the traveller is in that city",
    "- a flight or train arrival that leaves no realistic time for a transfer or check-in that follows it",
    "- a day with more timed activity than is plausible",
    "- a reservation marked NOT CONFIRMED that the trip depends on",
    "- a date or sequence that cannot be right, such as leaving before arriving",
    "",
    "Return ONLY a JSON object with exactly these keys:",
    '  conflicts - an array. Each item has:',
    '    severity       - "warning" for something likely to cause a real problem, "note" for something worth a look',
    `    title          - short headline, under 60 characters`,
    `    detail         - one or two sentences explaining the problem in plain language`,
    `    reservationIds - array of the ids from the list above that this is about, e.g. ["r3","r7"]`,
    "",
    "Rules:",
    `- There are ${count} reservations above. Reporting no conflicts is a valid and common answer: use an empty array.`,
    "- Only report a problem you can point at in the list above. Do not invent reservations, dates, times or places.",
    "- Every conflict MUST cite at least one id in square brackets from the list. An id that is not in the list is invalid.",
    "- Quote dates and times exactly as they appear above. Do not reword or recalculate them.",
    "- Do not report overlapping transport that is a normal connection, or two things that merely happen on the same day.",
    "- Do not add keys. Do not wrap the JSON in prose or code fences.",
  ].join("\n");
}

/**
 * Enforce the contract on whatever the model actually produced.
 *
 * This is where the guarantees live -- not in the prompt, which is a
 * suggestion. Every rule here exists because the corresponding failure is one
 * the user would otherwise see:
 *
 *  - a finding citing an id that was never in the digest (fabricated
 *    reservation) is dropped
 *  - a finding with no citation at all is dropped, because it cannot be shown
 *    against anything or trusted
 *  - a date quoted in a finding that appears nowhere in the reservations it
 *    cites is dropped -- the fabricated-date case described at the top of this
 *    file
 *  - severity is coerced into the two known values and never above "warning"
 *  - everything is clipped, because model output is unbounded and free text
 *    flows straight into the UI
 *
 * `validIds` is the set of ids that were actually in the digest, so a finding
 * about a reservation the model was not shown is impossible to display.
 */
export function normaliseConflicts(raw: unknown, inputs: ConflictInput[]): Conflict[] {
  const byId = new Map(inputs.map((r) => [r.id, r]));
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(obj.conflicts) ? obj.conflicts : [];

  const out: Conflict[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;

    const title = clip(String(rec.title ?? ""), 90);
    const detail = clip(String(rec.detail ?? ""), 400);
    if (!title || !detail) continue;

    const rawIds = Array.isArray(rec.reservationIds) ? rec.reservationIds : [];
    const ids = rawIds
      .map((v) => String(v ?? "").trim())
      .filter((id) => byId.has(id));
    // No surviving citation means the finding points at nothing we can show.
    if (ids.length === 0) continue;

    /*
     * Date check. Every yyyy-mm-dd-looking token in the finding's own text must
     * exist among the reservations it cites. This is the single guard against a
     * confidently wrong date claim, and it deliberately does not attempt to
     * verify the LOGIC of the claim -- only that the dates it names are real.
     */
    const citedDates = new Set<string>();
    for (const id of ids) {
      const r = byId.get(id)!;
      for (const d of [r.startDate, r.endDate]) {
        if (isRealDate(d)) citedDates.add(d);
      }
    }
    const quoted = `${title} ${detail}`.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const invented = quoted.filter((d) => !citedDates.has(d));
    if (invented.length > 0) continue;

    // Dedupe on the finding's substance, so the same problem reported twice
    // about the same reservations is shown once. Model output frequently
    // repeats a conflict under two slightly different titles.
    const key = `${ids.slice().sort().join(",")}::${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      severity: rec.severity === "note" ? "note" : "warning",
      title,
      detail,
      reservationIds: ids,
    });
  }

  // Warnings first, then notes -- most consequential at the top, and stable
  // within a severity so re-running does not reshuffle the list.
  const rank: Record<ConflictSeverity, number> = { warning: 0, note: 1 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * The whole check for one trip, from stored rows to displayable findings.
 *
 * Returns [] for a trip with nothing to check rather than prompting the model
 * with an empty list -- which would reliably produce invented conflicts.
 */
export function checkTripConflicts(
  trip: Trip,
  allReservations: Reservation[],
  runModel: (prompt: string) => Promise<unknown>
): { inputs: ConflictInput[]; prompt: string; findings: Promise<Conflict[]> } {
  const reservations = getReservationsForTrip(trip.id, allReservations);
  const inputs = buildConflictInputs(reservations);
  const digest = formatConflictDigest(inputs);
  const prompt = buildConflictPrompt(trip.name, digest, inputs.length);

  if (inputs.length === 0) {
    return { inputs, prompt, findings: Promise.resolve([]) };
  }

  return {
    inputs,
    prompt,
    findings: runModel(prompt)
      .then((raw) => normaliseConflicts(raw, inputs))
      // A failed model call is not an error the user needs to see: the trip is
      // fine, we just could not review it. Callers show an unavailable state.
      .catch(() => [] as Conflict[]),
  };
}

/* ------------------------------------------------------------------------- *
 * View state
 *
 * Kept as pure functions, matching the packing-suggestions module, so the
 * component renders decisions rather than making them and the states can be
 * asserted without a DOM.
 * ------------------------------------------------------------------------- */

/**
 * Whether the check control can run, and what it should say.
 *
 * `enabled` requires at least two reservations: a single booking cannot
 * conflict with anything, so offering the control would be a button whose only
 * possible outcome is "nothing found" -- which teaches the user the feature
 * does not work. The trip simply is not reviewable yet, and the hint says so.
 */
export interface ConflictControlState {
  enabled: boolean;
  label: string;
  /** Why the control is unavailable, or "" when it is available. */
  hint: string;
}

export function conflictControlState(
  available: boolean,
  running: boolean,
  hasRun: boolean,
  reservationCount: number,
  /**
   * The plugin's own availability report, when there is one. Its `message` is
   * already user-safe, so preferring it keeps the device-specific wording
   * ("Turn on Apple Intelligence in Settings") in the plugin rather than
   * duplicated here as a guess.
   */
  report?: { message?: string } | null
): ConflictControlState {
  if (reservationCount < 2) {
    return {
      enabled: false,
      label: "Check for conflicts",
      hint:
        reservationCount === 0
          ? "Add some bookings and this will check them against each other."
          : "Add at least one more booking to check for conflicts.",
    };
  }
  if (!available) {
    return {
      enabled: false,
      label: "Check for conflicts",
      hint:
        report?.message ||
        "Conflict checking needs on-device Apple Intelligence on a supported iPhone.",
    };
  }
  return {
    enabled: !running,
    label: running ? "Checking…" : hasRun ? "Check again" : "Check for conflicts",
    hint: "",
  };
}

/**
 * Which of the three result-area states to render.
 *
 * `null` (never run) and `[]` (ran, found nothing) are different situations
 * needing different messages. Collapsing them would tell a user "no conflicts"
 * before they had asked -- false reassurance about a trip, which is exactly the
 * impression this feature must not create.
 */
export function conflictsViewState(findings: Conflict[] | null): "idle" | "clean" | "list" {
  if (findings === null) return "idle";
  return findings.length > 0 ? "list" : "clean";
}
