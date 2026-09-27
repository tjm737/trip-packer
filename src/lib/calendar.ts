/*
 * Calendar export (RFC 5545 iCalendar).
 *
 * The delicate part of this file is not the format, it is the *time*. A
 * reservation stores `startDate` ("YYYY-MM-DD") and `startTime` ("HH:MM") as
 * separate strings, and the comment on `Reservation` explains why: a booking
 * time is local to wherever you are, so storing an instant would silently shift
 * it across timezones.
 *
 * That decision has to be honoured on the way out. There are two valid
 * encodings and they are not interchangeable:
 *
 *   - `DTSTART;VALUE=DATE:20261012` — a date, no time, floating in the user's
 *     own calendar. Correct for "the hotel is booked for the 12th".
 *   - `DTSTART;TZID=...:20261012T092000` — a wall-clock time in a named zone.
 *
 * What you must NOT do is the naive thing: `new Date("2026-10-12T09:20")` and
 * serialise the result as UTC (`...Z`). That constructor interprets the string
 * in the *server's* timezone, so a 09:20 flight becomes 08:20 or 09:20Z
 * depending on where the server happens to run, and the user's calendar then
 * shifts it again on import. The time they typed is the time they meant, so it
 * is written as a floating local time with no `Z` and no `TZID` — which is
 * exactly the semantics of the string we hold.
 */

import type { Reservation, Trip } from "./types";

/** Longest line length before folding. RFC 5545 §3.1 says 75 octets. */
export const MAX_LINE_OCTETS = 75;

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 *
 * Order matters: backslash first, or the escapes we add get escaped again and
 * a literal backslash becomes `\\\\`.
 */
export function escapeText(value: string): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets with CRLF + single space continuations.
 *
 * Octets, not characters: a name with an em dash or an accented hotel is
 * multi-byte, and folding by character count produces a line that exceeds the
 * limit and is rejected by strict parsers. Since every continuation adds one
 * space, the budget for a chunk is 74 when a continuation will follow.
 *
 * Splitting is done by walking code points so a multi-byte character is never
 * bisected — a split inside a UTF-8 sequence yields invalid bytes that some
 * clients render as `?` or drop the line over.
 */
export function foldLine(line: string): string {
  const chars = Array.from(line);
  const out: string[] = [];
  let current = "";
  // 74 leaves room for the leading space on the next segment; the first
  // segment may use 75, but keeping one budget for all is simpler and never
  // overflows.
  const budget = MAX_LINE_OCTETS - 1;

  for (const ch of chars) {
    if (Buffer.byteLength(current + ch, "utf8") > budget) {
      out.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  out.push(current);

  return out.join("\r\n ");
}

/** `YYYY-MM-DD` → `YYYYMMDD`, or null if it is not a plain date. */
export function toDateValue(date: string): string | null {
  if (typeof date !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

/** `HH:MM` (24h) → `HHMMSS`, or null if it is not a plain time. */
export function toTimeValue(time: string): string | null {
  if (typeof time !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}00`;
}

/**
 * Add days to a `YYYY-MM-DD` string, in UTC.
 *
 * Arithmetic is done on a UTC Date and the result read back with the UTC
 * getters, so the server's timezone cannot move the answer by a day. Using
 * local getters here is the classic off-by-one that turns a 3-night stay into
 * 2 or 4 depending on where the machine sits relative to UTC.
 */
export function addDays(date: string, days: number): string | null {
  const base = toDateValue(date);
  if (!base) return null;
  const y = Number(base.slice(0, 4));
  const mo = Number(base.slice(4, 6));
  const d = Number(base.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** `YYYYMMDD` + `HHMMSS` → `YYYYMMDDTHHMMSS`. Floating: no trailing `Z`. */
export function toLocalDateTime(date: string, time: string): string | null {
  const d = toDateValue(date);
  const t = toTimeValue(time);
  if (!d || !t) return null;
  return `${d}T${t}`;
}

/** A stable, unique-enough UID. Domain is fixed so re-imports update, not duplicate. */
export function uidFor(reservationId: string): string {
  return `${reservationId}@tripplanner.app`;
}

export interface CalendarEventInput {
  reservation: Reservation;
  tripName: string;
  /** Injected so the output is deterministic under test. */
  stamp?: string;
}

/**
 * Build one VEVENT.
 *
 * Returns null for a row with no usable date — a stop with `startDate` "" is
 * not something a calendar can place, and emitting a dateless VEVENT makes some
 * clients reject the whole file rather than skip the row.
 */
export function buildEvent({
  reservation: r,
  tripName,
  stamp,
}: CalendarEventInput): string[] | null {
  const startDate = toDateValue(r.startDate);
  if (!startDate) return null;

  const lines: string[] = ["BEGIN:VEVENT"];
  lines.push(`UID:${uidFor(r.id)}`);
  lines.push(`DTSTAMP:${stamp ?? stampNow()}`);

  /*
   * DTSTART/DTEND, chosen by whether a clock time was given.
   *
   * No time → an all-day event spanning `startDate`, ending the day after
   * `endDate` (DTEND for a DATE value is exclusive). With no endDate it is a
   * single day, so DTEND is start + 1 — omitting DTEND entirely makes a
   * one-day all-day event, but being explicit is friendlier to clients that
   * assume a zero-length event otherwise.
   *
   * Time present → a timed event. DTEND is the end time if present, else start
   * + 1 hour, so the event has visible duration in a day view instead of
   * collapsing to a zero-height block.
   */
  const hasTime = !!toTimeValue(r.startTime);
  if (!hasTime) {
    const startYmd = startDate; // "YYYYMMDD"
    lines.push(`DTSTART;VALUE=DATE:${startYmd}`);
    /*
     * ⚠️ `addDays` takes the DASHED form. Feeding it `toDateValue`'s output
     * returned null here, and the `?? startDate` fallback made every all-day
     * event a single day — a 3-night hotel became a 1-day entry with no error.
     * Compute the exclusive end in the dashed form, then strip once.
     */
    const endDashed = r.endDate?.trim() ? r.endDate : r.startDate;
    const exclusiveDashed = addDays(endDashed, 1);
    const exclusive = exclusiveDashed ? exclusiveDashed.replace(/-/g, "") : startYmd;
    lines.push(`DTEND;VALUE=DATE:${exclusive}`);
  } else {
    const start = toLocalDateTime(r.startDate, r.startTime)!;
    lines.push(`DTSTART:${start}`);

    /*
     * A multi-day booking with a start time spans to its end DATE.
     *
     * This is the hotel case, and it is the common one, not a corner: the
     * seeder writes `startTime: "15:00"` (check-in) with `endDate` three days
     * later and `endTime: ""`. Deciding "timed vs all-day" on the start time
     * alone put the stay in the timed branch, where a missing end time became
     * start + 1 hour — so a three-night booking exported as a one-hour meeting
     * on the arrival day and the checkout vanished from the calendar entirely.
     *
     * So the end DATE is consulted before the end time. When it is later than
     * the start, the event spans: DTSTART keeps the check-in time, DTEND is the
     * end date at the given end time, or end-of-day when none was given —
     * "23:59" rather than another hour, because an hour past check-in says
     * nothing about when the stay ends, whereas end-of-day says "until then".
     */
    const endDashed = r.endDate?.trim() ? r.endDate : r.startDate;
    const endYmd = toDateValue(endDashed);
    const spansDays = !!endYmd && endYmd !== startDate;

    if (spansDays) {
      const endClock = toTimeValue(r.endTime) ?? "235900";
      lines.push(`DTEND:${endYmd}T${endClock}`);
    } else {
      /*
       * ⚠️ Pass `r.endDate` (dashed), NOT `toDateValue(r.endDate)`.
       *
       * `toLocalDateTime` calls `toDateValue` internally, so it expects the
       * dashed "YYYY-MM-DD" form. Handing it the already-stripped "YYYYMMDD"
       * made it return null for every timed event, and the fallback below then
       * silently substituted start+1h — so a flight arriving 12:05 was written
       * as ending 10:20. Every timed event was wrong, and nothing threw: the
       * .ics still imported cleanly, just with the wrong times.
       */
      let end = toLocalDateTime(endDashed, r.endTime);
      if (!end) {
        /*
         * No end time, so give the event an hour of visible duration rather
         * than a zero-height block. `bumpHour` carries the date over when a
         * 23:30 start becomes 00:30 the next day, which a naive hour+1 would
         * turn into an invalid "24:30".
         */
        end = bumpHour(r.startDate, r.startTime, 1);
        if (!end) return null;
      }
      lines.push(`DTEND:${end}`);
    }
  }

  // SUMMARY leads with the type so a month view is scannable at a glance.
  const typeLabel = r.type ? `${titleCase(r.type)}: ` : "";
  const where = r.location?.trim() ? ` — ${r.location.trim()}` : "";
  lines.push(`SUMMARY:${escapeText(`${typeLabel}${r.title}${where}`)}`);

  if (r.location?.trim()) {
    lines.push(`LOCATION:${escapeText(r.location.trim())}`);
  }

  const descriptionParts: string[] = [`Trip: ${tripName}`];
  if (r.locationTo?.trim()) descriptionParts.push(`To: ${r.locationTo.trim()}`);
  if (r.confirmation?.trim()) descriptionParts.push(`Confirmation: ${r.confirmation.trim()}`);
  if (r.cost?.trim()) descriptionParts.push(`Cost: ${r.cost.trim()}`);
  if (r.notes?.trim()) descriptionParts.push(r.notes.trim());

  lines.push(`DESCRIPTION:${escapeText(descriptionParts.join("\n"))}`);

  /*
   * STATUS:CONFIRMED only when the booking is confirmed.
   *
   * Unconfirmed bookings are exported as TENTATIVE rather than excluded: the
   * user asked for their itinerary, and a reservation they have not yet
   * confirmed is still something they want to see — they just want to see it is
   * not locked in. Dropping them silently would make the export quietly
   * incomplete, which is harder to notice than a faded entry.
   */
  lines.push(`STATUS:${r.confirmed ? "CONFIRMED" : "TENTATIVE"}`);
  lines.push("END:VEVENT");

  return lines;
}

/**
 * Add hours to a floating local date+time, rolling the date over as needed.
 */
function bumpHour(date: string, time: string, hours: number): string | null {
  const d = toDateValue(date);
  const t = toTimeValue(time);
  if (!d || !t) return null;
  const hh = Number(t.slice(0, 2)) + hours;
  if (hh <= 23) {
    return `${d}T${String(hh).padStart(2, "0")}${t.slice(2)}`;
  }
  const next = addDays(date, Math.floor(hh / 24));
  const rem = hh % 24;
  if (!next) return null;
  return `${next.replace(/-/g, "")}T${String(rem).padStart(2, "0")}${t.slice(2)}`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A UTC timestamp for DTSTAMP.
 *
 * DTSTAMP is required and must be a UTC instant — this is the one field where
 * `Z` is correct, because it records when the file was generated rather than
 * when the event happens.
 */
export function stampNow(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface BuildCalendarOptions {
  trip: Trip;
  reservations: Reservation[];
  /** Injected in tests; defaults to now. */
  now?: Date;
}

/**
 * Build a complete VCALENDAR for a trip.
 *
 * `METHOD:PUBLISH` and no `METHOD:REQUEST`, because this is a file the user
 * owns, not an invitation — REQUEST makes some clients look for an organiser
 * and treat the user as an attendee.
 *
 * `CALSCALE:GREGORIAN` and `VERSION:2.0` are both mandatory for the file to be
 * accepted. `X-WR-CALNAME` is how the trip name shows up as the calendar's
 * name on import, which is the difference between "TripPlanner" and
 * "Lisbon Long Weekend" in the sidebar.
 */
export function buildCalendar({ trip, reservations, now }: BuildCalendarOptions): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TripPlanner//Itinerary//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(trip.name)}`,
  ];

  const stamp = stampNow(now);

  for (const r of reservations) {
    const event = buildEvent({ reservation: r, tripName: trip.name, stamp });
    if (!event) continue;
    lines.push(...event);
  }

  lines.push("END:VCALENDAR");

  /*
   * Fold every line, then join with CRLF.
   *
   * CRLF is mandated by RFC 5545 §3.1 and is not optional: a file with bare LF
   * works in Google Calendar and is rejected by Outlook and by iOS Calendar in
   * some versions. This is the single most common reason a generated .ics
   * "does not open on the user's phone", so it is done unconditionally.
   */
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Filename for the download, derived from the trip name. */
export function calendarFilename(tripName: string): string {
  const slug = (tripName || "trip")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "trip"}.ics`;
}
