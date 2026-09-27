/*
 * Itinerary ordering: the rules the native screen depends on.
 *
 * `TPItinerary.ordered` in
 * plugins/native-screens/ios/Sources/NativeScreensPlugin/TPItinerary.swift is a
 * PORT of `inItineraryOrder` in src/lib/itineraryOrder.ts. Two implementations
 * of one rule set is a divergence waiting to happen, and divergence here is
 * silent: both produce a plausible order, just different ones, so a user would
 * see their itinerary reshuffle between the web app and the phone.
 *
 * There is no way to run Swift from this Node test suite, so this file cannot
 * assert the two agree directly. What it does instead is PIN THE CONTRACT: it
 * tests the TS implementation, which is the source of truth, against the exact
 * cases the Swift comments claim to handle. If the TS behaviour changes, these
 * tests fail and the Swift port has to be revisited deliberately rather than
 * drifting. Each test names the Swift code it corresponds to.
 *
 * The three cases marked BUG are the ones the module's own history documents --
 * each shipped once, each produced a wrong-but-not-obviously-wrong result.
 */

const h = require("./harness.cjs");

const { inItineraryOrder } = h.loadModule("src/lib/itineraryOrder.ts");

/** Minimal reservation. Defaults are the "empty" shape the API sends. */
function res(over = {}) {
  return {
    id: "r1",
    tripId: "t1",
    type: "flight",
    title: "",
    confirmation: "",
    confirmed: true,
    location: "",
    locationTo: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    cost: "",
    notes: "",
    order: 0,
    orderManual: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

(async () => {
  /* ---------------------------------------------------------------------
   * Pass 1: date order. Mirrors the `byDate` sort in TPItinerary.ordered.
   * ------------------------------------------------------------------- */

  await h.test("orders by date ascending", () => {
    const out = inItineraryOrder([
      res({ id: "c", startDate: "2026-10-23" }),
      res({ id: "a", startDate: "2026-10-21" }),
      res({ id: "b", startDate: "2026-10-22" }),
    ]);
    h.assertDeepEqual(out.map((r) => r.id), ["a", "b", "c"]);
  });

  await h.test("undated rows sink below dated ones", () => {
    // An undated row must still name a location to be rendered at all -- see
    // the filter test below. Given that, it sorts to the end.
    const out = inItineraryOrder([
      res({ id: "undated", startDate: "", location: "LIS" }),
      res({ id: "dated", startDate: "2026-10-21" }),
    ]);
    h.assertDeepEqual(out.map((r) => r.id), ["dated", "undated"]);
  });

  await h.test(
    "a row with neither a date nor a location is dropped entirely",
    () => {
      /*
       * This is the divergence the Swift port initially got WRONG: it kept such
       * rows, so the phone would have shown a booking the web hides. A row with
       * no date and no place has nothing to sequence and nothing to render.
       */
      const out = inItineraryOrder([
        res({ id: "ghost", startDate: "", location: "" }),
        res({ id: "real", startDate: "2026-10-21" }),
      ]);
      h.assertDeepEqual(out.map((r) => r.id), ["real"]);
    }
  );

  await h.test(
    "BUG: within a date, a timed row sorts before an untimed one",
    () => {
      /*
       * An untimed booking makes no claim about when it happens, so it cannot
       * precede a departure with a clock time. Letting "" sort first (its
       * natural lexical position) made it do exactly that -- which put a car
       * hire above the flight that had to happen first.
       */
      const out = inItineraryOrder([
        res({ id: "untimed", startDate: "2026-10-21", startTime: "" }),
        res({ id: "timed", startDate: "2026-10-21", startTime: "15:10" }),
      ]);
      h.assertDeepEqual(out.map((r) => r.id), ["timed", "untimed"]);
    }
  );

  await h.test("within a date, two timed rows order by time", () => {
    const out = inItineraryOrder([
      res({ id: "late", startDate: "2026-10-21", startTime: "20:00" }),
      res({ id: "early", startDate: "2026-10-21", startTime: "09:20" }),
    ]);
    h.assertDeepEqual(out.map((r) => r.id), ["early", "late"]);
  });

  await h.test("equal date and time break by id, so the order is total", () => {
    // Without this the comparator is not a strict weak ordering and two
    // identical-keyed rows can swap between loads.
    const out = inItineraryOrder([
      res({ id: "z", startDate: "2026-10-21", startTime: "09:00" }),
      res({ id: "a", startDate: "2026-10-21", startTime: "09:00" }),
    ]);
    h.assertDeepEqual(out.map((r) => r.id), ["a", "z"]);
  });

  /* ---------------------------------------------------------------------
   * Pass 2: manual ranks. Mirrors the lift-and-reinsert in TPItinerary.
   * ------------------------------------------------------------------- */

  await h.test(
    "BUG: a stored `order` alone does not count as a manual position",
    () => {
      /*
       * `order` is NOT NULL DEFAULT 0 and every insert assigns MAX+1, so
       * treating it as a drag marked every row as manually placed and let the
       * importer's file order win -- car and hotel ahead of the flight, which
       * drew a road from London to Munich.
       */
      const out = inItineraryOrder([
        res({ id: "car", startDate: "2026-10-21", order: 0, orderManual: null }),
        res({ id: "flight", startDate: "2026-10-21", startTime: "15:10", order: 1, orderManual: null }),
      ]);
      h.assertDeepEqual(
        out.map((r) => r.id),
        ["flight", "car"],
        "insertion order must not outrank the date sort"
      );
    }
  );

  await h.test("a row with orderManual is lifted to its rank", () => {
    const out = inItineraryOrder(
      [
        res({ id: "first", startDate: "2026-10-21", order: 0, orderManual: 0 }),
        res({ id: "second", startDate: "2026-10-22", order: 1, orderManual: 1 }),
        res({ id: "third", startDate: "2026-10-23", order: 2, orderManual: 2 }),
      ],
      { ranks: new Map([["third", 0]]) }
    );
    /*
     * `third` lifts to rank 0. `first` and `second` also carry `orderManual`,
     * so they are lifted too -- their ranks come from their stored `order`
     * (0 and 1), so each is re-inserted after `third`, restoring their relative
     * order. The net effect is a rotation, not `third` spliced into place.
     */
    h.assertDeepEqual(out.map((r) => r.id), ["third", "second", "first"]);
  });

  await h.test("a rank beyond the list length is clamped, not out of range", () => {
    /*
     * A row dragged below everything can carry a rank >= the length of the list
     * it is re-entering. Unclamped, this is an out-of-bounds splice -- the
     * Swift uses `min(ordered.count, rank)` for the same reason.
     */
    const out = inItineraryOrder(
      [
        res({ id: "a", startDate: "2026-10-21" }),
        res({ id: "b", startDate: "2026-10-22" }),
      ],
      { ranks: new Map([["a", 99]]) }
    );
    h.assertDeepEqual(out.map((r) => r.id), ["b", "a"]);
  });

  await h.test("rows sharing a rank resolve by stored order, not date order", () => {
    // The tiebreak the Swift mirrors with `dateIdx`.
    const out = inItineraryOrder(
      [
        res({ id: "a", startDate: "2026-10-21" }),
        res({ id: "b", startDate: "2026-10-22" }),
        res({ id: "c", startDate: "2026-10-23" }),
      ],
      {
        ranks: new Map([
          ["a", 0],
          ["b", 0],
        ]),
      }
    );
    /*
     * Both `a` and `b` are lifted at rank 0 and their stored `order` (0 and 1)
     * breaks the tie, so `b` is inserted first. `a` is already out of the base
     * list by then, so it cannot end up ahead of `b`. Mirroring this exactly is
     * why the Swift tiebreaks on stored rank then date index rather than
     * assuming tied rows keep their date order -- that assumption gives
     * ["a","b","c"], which is NOT what the web produces.
     */
    h.assertDeepEqual(out.map((r) => r.id), ["b", "a", "c"]);
  });

  /* ---------------------------------------------------------------------
   * Day grouping. Mirrors TPItinerary.byDay.
   * ------------------------------------------------------------------- */

  await h.test("day grouping runs in itinerary order, not date order", () => {
    /*
     * Grouping must follow the ORDERED list. If it re-sorted by date it would
     * undo a drag that crossed days -- the user would see the row move in the
     * flat list and snap back under a heading.
     */
    const ordered = inItineraryOrder(
      [
        res({ id: "a", startDate: "2026-10-21" }),
        res({ id: "b", startDate: "2026-10-22" }),
      ],
      { ranks: new Map([["b", 0]]) }
    );
    h.assertDeepEqual(ordered.map((r) => r.id), ["b", "a"]);
    // Consecutive grouping in this order yields b's day first.
    const days = [];
    for (const r of ordered) {
      if (days[days.length - 1] !== r.startDate) days.push(r.startDate);
    }
    h.assertDeepEqual(days, ["2026-10-22", "2026-10-21"]);
  });

  await h.test("undated rows with a location share one empty heading", () => {
    const out = inItineraryOrder([
      res({ id: "u1", startDate: "", location: "LIS" }),
      res({ id: "u2", startDate: "", location: "LGW" }),
    ]);
    const groups = [];
    for (const r of out) {
      if (groups[groups.length - 1] !== r.startDate) groups.push(r.startDate);
    }
    // One group keyed on the empty date, which the heading renders as
    // "No date" via TPItinerary.dayHeading.
    h.assertDeepEqual(groups, [""]);
  });

  h.summary();
})();
