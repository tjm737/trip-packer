/**
 * Date helpers for trip dates.
 *
 * Trip dates are stored as "YYYY-MM-DD" strings and are optional — the create
 * form lets you leave them blank. Calling toLocaleDateString directly on an
 * empty string produces "Invalid Date", so every display path goes through
 * these helpers instead.
 */

const SHORT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** True only for a string that parses to a real date. */
export function isValidDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/**
 * Parse a "YYYY-MM-DD" date-only string as a *local* date.
 *
 * `new Date("2026-09-17")` is parsed as UTC midnight, which renders as the
 * previous day for anyone west of UTC. Splitting the parts avoids the off-by-one.
 */
function parseDateOnly(value: string): Date | null {
  if (!isValidDate(value)) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Format a single trip date, or null when absent/invalid. */
export function formatDate(value: string | null | undefined): string | null {
  const d = parseDateOnly(value ?? "");
  return d ? d.toLocaleDateString("en-US", SHORT) : null;
}

/** Same as formatDate but always returns a string. */
export function formatDateOr(value: string | null | undefined, fallback = ""): string {
  return formatDate(value) ?? fallback;
}

/**
 * Format a trip's date range for display.
 *
 *  both set, different days -> "Sep 17 – Sep 21"
 *  both set, same day       -> "Sep 17"
 *  only start               -> "From Sep 17"
 *  only end                 -> "Until Sep 21"
 *  neither                  -> "No dates set"
 */
export function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  const start = parseDateOnly(startDate ?? "");
  const end = parseDateOnly(endDate ?? "");

  if (start && end) {
    if (start.getTime() === end.getTime()) {
      return start.toLocaleDateString("en-US", SHORT);
    }
    return `${start.toLocaleDateString("en-US", SHORT)} – ${end.toLocaleDateString("en-US", SHORT)}`;
  }
  if (start) return `From ${start.toLocaleDateString("en-US", SHORT)}`;
  if (end) return `Until ${end.toLocaleDateString("en-US", SHORT)}`;
  return "No dates set";
}

/** Sort key for a date field; invalid/missing dates get Infinity (sort last). */
export function dateSortValue(value: string | null | undefined): number {
  const d = parseDateOnly(value ?? "");
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/**
 * Comparator for sorting by a date field. Invalid/missing dates sort last,
 * and two invalid dates compare equal (Infinity - Infinity is NaN, which would
 * otherwise leave the order undefined).
 */
export function compareByDate(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const av = dateSortValue(a);
  const bv = dateSortValue(b);
  if (av === bv) return 0;
  return av - bv;
}

/**
 * Whether a trip counts as upcoming.
 *
 * A trip with no end date (or an invalid one) must not be treated as upcoming —
 * otherwise a dateless trip shows up as a future trip forever.
 */
export function isUpcoming(startDate: string | null | undefined, endDate: string | null | undefined, archived: boolean): boolean {
  if (archived) return false;
  const end = parseDateOnly(endDate ?? "") ?? parseDateOnly(startDate ?? "");
  if (!end) return true; // dateless trips stay visible in the upcoming list
  const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return endOfDay.getTime() >= Date.now();
}

/** Whole days from today until the start date; null when unknown. */
export function daysUntil(startDate: string | null | undefined): number | null {
  const start = parseDateOnly(startDate ?? "");
  if (!start) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((start.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Whole days from today until an arbitrary "YYYY-MM-DD" date; null when absent
 * or invalid. Negative when the date is in the past.
 *
 * Same UTC-vs-local hazard as `daysUntil` — always routed through
 * `parseDateOnly`, never `new Date(value)` on a date-only string.
 */
export function daysUntilDate(value: string | null | undefined): number | null {
  const target = parseDateOnly(value ?? "");
  if (!target) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000);
}

/** Inclusive trip length in days; null when unknown. */
export function tripDurationDays(startDate: string | null | undefined, endDate: string | null | undefined): number | null {
  const start = parseDateOnly(startDate ?? "");
  const end = parseDateOnly(endDate ?? "");
  if (!start || !end) return null;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

/**
 * Month the trip starts, as 1-12; null when unknown or invalid.
 *
 * Used to reason about climate — a packing prompt that knows the trip is in
 * February suggests different things than one that doesn't. Routed through
 * `parseDateOnly` for the same UTC off-by-one reason as the other helpers: at
 * month boundaries, `new Date("2026-02-01")` can report January.
 */
export function tripStartMonth(startDate: string | null | undefined): number | null {
  const start = parseDateOnly(startDate ?? "");
  return start ? start.getMonth() + 1 : null;
}

/**
 * Number of nights between two dates: a check-in on the 3rd and a check-out on
 * the 8th is five nights.
 *
 * Distinct from `tripDurationDays`, which counts days inclusively and floors at
 * one — a trip of a single day is one day but zero nights. Conflating them would
 * print "1 night" on a day trip and be off by one on every stay, which is the
 * kind of error someone notices at a hotel desk at 11pm.
 *
 * Returns 0 when the dates are missing, unparseable, or the same day, so
 * callers can treat 0 as "do not show a night count".
 */
export function nightsBetween(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): number {
  const start = parseDateOnly(startDate ?? "");
  const end = parseDateOnly(endDate ?? "");
  if (!start || !end) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}
