/*
 * Live Activity scheduling for the morning of a trip.
 *
 * The activity is a packing-progress banner on the lock screen. It should appear
 * a few hours before the first flight departs and be gone once the trip is
 * properly underway.
 *
 * WHY THIS IS A SEPARATE MODULE
 *
 * The scheduling rules are the part that can be wrong in ways nobody notices
 * until the banner fails to appear at 2pm on the day of a flight. Extracting them
 * makes "does it start at the right moment" a unit test instead of something you
 * discover by watching a lock screen.
 *
 * THE WINDOW
 *
 * Apple caps a Live Activity at 8 hours (12 in its ending state). A T-6h start
 * leaves 2 hours of headroom inside that cap before the system would force the
 * activity to end on us -- see LEAD_HOURS and the hard cap check below.
 *
 * This deliberately does NOT start 48 hours out. Two reasons, both hard:
 *   1. The 8-hour cap. A 48-hour activity is not possible.
 *   2. Apple requires a Live Activity to describe something happening now. A
 *      two-day countdown to a future event is a persistent notification wearing
 *      a Live Activity's clothes, and that is a rejection.
 * Six hours before departure is genuinely "the trip is starting" -- you are
 * packing, heading to the airport, on the way.
 */

/** How long before departure the activity appears. */
export const LEAD_HOURS = 6;

/**
 * Apple's hard cap on a single Live Activity, in hours.
 *
 * Not a preference -- the system ends the activity at this point whether or not
 * we asked. Used as a guard so a scheduling bug shows up in a test rather than as
 * an activity that silently vanishes mid-trip.
 */
export const MAX_ACTIVITY_HOURS = 8;

/**
 * How long the activity is allowed to stay up after departure.
 *
 * The trip itself continues for days, but the banner is about *beginning the
 * trip*. Keeping it up for a week-long holiday would sit permanently on the lock
 * screen and trip the same "is this really live" question the countdown does.
 * Four hours past departure covers boarding, the flight, and arrival.
 */
export const TRAILING_HOURS = 4;

export type LiveActivityReservation = {
  id: string;
  title: string;
  type: string;
  startDate: string;
  startTime: string;
  location: string;
  locationTo: string;
  confirmed?: boolean;
};

export type ActivityPlan = {
  /** Stable identity. Built from the reservation so updates target one activity. */
  activityId: string;
  reservationId: string;
  title: string;
  /** Epoch ms when the banner should appear. */
  startsAt: number;
  /** Epoch ms when the banner should come down. */
  endsAt: number;
  /** Epoch ms of the actual departure, for the countdown label. */
  departsAt: number;
  /** Route label, e.g. "CPH → LIS". Empty when unknown. */
  route: string;
};

/**
 * Resolve a reservation's local wall-clock date+time to an absolute instant.
 *
 * `startDate` is "YYYY-MM-DD" and `startTime` is "HH:MM", both stored as local
 * wall-clock with no timezone -- the same convention `calendar.ts` uses, because
 * a flight booked as 8pm is 8pm wherever you are reading it.
 *
 * `tzOffsetMinutes` is the offset applied to get from that wall clock to UTC.
 * The caller supplies it because the server does not know the traveller's zone;
 * passing it in keeps this function pure and makes the DST case testable without
 * mocking a clock.
 *
 * Returns null rather than throwing on anything unparseable. A malformed
 * reservation should mean "no banner for this one", never a crashed scheduler.
 */
export function resolveDeparture(
  startDate: string,
  startTime: string,
  tzOffsetMinutes: number
): number | null {
  if (typeof startDate !== "string" || typeof startTime !== "string") return null;

  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate.trim());
  if (!d) return null;

  // Accept both "8:00" and "08:00" -- the editor does not force a leading zero.
  const t = /^(\d{1,2}):(\d{2})/.exec(startTime.trim());
  if (!t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (hour > 23 || minute > 59) return null;

  /*
   * Built as UTC deliberately, then shifted by the offset.
   *
   * `Date.UTC` here treats the wall clock as if it were UTC, which is exactly
   * what we want: it gives us a clean integer for "8pm on the 21st" with no
   * platform timezone involved. Subtracting the offset then converts that wall
   * clock into a true instant. Using `new Date(y, m, d, h, mi)` instead would
   * apply the *server's* timezone, which is the bug this avoids.
   */
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(asUtc)) return null;

  // Reject impossible dates like 2026-02-31, which Date.UTC silently rolls over.
  const probe = new Date(asUtc);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }

  return asUtc - tzOffsetMinutes * 60_000;
}

/**
 * Are we inside the window where a Live Activity should be up?
 *
 * Half-open [startsAt, endsAt): at exactly `startsAt` it is live, at exactly
 * `endsAt` it has ended. Half-open avoids the case where a boundary instant is
 * both "live" and "ended", which would make the scheduler start and end an
 * activity in the same tick.
 */
export function isLiveAt(plan: ActivityPlan, now: number): boolean {
  return now >= plan.startsAt && now < plan.endsAt;
}

/**
 * Build the plan for one reservation, or null when it should never have one.
 *
 * Only flights and trains get a banner. A hotel check-in is not an event you
 * travel toward, and an "activity" booking is usually a museum ticket -- putting
 * a live countdown on either would be noise, and each one is another chance to
 * annoy a reviewer.
 */
export function planForReservation(
  reservation: LiveActivityReservation,
  tzOffsetMinutes: number
): ActivityPlan | null {
  if (!reservation || typeof reservation.id !== "string" || !reservation.id) return null;
  if (reservation.type !== "flight" && reservation.type !== "train") return null;

  const departsAt = resolveDeparture(
    reservation.startDate,
    reservation.startTime,
    tzOffsetMinutes
  );
  if (departsAt === null) return null;

  const startsAt = departsAt - LEAD_HOURS * 3_600_000;
  const naturalEnd = departsAt + TRAILING_HOURS * 3_600_000;

  /*
   * Enforce the cap rather than trusting TRAILING_HOURS to stay small.
   *
   * If someone later raises LEAD_HOURS or TRAILING_HOURS past the system limit,
   * this clamps instead of producing plans that the OS will silently truncate.
   * Clamping is the right failure mode: a banner that ends early is a much better
   * bug than one that never appears because the schedule was rejected.
   */
  const hardCapEnd = startsAt + MAX_ACTIVITY_HOURS * 3_600_000;
  const endsAt = Math.min(naturalEnd, hardCapEnd);

  const from = (reservation.location || "").trim();
  const to = (reservation.locationTo || "").trim();
  const route = from && to ? `${from} → ${to}` : "";

  return {
    // Namespaced so a future activity type cannot collide with this one.
    activityId: `trip-departure:${reservation.id}`,
    reservationId: reservation.id,
    title: (reservation.title || "").trim() || "Departure",
    startsAt,
    endsAt,
    departsAt,
    route,
  };
}

/**
 * Pick which reservation, if any, should be showing an activity right now.
 *
 * Returns the live plan when one is in its window. When nothing is live it
 * returns the next upcoming plan, so the caller can schedule a timer instead of
 * polling -- that is the difference between a banner that appears on time and one
 * that appears whenever the next poll happens to run.
 *
 * Ties are broken by earliest departure, so a multi-leg itinerary announces the
 * leg you are about to take rather than an arbitrary one.
 */
export function selectActivity(
  reservations: LiveActivityReservation[],
  tzOffsetMinutes: number,
  now: number
): { live: ActivityPlan | null; next: ActivityPlan | null } {
  const plans = (reservations || [])
    .map((r) => planForReservation(r, tzOffsetMinutes))
    .filter((p): p is ActivityPlan => p !== null)
    .sort((a, b) => a.departsAt - b.departsAt);

  const live = plans.find((p) => isLiveAt(p, now)) ?? null;

  /*
   * `next` skips anything already live: the caller uses it to arm a timer, and
   * arming one for the activity that is already on screen would fire immediately
   * and immediately re-check, spinning.
   */
  const next = plans.find((p) => p.startsAt > now) ?? null;

  return { live, next };
}
