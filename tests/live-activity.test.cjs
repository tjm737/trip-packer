/*
 * Tests for Live Activity scheduling.
 *
 * The expensive failure mode here is silence: if the window maths is wrong, the
 * banner simply never appears on the morning of a flight, and the first person to
 * notice is the traveller. So these lean on the boundaries and on the cases where
 * a real reservation would differ from a tidy one.
 */

const h = require("./harness.cjs");

const {
  LEAD_HOURS,
  MAX_ACTIVITY_HOURS,
  TRAILING_HOURS,
  resolveDeparture,
  isLiveAt,
  planForReservation,
  selectActivity,
} = h.loadModule("src/lib/liveActivity.ts");

/* 2026-10-21T20:00 local. The example from the request: an 8pm flight. */
const EIGHT_PM = Date.UTC(2026, 9, 21, 20, 0, 0);

const flight = (over = {}) => ({
  id: "res-1",
  title: "Delta 4021",
  type: "flight",
  startDate: "2026-10-21",
  startTime: "20:00",
  location: "CPH",
  locationTo: "LIS",
  ...over,
});

async function run() {
  /* -- resolving the departure instant ------------------------------------- */

  await h.test("an 8pm flight resolves to 8pm UTC at zero offset", () => {
    h.assertEqual(resolveDeparture("2026-10-21", "20:00", 0), EIGHT_PM);
  });

  await h.test("the offset shifts the instant, not the wall clock", () => {
    /*
     * Copenhagen is UTC+2 in October. 8pm local is 18:00 UTC, so the instant is
     * two hours EARLIER than the naive UTC reading. Getting this sign backwards is
     * the classic bug and would fire the banner four hours off.
     */
    const twoHours = 120;
    h.assertEqual(resolveDeparture("2026-10-21", "20:00", twoHours), EIGHT_PM - 7_200_000);
  });

  await h.test("a single-digit hour is accepted", () => {
    // The reservation editor does not force a leading zero.
    h.assertEqual(resolveDeparture("2026-10-21", "8:00", 0), Date.UTC(2026, 9, 21, 8, 0, 0));
  });

  await h.test("midnight resolves to the start of the day, not the next one", () => {
    h.assertEqual(resolveDeparture("2026-10-21", "00:00", 0), Date.UTC(2026, 9, 21, 0, 0, 0));
  });

  await h.test("a missing or malformed time returns null instead of throwing", () => {
    // A half-filled reservation is normal -- you book before you know the time.
    h.assertEqual(resolveDeparture("2026-10-21", "", 0), null);
    h.assertEqual(resolveDeparture("2026-10-21", "evening", 0), null);
    h.assertEqual(resolveDeparture("", "20:00", 0), null);
    h.assertEqual(resolveDeparture("2026-10-21", "25:00", 0), null);
    h.assertEqual(resolveDeparture("2026-10-21", "20:70", 0), null);
  });

  await h.test("an impossible date is rejected rather than rolled over", () => {
    /*
     * Date.UTC turns 2026-02-31 into March 3 without complaint. If that leaked
     * through, a typo in a reservation would silently schedule a banner three days
     * late instead of being ignored.
     */
    h.assertEqual(resolveDeparture("2026-02-31", "20:00", 0), null);
    h.assertEqual(resolveDeparture("2026-13-01", "20:00", 0), null);
  });

  /* -- the window ---------------------------------------------------------- */

  await h.test("the banner starts six hours before departure", () => {
    const plan = planForReservation(flight(), 0);
    h.assertEqual(plan.startsAt, EIGHT_PM - 6 * 3_600_000); // 14:00
    h.assertEqual(plan.departsAt, EIGHT_PM);
  });

  await h.test("the banner is not live seven hours out and is live at six", () => {
    const plan = planForReservation(flight(), 0);
    h.assertEqual(isLiveAt(plan, EIGHT_PM - 7 * 3_600_000), false);
    // Exactly at the boundary must be live, or the activity would never start.
    h.assertEqual(isLiveAt(plan, EIGHT_PM - 6 * 3_600_000), true);
  });

  await h.test("the banner survives departure and ends a few hours later", () => {
    const plan = planForReservation(flight(), 0);
    h.assertEqual(isLiveAt(plan, EIGHT_PM), true);
    h.assertEqual(isLiveAt(plan, EIGHT_PM + 60_000), true);
    h.assertEqual(isLiveAt(plan, plan.endsAt), false); // half-open at the end
  });

  await h.test("the window fits inside Apple's eight-hour cap", () => {
    /*
     * The system ends an activity at eight hours regardless of what we asked for,
     * so a plan longer than that is a plan the OS will truncate. The cap has to
     * hold with margin, not exactly.
     */
    const plan = planForReservation(flight(), 0);
    const hours = (plan.endsAt - plan.startsAt) / 3_600_000;
    h.assert(hours <= MAX_ACTIVITY_HOURS, `window was ${hours}h, cap is ${MAX_ACTIVITY_HOURS}h`);
    h.assert(hours > 0, "window must have positive length");
    // 6h lead + 4h trailing = 10h naturally, which EXCEEDS the cap, so the clamp
    // is what keeps this legal. Proves the clamp is load-bearing.
    h.assertEqual(LEAD_HOURS + TRAILING_HOURS > MAX_ACTIVITY_HOURS, true);
  });

  /* -- which reservations get one ------------------------------------------ */

  await h.test("hotels, cars and activities get no banner", () => {
    // A hotel check-in is not something you travel toward, and a museum ticket
    // certainly is not. Each one would be noise on a lock screen.
    h.assertEqual(planForReservation(flight({ type: "lodging" }), 0), null);
    h.assertEqual(planForReservation(flight({ type: "car" }), 0), null);
    h.assertEqual(planForReservation(flight({ type: "activity" }), 0), null);
    h.assertEqual(planForReservation(flight({ type: "other" }), 0), null);
  });

  await h.test("trains get a banner too, flights obviously do", () => {
    h.assert(planForReservation(flight({ type: "flight" }), 0) !== null);
    h.assert(planForReservation(flight({ type: "train" }), 0) !== null);
  });

  await h.test("a reservation with no usable time is skipped, not crashed on", () => {
    h.assertEqual(planForReservation(flight({ startTime: "" }), 0), null);
    h.assertEqual(planForReservation(flight({ startDate: "" }), 0), null);
    h.assertEqual(planForReservation(null, 0), null);
  });

  await h.test("the activity id is derived from the reservation and namespaced", () => {
    const plan = planForReservation(flight({ id: "abc-123" }), 0);
    h.assertEqual(plan.activityId, "trip-departure:abc-123");
    // Stable across calls, so an update targets the same activity rather than
    // creating a second banner beside the first one.
    h.assertEqual(planForReservation(flight({ id: "abc-123" }), 0).activityId, plan.activityId);
  });

  await h.test("the route label is built from the two locations", () => {
    h.assertEqual(planForReservation(flight(), 0).route, "CPH → LIS");
    // Half-known routes degrade to empty rather than an arrow with nothing on
    // one side, which reads as a rendering bug.
    h.assertEqual(planForReservation(flight({ locationTo: "" }), 0).route, "");
    h.assertEqual(planForReservation(flight({ location: "" }), 0).route, "");
  });

  await h.test("an untitled reservation still gets a usable label", () => {
    h.assertEqual(planForReservation(flight({ title: "  " }), 0).title, "Departure");
  });

  /* -- selection ----------------------------------------------------------- */

  await h.test("selectActivity reports live during the window", () => {
    const now = EIGHT_PM - 2 * 3_600_000; // 6pm, two hours before departure
    const { live } = selectActivity([flight()], 0, now);
    h.assertEqual(live.reservationId, "res-1");
    h.assertEqual(live.departsAt, EIGHT_PM);
  });

  await h.test("selectActivity reports live at exactly the start of the window", () => {
    const { live } = selectActivity([flight()], 0, EIGHT_PM - 6 * 3_600_000);
    h.assert(live !== null, "must be live exactly six hours out");
  });

  await h.test("selectActivity is quiet the day before", () => {
    // This is the 48-hour case: a banner must NOT be up a day ahead.
    const { live } = selectActivity([flight()], 0, EIGHT_PM - 24 * 3_600_000);
    h.assertEqual(live, null);
  });

  await h.test("selectActivity offers the next plan so a timer can be armed", () => {
    /*
     * The reason `next` exists: without it the caller has to poll, and a polled
     * banner appears late. Here, a day out, nothing is live but the coming flight
     * is handed back with the instant to wake up at.
     */
    const now = EIGHT_PM - 24 * 3_600_000;
    const { live, next } = selectActivity([flight()], 0, now);
    h.assertEqual(live, null);
    h.assertEqual(next.startsAt, EIGHT_PM - 6 * 3_600_000);
  });

  await h.test("next skips the activity that is already live", () => {
    /*
     * If `next` returned the live plan, the caller would arm a timer for an
     * instant in the past, fire immediately, and re-check in a tight loop.
     */
    const now = EIGHT_PM - 2 * 3_600_000;
    const { live, next } = selectActivity([flight()], 0, now);
    h.assert(live !== null, "expected a live activity");
    h.assertEqual(next, null); // nothing after it in this single-flight list
  });

  await h.test("with two legs, the earlier departure wins", () => {
    /*
     * A multi-leg itinerary must announce the leg being taken now, not an
     * arbitrary one. Sorting is by departure, so the first leg is selected first.
     */
    const leg1 = flight({ id: "leg-1", startTime: "08:00", location: "CPH", locationTo: "FRA" });
    const leg2 = flight({ id: "leg-2", startTime: "20:00", location: "FRA", locationTo: "LIS" });
    const now = Date.UTC(2026, 9, 21, 7, 0, 0); // 7am, inside leg1's window
    const { live } = selectActivity([leg2, leg1], 0, now);
    h.assertEqual(live.reservationId, "leg-1");
  });

  await h.test("after the first leg ends, the second leg takes over", () => {
    const leg1 = flight({ id: "leg-1", startTime: "08:00" });
    const leg2 = flight({ id: "leg-2", startTime: "20:00" });
    // 3pm: leg1's banner is down (ended at noon-ish), leg2's is up (from 2pm).
    const now = Date.UTC(2026, 9, 21, 15, 0, 0);
    const { live } = selectActivity([leg1, leg2], 0, now);
    h.assertEqual(live.reservationId, "leg-2");
  });

  await h.test("a trip with nothing schedulable yields no activity", () => {
    const { live, next } = selectActivity(
      [flight({ type: "lodging" }), flight({ id: "x", type: "car" })],
      0,
      EIGHT_PM
    );
    h.assertEqual(live, null);
    h.assertEqual(next, null);
  });

  await h.test("an empty or missing list is handled", () => {
    h.assertDeepEqual(selectActivity([], 0, EIGHT_PM), { live: null, next: null });
    h.assertDeepEqual(selectActivity(null, 0, EIGHT_PM), { live: null, next: null });
  });

  await h.summary();
}

run();
