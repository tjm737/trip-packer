/*
 * Tests for itinerary sequencing — the order the map and the itinerary list
 * read reservations in.
 *
 * The bug these exist to pin down: on a trip with a flight from London to
 * Munich, the map drew a DRIVING line between them. The sequencing was fine
 * for anything with a date and a time, but a same-day tie was broken by
 * comparing `startTime` as a string, and an untimed booking stores "" — which
 * sorts below every "HH:MM". So a car hire and a hotel, both untimed, sorted
 * ahead of the 15:10 departure that was the only way to reach them. The map
 * then faithfully drew a road from London to Munich, because as far as it knew
 * you collected a car in Munich before flying to Munich.
 *
 * The rule that fixes it: within one date, a reservation carrying a time comes
 * before one that does not. An untimed booking is pinned to the day and makes
 * no finer claim, so it cannot be said to precede a scheduled departure.
 *
 * These cases are deliberately written against the REAL trip that exposed the
 * bug (BA66 / BA936 / BA939 / AA729, PHL-LHR-MUC-LHR-PHL) rather than invented
 * data, because the shape of the failure was specific: two untimed records
 * sharing a date with a timed flight.
 */

const path = require("path");
const h = require("./harness.cjs");

const { inItineraryOrder } = h.loadModule("src/lib/itineraryOrder.ts");

/** Minimal Reservation. Only the fields sequencing actually reads. */
function res(o) {
  return {
    id: o.id,
    tripId: "t1",
    type: o.type || "activity",
    title: o.title || o.id,
    confirmation: "",
    confirmed: true,
    location: o.location || "",
    locationTo: o.locationTo || "",
    startDate: o.startDate || "",
    startTime: o.startTime || "",
    endDate: o.endDate || "",
    endTime: o.endTime || "",
    cost: "",
    notes: "",
    order: o.order ?? 0,
    // Default to "never dragged", which is what a real imported or hand-added
    // row looks like. Tests about dragging set this explicitly.
    orderManual: o.orderManual ?? null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const ids = (rs) => rs.map((r) => r.id);

(async () => {
  /* ── The reported bug ──────────────────────────────────────────────────── */

  await h.test("a same-day flight outranks an untimed car hire and hotel", () => {
    // 13 Oct: land LHR 06:50, fly LHR->MUC 15:10, then collect the car at MUC.
    // The car and hotel carry no time, so they must not sort above the flight.
    const out = inItineraryOrder([
      res({ id: "car", type: "car", startDate: "2026-10-13", location: "MUC Airport" }),
      res({ id: "hotel", type: "lodging", startDate: "2026-10-13", location: "near MUC" }),
      res({ id: "flight", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            location: "LHR", locationTo: "MUC" }),
    ]);
    h.assertEqual(ids(out)[0], "flight");
    h.assertEqual(ids(out).slice(1).sort().join(","), "car,hotel");
  });

  await h.test("order field does not let an untimed row jump a timed one", () => {
    // The old failure needed the car to have a SMALLER `order` than the flight,
    // which is what the importer produced. Same-date, timed wins regardless.
    const out = inItineraryOrder([
      res({ id: "car", type: "car", startDate: "2026-10-13", order: 0 }),
      res({ id: "flight", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            order: 9, location: "LHR", locationTo: "MUC" }),
    ]);
    h.assertEqual(ids(out).join(","), "flight,car");
  });

  await h.test("the real trip sequences each flight ahead of its ground legs", () => {
    // The trip as stored, every record untimed except the flights.
    const out = inItineraryOrder([
      res({ id: "BA66", type: "flight", startDate: "2026-10-12", startTime: "18:45",
            location: "PHL", locationTo: "LHR", order: 0 }),
      res({ id: "Sixt", type: "car", startDate: "2026-10-13", location: "MUC Airport", order: 1 }),
      res({ id: "Erding", type: "lodging", startDate: "2026-10-13", location: "near MUC", order: 2 }),
      res({ id: "BA936", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            location: "LHR", locationTo: "MUC", order: 3 }),
      res({ id: "Sofitel", type: "lodging", startDate: "2026-10-19",
            location: "Terminal 5", order: 6 }),
      res({ id: "BA939", type: "flight", startDate: "2026-10-19", startTime: "20:50",
            location: "MUC (T1)", locationTo: "LHR (T5)", order: 7 }),
      res({ id: "AA729", type: "flight", startDate: "2026-10-20", startTime: "09:15",
            location: "LHR", locationTo: "PHL", order: 8 }),
    ]);
    const seq = ids(out);
    // Each flight must precede the ground records sharing its date.
    const at = (x) => seq.indexOf(x);
    if (!(at("BA936") < at("Sixt"))) throw new Error(`BA936 before Sixt: ${seq.join(" ")}`);
    if (!(at("BA936") < at("Erding"))) throw new Error(`BA936 before Erding: ${seq.join(" ")}`);
    if (!(at("BA939") < at("Sofitel"))) throw new Error(`BA939 before Sofitel: ${seq.join(" ")}`);
    // The spine stays in travel order. Erding/Sixt are both untimed on 13 Oct,
    // so their mutual order is a stable tiebreak (id) rather than a date claim —
    // assert only that BA936 leads them.
    h.assertEqual(seq[0], "BA66");
    h.assertEqual(seq[1], "BA936");
    h.assertEqual(new Set(seq.slice(2, 4)).size, 2);
    h.assertEqual([...seq.slice(2, 4)].sort().join(","), "Erding,Sixt");
    // AA729 is the last flight; nothing ground-based may precede it on its date.
    h.assertEqual(seq[seq.length - 1], "AA729");
  });

  /* ── Timed-vs-timed must be untouched ──────────────────────────────────── */

  await h.test("two timed bookings on one date keep clock order", () => {
    const out = inItineraryOrder([
      res({ id: "late", startDate: "2026-10-13", startTime: "18:00" }),
      res({ id: "early", startDate: "2026-10-13", startTime: "07:30" }),
    ]);
    h.assertEqual(ids(out).join(","), "early,late");
  });

  await h.test("the new rule never reorders across dates", () => {
    // An untimed record on an EARLIER date still comes first. The fix applies
    // within a date only; this is the guard against over-reaching.
    const out = inItineraryOrder([
      res({ id: "timed-late-date", startDate: "2026-10-20", startTime: "09:15" }),
      res({ id: "untimed-early-date", startDate: "2026-10-13" }),
    ]);
    h.assertEqual(ids(out).join(","), "untimed-early-date,timed-late-date");
  });

  await h.test("a dated record still outranks an undated one", () => {
    const out = inItineraryOrder([
      res({ id: "undated", location: "Somewhere", order: 0 }),
      res({ id: "dated", startDate: "2026-10-20", startTime: "09:15", order: 5 }),
    ]);
    h.assertEqual(ids(out)[0], "dated");
  });

  /* ── Untimed rows stay stable among themselves ─────────────────────────── */

  await h.test("untimed rows on one date keep their stored relative order", () => {
    // The rule must not scramble the ground legs among themselves. Three
    // untimed hotels differing only by `order` should come out in that order.
    const out = inItineraryOrder([
      res({ id: "h3", type: "lodging", startDate: "2026-10-15", order: 30 }),
      res({ id: "h1", type: "lodging", startDate: "2026-10-15", order: 10 }),
      res({ id: "h2", type: "lodging", startDate: "2026-10-15", order: 20 }),
    ]);
    h.assertEqual(ids(out).join(","), "h1,h2,h3");
  });

  await h.test("a day of untimed records alone is left exactly as it was", () => {
    // Nothing timed on this date, so the new comparison must be a no-op.
    const out = inItineraryOrder([
      res({ id: "a", startDate: "2026-10-15", order: 0 }),
      res({ id: "b", startDate: "2026-10-15", order: 1 }),
      res({ id: "c", startDate: "2026-10-15", order: 2 }),
    ]);
    h.assertEqual(ids(out).join(","), "a,b,c");
  });

  /* ── Drags still win ───────────────────────────────────────────────────── */

  await h.test("a manual drag overrides the timed-first rule", () => {
    // The rule is a default, not a cage: a user who drags the car above the
    // flight gets the car above the flight.
    const ranks = new Map([["car", 0]]);
    const out = inItineraryOrder(
      [
        res({ id: "flight", type: "flight", startDate: "2026-10-13",
              startTime: "15:10", location: "LHR", locationTo: "MUC", order: 3 }),
        res({ id: "car", type: "car", startDate: "2026-10-13", location: "MUC Airport", order: 1 }),
      ],
      { ranks }
    );
    h.assertEqual(ids(out)[0], "car");
  });

  await h.test("a PERSISTED drag outranks dates, so a cross-date drag survives", () => {
    // The capability option (3) was chosen to protect: once a user has dragged,
    // `order` is authoritative and may put an earlier-dated booking lower.
    // Every row is stamped `orderManual` by a real drag, and here the hotel
    // (15 Oct) is deliberately placed above the flight (13 Oct).
    const out = inItineraryOrder([
      res({ id: "flight", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            location: "LHR", locationTo: "MUC", order: 1, orderManual: 1 }),
      res({ id: "hotel", type: "lodging", startDate: "2026-10-15", order: 0, orderManual: 0 }),
    ]);
    h.assertEqual(ids(out).join(","), "hotel,flight");
  });

  await h.test("without a drag the same two rows follow the dates instead", () => {
    // Same data, no drag: dates decide, which is the whole point of the fix.
    const out = inItineraryOrder([
      res({ id: "hotel", type: "lodging", startDate: "2026-10-15", order: 0 }),
      res({ id: "flight", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            location: "LHR", locationTo: "MUC", order: 1 }),
    ]);
    h.assertEqual(ids(out).join(","), "flight,hotel");
  });

  await h.test("a stored order alone does NOT count as a drag", () => {
    // The precise regression. `order` is a dense insertion counter that every
    // row has, so reading it as a manual position marked the importer's file
    // order as authoritative and sank the flights below the car and hotel.
    const out = inItineraryOrder([
      res({ id: "car", type: "car", startDate: "2026-10-13", location: "MUC Airport", order: 0 }),
      res({ id: "hotel", type: "lodging", startDate: "2026-10-13", order: 1 }),
      res({ id: "flight", type: "flight", startDate: "2026-10-13", startTime: "15:10",
            location: "LHR", locationTo: "MUC", order: 2 }),
    ]);
    h.assertEqual(ids(out)[0], "flight");
  });

  /* ── Ordering is a total order (no comparator inconsistencies) ─────────── */

  await h.test("the comparator is stable and does not drop or duplicate rows", () => {
    // A non-transitive comparator can make Array.sort emit a list that keeps
    // every element but in a nonsense order, or (across engines) misbehave.
    // Assert the set survives and that re-sorting is idempotent.
    const input = [
      res({ id: "f1", type: "flight", startDate: "2026-10-13", startTime: "15:10" }),
      res({ id: "u1", startDate: "2026-10-13" }),
      res({ id: "f2", type: "flight", startDate: "2026-10-13", startTime: "06:50" }),
      res({ id: "u2", startDate: "2026-10-13" }),
      res({ id: "u3", startDate: "2026-10-13" }),
    ];
    const once = ids(inItineraryOrder(input));
    const twice = ids(inItineraryOrder(inItineraryOrder(input)));
    h.assertEqual(once.length, input.length);
    h.assertEqual(once.slice().sort().join(","), "f1,f2,u1,u2,u3");
    h.assertEqual(once.join(","), twice.join(","), "re-sorting changed the order");
  });

  h.summary();
})();
