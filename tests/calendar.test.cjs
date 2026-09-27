/*
 * Tests for the calendar export.
 *
 * The reason these exist rather than trusting a manual check: a broken .ics
 * still OPENS. It imports, it shows events, and the times are wrong by an hour
 * — or the trip lands on the wrong day — and nobody connects the error to the
 * export. There is no crash to grep for.
 *
 * So the assertions are about the things a reviewer or a user would only notice
 * days later in a different app: the exact DTSTART string, whether a `Z`
 * leaked onto a floating time, the CRLF between lines, and whether a long
 * summary survived folding intact.
 *
 * Timezone independence gets its own section because it is the one class of bug
 * that cannot be reproduced by reasoning about the code on this machine — the
 * process happens to run in the same zone as the developer.
 */

const h = require("./harness.cjs");

const {
  escapeText,
  foldLine,
  toDateValue,
  toTimeValue,
  addDays,
  toLocalDateTime,
  buildEvent,
  buildCalendar,
  calendarFilename,
  stampNow,
  MAX_LINE_OCTETS,
} = h.loadModule("src/lib/calendar.ts");

/** Minimal shape of a Reservation for these tests. */
function res(over = {}) {
  return {
    id: "r1",
    tripId: "t1",
    type: "flight",
    title: "Flight to Lisbon",
    confirmation: "ABC123",
    confirmed: true,
    location: "Gatwick (LGW)",
    locationTo: "Lisbon (LIS)",
    startDate: "2026-10-12",
    startTime: "09:20",
    endDate: "2026-10-12",
    endTime: "12:05",
    cost: "412.50 USD",
    notes: "",
    order: 0,
    orderManual: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const TRIP = { id: "t1", name: "Lisbon Long Weekend" };
const STAMP = "20260927T120000Z";

async function run() {
  /* -- escaping: the difference between opening and not ----------------- */

  await h.test("commas, semicolons and newlines are escaped", () => {
    /*
     * A comma in an unescaped TEXT value is parsed as a list separator, so
     * "Dinner, then drinks" splits into two values and the client shows only
     * the first. This is common in real titles.
     */
    h.assertEqual(escapeText("Dinner, then drinks"), "Dinner\\, then drinks");
    h.assertEqual(escapeText("a;b"), "a\\;b");
    h.assertEqual(escapeText("line1\nline2"), "line1\\nline2");
    h.assertEqual(escapeText("crlf\r\nhere"), "crlf\\nhere");
  });

  await h.test("backslashes are escaped first, not doubled twice", () => {
    // Ordering bug: escaping "\" after ";" turns the escape we just added into
    // a literal. One backslash in must be two backslashes out, exactly.
    h.assertEqual(escapeText("a\\b"), "a\\\\b");
    h.assertEqual(escapeText("C:\\path\\to"), "C:\\\\path\\\\to");
  });

  await h.test("a non-string does not throw", () => {
    h.assertEqual(escapeText(null), "");
    h.assertEqual(escapeText(undefined), "");
    h.assertEqual(escapeText(42), "");
  });

  /* -- folding: long values must survive the round trip ----------------- */

  await h.test("folding obeys the 75-octet limit", () => {
    const long = `SUMMARY:${"x".repeat(300)}`;
    const folded = foldLine(long);
    for (const line of folded.split("\r\n ")) {
      /*
       * 75 octets per RFC 5545. Assert on the real limit rather than "looks
       * wrapped" — a file that exceeds it is rejected outright by Outlook.
       */
      h.assert(
        Buffer.byteLength(line, "utf8") <= MAX_LINE_OCTETS,
        `line is ${Buffer.byteLength(line, "utf8")} octets`
      );
    }
  });

  await h.test("folding uses CRLF plus a single space, not a bare newline", () => {
    const folded = foldLine(`SUMMARY:${"y".repeat(200)}`);
    h.assert(folded.includes("\r\n "), "continuation must be CRLF + space");
    h.assert(!folded.includes("\n ") || folded.includes("\r\n "), "bare LF found");
    // Unfolding (removing CRLF+space) must restore the original exactly.
    h.assertEqual(folded.replace(/\r\n /g, ""), `SUMMARY:${"y".repeat(200)}`);
  });

  await h.test("folding never splits a multi-byte character", () => {
    /*
     * The failure this guards: folding by character count instead of octets.
     * An em dash is 3 bytes, so a chunk can look short by length and overflow
     * by bytes — or a naive byte-slice bisects it and emits invalid UTF-8.
     */
    const line = `SUMMARY:${"é".repeat(120)}`;
    const folded = foldLine(line);
    for (const part of folded.split("\r\n ")) {
      h.assert(
        Buffer.byteLength(part, "utf8") <= MAX_LINE_OCTETS,
        `multi-byte overflow: ${Buffer.byteLength(part, "utf8")}`
      );
    }
    // Round-trips back to the exact original text.
    h.assertEqual(folded.replace(/\r\n /g, ""), line);
  });

  await h.test("a short line is left unfolded", () => {
    h.assertEqual(foldLine("SUMMARY:Hi"), "SUMMARY:Hi");
  });

  /* -- date and time parsing -------------------------------------------- */

  await h.test("dates and times parse only in the expected shape", () => {
    h.assertEqual(toDateValue("2026-10-12"), "20261012");
    h.assertEqual(toDateValue("2026-1-2"), null);
    h.assertEqual(toDateValue("12/10/2026"), null);
    h.assertEqual(toDateValue(""), null);
    h.assertEqual(toDateValue(null), null);

    h.assertEqual(toTimeValue("09:20"), "092000");
    h.assertEqual(toTimeValue("9:20"), "092000");
    h.assertEqual(toTimeValue("23:59"), "235900");
    // Out-of-range values must be refused rather than emitted as 250000, which
    // is syntactically valid and semantically nonsense.
    h.assertEqual(toTimeValue("24:00"), null);
    h.assertEqual(toTimeValue("09:60"), null);
    h.assertEqual(toTimeValue("noon"), null);
  });

  await h.test("floating datetimes carry no timezone marker", () => {
    /*
     * THE central assertion of this file. A `Z` here means UTC, and the user's
     * calendar will then shift 09:20 to whatever that is locally — the exact
     * bug the Reservation type's comment warns about.
     */
    const dt = toLocalDateTime("2026-10-12", "09:20");
    h.assertEqual(dt, "20261012T092000");
    h.assert(!dt.endsWith("Z"), "a floating time must not be marked UTC");
  });

  await h.test("addDays crosses month and year boundaries", () => {
    h.assertEqual(addDays("2026-10-12", 1), "2026-10-13");
    h.assertEqual(addDays("2026-10-31", 1), "2026-11-01");
    h.assertEqual(addDays("2026-12-31", 1), "2027-01-01");
    h.assertEqual(addDays("2026-03-01", -1), "2026-02-28");
    // A leap year, the case a hand-rolled day-count gets wrong.
    h.assertEqual(addDays("2028-02-28", 1), "2028-02-29");
    h.assertEqual(addDays("2028-02-29", 1), "2028-03-01");
  });

  await h.test("addDays is unaffected by the server timezone", () => {
    /*
     * Runs the same arithmetic under two extreme zones in separate child
     * processes. If the implementation used local getters, one of these would
     * come back a day off — and the bug would be invisible on a machine set to
     * UTC, which is where CI usually runs.
     */
    const { execFileSync } = require("child_process");
    const script = `
      const m = require(${JSON.stringify(__dirname + "/harness.cjs")}).loadModule("src/lib/calendar.ts");
      process.stdout.write(m.addDays("2026-10-12", 1));
    `;
    const results = ["UTC", "Pacific/Kiritimati", "Pacific/Midway"].map((tz) =>
      execFileSync(process.execPath, ["-e", script], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      }).trim()
    );
    for (const r of results) {
      h.assertEqual(r, "2026-10-13", `wrong under TZ (${r})`);
    }
  });

  /* -- event construction ----------------------------------------------- */

  await h.test("a timed event emits DTSTART without a Z or TZID", () => {
    const lines = buildEvent({ reservation: res(), tripName: TRIP.name, stamp: STAMP });
    const start = lines.find((l) => l.startsWith("DTSTART"));
    h.assertEqual(start, "DTSTART:20261012T092000");
    h.assert(!start.endsWith("Z"), "must not be UTC");
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND:20261012T120500");
  });

  await h.test("a dateless stop produces no event at all", () => {
    // Emitting a VEVENT without DTSTART makes strict clients reject the file,
    // so an unplaceable row is skipped rather than guessed at.
    h.assertEqual(
      buildEvent({ reservation: res({ startDate: "" }), tripName: TRIP.name, stamp: STAMP }),
      null
    );
    h.assertEqual(
      buildEvent({ reservation: res({ startDate: "sometime" }), tripName: TRIP.name, stamp: STAMP }),
      null
    );
  });

  await h.test("a date-only stop becomes an all-day event ending exclusive", () => {
    const lines = buildEvent({
      reservation: res({ startTime: "", endTime: "", endDate: "" }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assertEqual(lines.find((l) => l.startsWith("DTSTART")), "DTSTART;VALUE=DATE:20261012");
    /*
     * DTEND is exclusive for DATE values, so a single-day event must end on the
     * 13th. Ending on the 12th makes a zero-length event that some clients drop
     * entirely.
     */
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND;VALUE=DATE:20261013");
  });

  await h.test("a multi-day stay spans to the day after its end date", () => {
    const lines = buildEvent({
      reservation: res({
        type: "lodging",
        title: "Baixa Hotel",
        startDate: "2026-10-12",
        startTime: "",
        endDate: "2026-10-15",
        endTime: "",
      }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assertEqual(lines.find((l) => l.startsWith("DTSTART")), "DTSTART;VALUE=DATE:20261012");
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND;VALUE=DATE:20261016");
  });

  await h.test("a hotel with a check-in time and a later checkout spans the stay", () => {
    /*
     * THE case that actually ships. The seeder writes startTime "15:00"
     * (check-in) with an endDate three days later and endTime "". Treating that
     * as a one-hour timed event put a 3-night stay in the calendar as a
     * one-hour meeting and lost the checkout date entirely — visible only by
     * looking at a calendar app days later.
     */
    const lines = buildEvent({
      reservation: res({
        type: "lodging",
        title: "Baixa Hotel",
        startDate: "2026-10-21",
        startTime: "15:00",
        endDate: "2026-10-24",
        endTime: "",
      }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assertEqual(lines.find((l) => l.startsWith("DTSTART")), "DTSTART:20261021T150000");
    // Ends at the END DATE, at end-of-day since no end time was given.
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND:20261024T235900");
  });

  await h.test("a multi-day booking uses its end time when given", () => {
    const lines = buildEvent({
      reservation: res({
        type: "lodging",
        startDate: "2026-10-21",
        startTime: "15:00",
        endDate: "2026-10-24",
        endTime: "11:00",
      }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND:20261024T110000");
  });

  await h.test("a multi-day booking still carries its time of day", () => {
    // The spine of the multi-day fix: DTSTART must keep the clock time, not
    // degrade to an all-day event, or the check-in time is lost instead.
    const lines = buildEvent({
      reservation: res({ startDate: "2026-10-21", startTime: "15:00", endDate: "2026-10-24", endTime: "" }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assert(!lines.some((l) => l.startsWith("DTSTART;VALUE=DATE")), "collapsed to all-day");
    h.assert(lines.find((l) => l.startsWith("DTSTART")).includes("T150000"), "check-in time lost");
  });

  await h.test("a timed event with no end time gets one hour", () => {
    const lines = buildEvent({
      reservation: res({ startTime: "09:20", endTime: "", endDate: "" }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assertEqual(lines.find((l) => l.startsWith("DTEND")), "DTEND:20261012T102000");
  });

  await h.test("a late event rolls the date over instead of emitting hour 24", () => {
    /*
     * 23:30 + 1h is 00:30 the NEXT day. Naively adding one to the hour gives
     * "243000", which parses as an invalid time — clients either drop the event
     * or move it to the wrong place. The date must carry.
     */
    const lines = buildEvent({
      reservation: res({ startDate: "2026-10-12", startTime: "23:30", endTime: "", endDate: "" }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    const end = lines.find((l) => l.startsWith("DTEND"));
    h.assertEqual(end, "DTEND:20261013T003000");
    h.assert(!end.includes("24"), "hour 24 emitted");
  });

  await h.test("SUMMARY carries the type, title and location", () => {
    const lines = buildEvent({ reservation: res(), tripName: TRIP.name, stamp: STAMP });
    const summary = lines.find((l) => l.startsWith("SUMMARY"));
    h.assert(summary.includes("Flight"), "type missing");
    h.assert(summary.includes("Flight to Lisbon"), "title missing");
    h.assert(summary.includes("Gatwick"), "location missing");
  });

  await h.test("an unconfirmed booking is TENTATIVE, not omitted", () => {
    /*
     * A reservation the user has not confirmed is still part of the itinerary
     * they asked to export. Dropping it makes the export silently incomplete —
     * much harder to notice than a faded entry.
     */
    const un = buildEvent({
      reservation: res({ confirmed: false }),
      tripName: TRIP.name,
      stamp: STAMP,
    });
    h.assert(un.includes("STATUS:TENTATIVE"), "unconfirmed must be TENTATIVE");
    const ok = buildEvent({ reservation: res({ confirmed: true }), tripName: TRIP.name, stamp: STAMP });
    h.assert(ok.includes("STATUS:CONFIRMED"), "confirmed must be CONFIRMED");
  });

  await h.test("confirmation and cost land in the description", () => {
    const lines = buildEvent({ reservation: res(), tripName: TRIP.name, stamp: STAMP });
    const desc = lines.find((l) => l.startsWith("DESCRIPTION"));
    h.assert(desc.includes("ABC123"), "confirmation missing");
    h.assert(desc.includes("412.50"), "cost missing");
    h.assert(desc.includes("Lisbon Long Weekend"), "trip name missing");
  });

  /* -- the whole file --------------------------------------------------- */

  await h.test("the calendar has the structure clients require", () => {
    const ics = buildCalendar({ trip: TRIP, reservations: [res()], now: new Date("2026-09-27T12:00:00Z") });
    h.assert(ics.startsWith("BEGIN:VCALENDAR\r\n"), "must open with VCALENDAR");
    h.assert(ics.includes("VERSION:2.0"), "VERSION missing");
    h.assert(ics.includes("CALSCALE:GREGORIAN"), "CALSCALE missing");
    h.assert(ics.includes("PRODID:"), "PRODID missing");
    h.assert(ics.trimEnd().endsWith("END:VCALENDAR"), "must close with VCALENDAR");
  });

  await h.test("every line is CRLF-terminated", () => {
    /*
     * The single most common reason a generated .ics opens on Android and not
     * on iOS. RFC 5545 mandates CRLF; bare LF is a common mistake because it
     * happens to work in Google Calendar.
     */
    const ics = buildCalendar({ trip: TRIP, reservations: [res()], now: new Date() });
    h.assert(ics.includes("\r\n"), "no CRLF found at all");
    // No lone LF: every \n must be preceded by \r.
    const loneLf = /(?<!\r)\n/.test(ics);
    h.assert(!loneLf, "found a bare LF line ending");
  });

  await h.test("the calendar name comes from the trip", () => {
    const ics = buildCalendar({ trip: TRIP, reservations: [], now: new Date() });
    h.assert(ics.includes("X-WR-CALNAME:Lisbon Long Weekend"), "calendar name missing");
  });

  await h.test("undated reservations are skipped but the file stays valid", () => {
    const ics = buildCalendar({
      trip: TRIP,
      reservations: [res(), res({ id: "r2", startDate: "", location: "" })],
      now: new Date(),
    });
    h.assertEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
    h.assert(ics.includes("END:VCALENDAR"), "file must still close");
  });

  await h.test("an empty trip still produces a valid empty calendar", () => {
    // A blank calendar is a legitimate download; it must not throw or emit a
    // malformed file.
    const ics = buildCalendar({ trip: TRIP, reservations: [], now: new Date() });
    h.assertEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
    h.assert(ics.startsWith("BEGIN:VCALENDAR"), "must still be a calendar");
  });

  await h.test("a merge-conflicting name does not corrupt the structure", () => {
    /*
     * Hostile-ish input: quotes, semicolons and a newline in the trip name. The
     * file must stay parseable, which means the newline cannot escape its line.
     */
    const nasty = { id: "t9", name: 'Trip; with, "quotes"\nand a newline' };
    const ics = buildCalendar({ trip: nasty, reservations: [res()], now: new Date() });
    h.assert(!/X-WR-CALNAME:[^\r]*\n(\s*[^A-Z])/.test(ics), "newline escaped the header");
    h.assert(ics.includes("END:VCALENDAR"), "structure survived");
  });

  await h.test("DTSTAMP is a UTC instant and identical across events", () => {
    // The one field where Z is correct: it records generation time, not the
    // event's time. All events in one file must agree.
    const now = new Date("2026-09-27T12:00:00Z");
    const ics = buildCalendar({ trip: TRIP, reservations: [res(), res({ id: "r2" })], now });
    const stamps = ics.match(/DTSTAMP:[^\r]*/g) || [];
    h.assertEqual(stamps.length, 2);
    h.assert(stamps.every((s) => s.endsWith("Z")), "DTSTAMP must be UTC");
    h.assert(stamps.every((s) => s === stamps[0]), "stamps disagree");
  });

  await h.test("stampNow formats to basic ISO without punctuation", () => {
    h.assertEqual(stampNow(new Date("2026-09-27T12:34:56Z")), "20260927T123456Z");
  });

  await h.test("every PHYSICAL line in a full calendar is within 75 octets", () => {
    /*
     * Measured on physical lines as written to disk, NOT on the logical line
     * after unfolding — an unfolded DESCRIPTION is legitimately long, and
     * asserting on it produces a false failure that sends you looking for a
     * folding bug that is not there. The RFC constrains what is written.
     */
    const ics = buildCalendar({
      trip: { id: "t1", name: "Lisbon Long Weekend" },
      reservations: [
        res(),
        res({
          id: "r2",
          type: "lodging",
          notes: "A very long note. ".repeat(20),
          endDate: "2026-10-24",
          startTime: "",
          endTime: "",
        }),
      ],
      now: new Date("2026-09-27T12:00:00Z"),
    });
    const physical = ics.split("\r\n").filter((l) => l !== "");
    for (const line of physical) {
      const n = Buffer.byteLength(line, "utf8");
      h.assert(n <= MAX_LINE_OCTETS, `${n} octets: ${line.slice(0, 50)}`);
    }
    // And the mechanism is actually engaged, not vacuously passing on short
    // data: a long note must have produced continuations.
    h.assert(ics.split("\r\n ").length > 1, "nothing was folded");
  });

  await h.test("every continuation line begins with exactly one space", () => {
    const ics = buildCalendar({
      trip: TRIP,
      reservations: [res({ notes: "x".repeat(400) })],
      now: new Date(),
    });
    for (const line of ics.split("\r\n").filter((l) => l !== "")) {
      if (line.startsWith(" ")) {
        h.assert(!line.startsWith("  "), "continuation must have ONE leading space");
      }
    }
  });

  /* -- filename --------------------------------------------------------- */

  await h.test("the filename is slugged and safe", () => {
    h.assertEqual(calendarFilename("Lisbon Long Weekend"), "lisbon-long-weekend.ics");
    h.assertEqual(calendarFilename("Chicago — Family Visit"), "chicago-family-visit.ics");
    /*
     * Path traversal and header injection both hinge on the filename. A name of
     * "../../etc/passwd" must not survive into a Content-Disposition header.
     */
    const evil = calendarFilename("../../etc/passwd");
    h.assert(!evil.includes("/"), `slash survived: ${evil}`);
    h.assert(!evil.includes(".."), `dotdot survived: ${evil}`);
    h.assert(evil.endsWith(".ics"), "must keep the extension");
  });

  await h.test("an empty or symbol-only name still yields a usable filename", () => {
    h.assertEqual(calendarFilename(""), "trip.ics");
    h.assertEqual(calendarFilename("!!!"), "trip.ics");
  });
}

(async function main() {
  await run();
  h.summary();
})();
