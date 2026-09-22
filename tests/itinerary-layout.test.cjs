/*
 * Tests for the shared itinerary layout helpers used by the printable
 * itinerary (and available to the on-screen view).
 *
 * The bug class these guard against: the paper disagreeing with the screen.
 * `groupByDay` and `sortReservations` are what decide the order a traveller
 * reads their day in, and a printed itinerary is the copy they actually hold at
 * the airport — a wrong night count or a booking filed under the wrong day is
 * not a cosmetic defect, it is a missed flight.
 *
 * The specific traps covered:
 *
 *   1. NIGHTS vs DAYS. `tripDurationDays` counts inclusively and floors at one,
 *      so a 3rd-to-8th stay is 6 "days" but 5 nights. Reusing it here would
 *      overstate every hotel booking by one night.
 *
 *   2. A MULTI-DAY BOOKING APPEARS ONCE, ON ITS START DATE. A four-night hotel
 *      is not four calendar entries; it is one entry with a night count. Grouping
 *      by end date would file it on the checkout day, after the flight home.
 *
 *   3. DATED DAYS BEFORE UNDATED. Days sort chronologically and the undated
 *      bucket sorts last, so "Unscheduled" cannot land in the middle of a trip.
 *
 *   4. A DAY HEADING IS A CALENDAR DATE, NOT AN INSTANT. Weekday derivation must
 *      not shift by a day in a timezone behind UTC.
 */

const h = require("./harness.cjs");

const {
  groupByDay,
  groupPacking,
  reservationWhen,
  sortReservations,
  sortTasks,
} = h.loadModule("src/lib/itineraryLayout.ts");

const { nightsBetween, tripDurationDays } = h.loadModule("src/lib/dates.ts");

/** Minimal Reservation. Only the fields layout actually reads. */
function res(o) {
  return {
    id: o.id,
    tripId: "t1",
    type: o.type || "activity",
    title: o.title || o.id,
    confirmation: o.confirmation || "",
    confirmed: o.confirmed ?? true,
    location: o.location || "",
    locationTo: o.locationTo || "",
    startDate: o.startDate || "",
    startTime: o.startTime || "",
    endDate: o.endDate || "",
    endTime: o.endTime || "",
    cost: "",
    notes: o.notes || "",
    order: o.order ?? 0,
    orderManual: o.orderManual ?? null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

(async () => {
  /* ── nightsBetween ─────────────────────────────────────────────────────── */

  await h.test("nightsBetween counts nights, not days", () => {
    // 3 Aug to 8 Aug is 5 nights, 6 days.
    h.assertEqual(nightsBetween("2026-08-03", "2026-08-08"), 5);
    // The trip-duration helper deliberately disagrees; pinning both proves the
    // two are not accidentally the same function.
    h.assertEqual(tripDurationDays("2026-08-03", "2026-08-08"), 6);
  });

  await h.test("nightsBetween is 0 for a same-day stay, not 1", () => {
    // The trap: Math.max(1, ...) in tripDurationDays would say 1.
    h.assertEqual(nightsBetween("2026-08-03", "2026-08-03"), 0);
    h.assertEqual(tripDurationDays("2026-08-03", "2026-08-03"), 1);
  });

  await h.test("nightsBetween is 0 for missing, blank or invalid dates", () => {
    h.assertEqual(nightsBetween("", ""), 0);
    h.assertEqual(nightsBetween(null, null), 0);
    h.assertEqual(nightsBetween("2026-08-03", ""), 0);
    h.assertEqual(nightsBetween("not-a-date", "2026-08-08"), 0);
  });

  await h.test("nightsBetween never returns a negative night count", () => {
    // A checkout date typed before the checkin is bad data, but it must not
    // print "-3 nights".
    h.assertEqual(nightsBetween("2026-08-08", "2026-08-03"), 0);
  });

  await h.test("nightsBetween spans a month and a DST boundary correctly", () => {
    // 28 Feb to 3 Mar in a non-leap year is 3 nights.
    h.assertEqual(nightsBetween("2026-02-28", "2026-03-03"), 3);
    // Crossing US DST (8 Mar 2026) must not produce a fractional night.
    h.assertEqual(nightsBetween("2026-03-06", "2026-03-10"), 4);
  });

  /* ── groupByDay ───────────────────────────────────────────────────────── */

  await h.test("a hotel appears once, on its check-in date, with its night count", () => {
    // The hotel is 8-12 Oct. It must group under the 8th only.
    const hotel = res({
      id: "hotel",
      type: "lodging",
      startDate: "2026-10-08",
      endDate: "2026-10-12",
    });
    const days = groupByDay([hotel]);

    h.assertEqual(days.length, 1);
    h.assertEqual(days[0].date, "2026-10-08");
    h.assertEqual(days[0].reservations.length, 1);
    h.assertEqual(nightsBetween(hotel.startDate, hotel.endDate), 4);
  });

  await h.test("days come out in chronological order", () => {
    const days = groupByDay([
      res({ id: "c", startDate: "2026-10-12" }),
      res({ id: "a", startDate: "2026-10-08" }),
      res({ id: "b", startDate: "2026-10-10" }),
    ]);

    h.assertEqual(days.map((d) => d.date), ["2026-10-08", "2026-10-10", "2026-10-12"]);
  });

  await h.test("undated bookings group together and sort last", () => {
    const days = groupByDay([
      res({ id: "someday", startDate: "" }),
      res({ id: "dated", startDate: "2026-10-08" }),
      res({ id: "alsoundated", startDate: "" }),
    ]);

    // Two buckets: the real day first, then a single undated bucket.
    h.assertEqual(days.length, 2);
    h.assertEqual(days[0].date, "2026-10-08");
    h.assertEqual(days[1].date, "");
    h.assertEqual(days[1].reservations.length, 2);
  });

  await h.test("within a day, a timed booking precedes an untimed one", () => {
    // Same rule the map relies on: an untimed booking makes no claim about
    // preceding a scheduled departure.
    const days = groupByDay([
      res({ id: "car", startDate: "2026-10-13", type: "car" }),
      res({ id: "flight", startDate: "2026-10-13", startTime: "15:10", type: "flight" }),
    ]);

    h.assertEqual(days.length, 1);
    h.assertEqual(days[0].reservations.map((r) => r.id), ["flight", "car"]);
  });

  await h.test("groupByDay on an empty list yields no days", () => {
    h.assertEqual(groupByDay([]).length, 0);
  });

  await h.test("a day is never split into two headings, whatever the drag order", () => {
    /*
     * Pins the invariant that `groupByDay` must keep one heading per date, and
     * that it does not rely on dates being contiguous in the sorted order.
     *
     * Honest note: this does NOT reproduce a live bug. `inItineraryOrder` was
     * brute-forced over 65,536 date/rank combinations and never emits a
     * non-contiguous date sequence, so the earlier run-detecting implementation
     * of `groupByDay` gave identical output. The grouping was rewritten to key by
     * date so it no longer DEPENDS on that invariant, and this test asserts the
     * invariant directly instead of trusting that it will always hold.
     *
     * Ranks are chosen to make the sorted order interleave if that ever becomes
     * possible: the 15th is dragged to rank 1, between the two 13th bookings.
     */
    const input = [
      res({ id: "oct13a", startDate: "2026-10-13", orderManual: 0 }),
      res({ id: "oct15", startDate: "2026-10-15", orderManual: 1 }),
      res({ id: "oct13b", startDate: "2026-10-13", orderManual: 2 }),
    ];

    // The two 13th bookings must never end up under separate headings, no
    // matter where the dragged 15th is placed among them.
    const days = groupByDay(input);
    const dates = days.map((d) => d.date);
    h.assertEqual(
      dates.filter((d) => d === "2026-10-13").length,
      1,
      `expected one heading for the 13th, got ${JSON.stringify(dates)}`
    );

    // And both of the 13th's bookings survive, under that single heading.
    const thirteenth = days.find((d) => d.date === "2026-10-13");
    h.assertEqual(thirteenth.reservations.map((r) => r.id).sort().join(","), "oct13a,oct13b");

    // Every reservation appears exactly once across all headings — no booking is
    // dropped or duplicated by grouping.
    h.assertEqual(
      days.flatMap((d) => d.reservations.map((r) => r.id)).sort().join(","),
      "oct13a,oct13b,oct15"
    );
  });

  await h.test("an undated, locationless booking still reaches the printed document", () => {
    /*
     * `inItineraryOrder` drops a booking with no date AND no location by default,
     * because the map cannot place it on a route. That default would be data loss
     * here: a booking the user typed in with just a title is still a booking, and
     * the printout is the copy that travels. `sortReservations` passes
     * `includeUnmapped` for exactly this reason.
     */
    const bare = res({ id: "bare", title: "Book the dog sitter", startDate: "", location: "" });
    h.assertEqual(sortReservations([bare]).length, 1, "undated booking was dropped");

    // And it lands in the trailing undated bucket rather than among the days.
    const days = groupByDay([res({ id: "dated", startDate: "2026-10-08" }), bare]);
    h.assertEqual(days.map((d) => d.date).join("|"), "2026-10-08|");
    h.assertEqual(days[1].reservations[0].id, "bare");
  });

  /* ── reservationWhen ──────────────────────────────────────────────────── */

  await h.test("reservationWhen renders time, or a range, or nothing", () => {
    // Timed and dated: includes the time.
    const timed = reservationWhen(
      res({ id: "f", startDate: "2026-10-13", startTime: "15:10" })
    );
    h.assert(timed.includes("15:10"), `expected a time in "${timed}"`);

    // A stay shows the checkout it ends on, not a time it never had.
    const stay = reservationWhen(
      res({
        id: "h",
        type: "lodging",
        startDate: "2026-10-08",
        endDate: "2026-10-12",
      })
    );
    h.assert(stay.length > 0, "expected a non-empty range for a stay");

    // No dates at all: empty, so the caller renders no metadata row.
    h.assertEqual(reservationWhen(res({ id: "n", startDate: "" })), "");
  });

  /* ── sortReservations / sortTasks ─────────────────────────────────────── */

  await h.test("sortReservations puts dated before undated", () => {
    const sorted = sortReservations([
      res({ id: "none", startDate: "" }),
      res({ id: "dated", startDate: "2026-10-08" }),
    ]);
    h.assertEqual(sorted.map((r) => r.id), ["dated", "none"]);
  });

  await h.test("sortTasks orders by due date, undated last", () => {
    const task = (id, dueDate, done) => ({
      id,
      tripId: "t1",
      title: id,
      done: !!done,
      dueDate: dueDate || "",
      order: 0,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const sorted = sortTasks([
      task("later", "2026-10-10"),
      task("whenever", ""),
      task("sooner", "2026-10-01"),
    ]);

    h.assertEqual(sorted.map((t) => t.id), ["sooner", "later", "whenever"]);
  });

  /* ── groupPacking ─────────────────────────────────────────────────────── */

  await h.test("groupPacking returns categories in order, with their items", () => {
    const cats = [
      { id: "c2", tripId: "t1", name: "Clothes", order: 2, createdAt: "" },
      { id: "c1", tripId: "t1", name: "Documents", order: 1, createdAt: "" },
    ];
    const items = [
      { id: "i1", tripId: "t1", categoryId: "c2", name: "Socks", quantity: 3, checked: false, order: 0, createdAt: "" },
      { id: "i2", tripId: "t1", categoryId: "c1", name: "Passport", quantity: 1, checked: true, order: 0, createdAt: "" },
      { id: "i3", tripId: "t1", categoryId: "c2", name: "Shirts", quantity: 2, checked: false, order: 1, createdAt: "" },
    ];

    const groups = groupPacking(cats, items);

    // Categories ordered by their `order` field, not by insertion.
    h.assertEqual(groups.map((g) => g.category.name), ["Documents", "Clothes"]);
    h.assertEqual(groups[0].items.map((i) => i.name), ["Passport"]);
    h.assertEqual(groups[1].items.map((i) => i.name), ["Socks", "Shirts"]);
  });

  await h.test("groupPacking omits a category with no items", () => {
    const cats = [
      { id: "c1", tripId: "t1", name: "Empty", order: 1, createdAt: "" },
      { id: "c2", tripId: "t1", name: "Used", order: 2, createdAt: "" },
    ];
    const items = [
      { id: "i1", tripId: "t1", categoryId: "c2", name: "Thing", quantity: 1, checked: false, order: 0, createdAt: "" },
    ];

    const groups = groupPacking(cats, items);
    // An empty heading on paper is noise; it should not be printed.
    h.assertEqual(groups.map((g) => g.category.name), ["Used"]);
  });

  await h.test("groupPacking returns nothing when there is nothing", () => {
    h.assertEqual(groupPacking([], []).length, 0);
  });

  h.summary();
})();
