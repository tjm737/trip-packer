/*
 * Pull-to-refresh gesture logic.
 *
 * The component is event handlers over the window and has no assertion surface,
 * so everything that could silently misbehave is a pure function here. These
 * tests are about the failure modes that make a hand-rolled pull-to-refresh feel
 * broken rather than about coverage: firing while scrolled, firing on a swipe,
 * firing on a pinch, and firing after the gesture was abandoned.
 */

const h = require("./harness.cjs");
const {
  PULL_THRESHOLD,
  PULL_MAX,
  PULL_DEAD_ZONE,
  resistPull,
  pullProgress,
  canStartPull,
  isArmed,
  phaseFor,
  shouldBeginPull,
  pullLabel,
} = h.loadModule("src/lib/pullToRefresh.ts");

(async () => {
  /* ── canStartPull: the gate ─────────────────────────────────────────────── */

  await h.test("allows a pull at the very top of the page", () => {
    h.assertEqual(
      canStartPull({ scrollTop: 0, scrollLeft: 0, touches: 1, refreshing: false }),
      true
    );
  });

  await h.test("refuses a pull when the list is scrolled down", () => {
    // The failure this prevents: yanking a user back to the top mid-read and
    // refreshing data they did not ask about.
    h.assertEqual(
      canStartPull({ scrollTop: 400, scrollLeft: 0, touches: 1, refreshing: false }),
      false
    );
  });

  await h.test("tolerates a sub-pixel scroll offset", () => {
    // Fractional scroll positions and rubber-band bounce produce offsets like
    // 0.5; treating those as "scrolled" would make the gesture dead at the top.
    h.assertEqual(
      canStartPull({ scrollTop: 0.5, scrollLeft: 0, touches: 1, refreshing: false }),
      true
    );
    h.assertEqual(
      canStartPull({ scrollTop: 2, scrollLeft: 0, touches: 1, refreshing: false }),
      false
    );
  });

  await h.test("refuses a horizontal swipe that starts at the top", () => {
    // A left-swipe at the top of the page is a navigation gesture, not a pull.
    h.assertEqual(
      canStartPull({ scrollTop: 0, scrollLeft: 60, touches: 1, refreshing: false }),
      false
    );
  });

  await h.test("refuses a multi-touch gesture", () => {
    // Second finger means pinch-zoom or a system gesture; refreshing here would
    // fight the zoom.
    h.assertEqual(
      canStartPull({ scrollTop: 0, scrollLeft: 0, touches: 2, refreshing: false }),
      false
    );
  });

  await h.test("refuses a second pull while a refresh is in flight", () => {
    // Without this the request would fire twice and the indicator would show
    // two overlapping completion states.
    h.assertEqual(
      canStartPull({ scrollTop: 0, scrollLeft: 0, touches: 1, refreshing: true }),
      false
    );
  });

  /* ── shouldBeginPull: intent ────────────────────────────────────────────── */

  const base = { tracking: false, eligible: true };

  await h.test("requires movement past the dead zone", () => {
    // A tap or a tiny wobble while pressing a row must not start a pull.
    h.assertEqual(
      shouldBeginPull({ ...base, dy: PULL_DEAD_ZONE, dx: 0 }),
      false
    );
    h.assertEqual(
      shouldBeginPull({ ...base, dy: PULL_DEAD_ZONE + 1, dx: 0 }),
      true
    );
  });

  await h.test("requires vertical intent to dominate horizontal", () => {
    // A mostly-horizontal drag is a swipe even if it has drifted downward.
    h.assertEqual(
      shouldBeginPull({ ...base, dy: 30, dx: 90 }),
      false
    );
    h.assertEqual(
      shouldBeginPull({ ...base, dy: 30, dx: 10 }),
      true
    );
  });

  await h.test("does not begin when the gesture is ineligible", () => {
    h.assertEqual(
      shouldBeginPull({ ...base, eligible: false, dy: 100, dx: 0 }),
      false
    );
  });

  await h.test("stays tracking once begun, even if the drag reverses", () => {
    // Once a pull is owned by this component, a reversal must keep ownership so
    // the indicator tracks the finger back up rather than snapping shut the
    // moment the user changes direction.
    h.assertEqual(
      shouldBeginPull({ ...base, tracking: true, dy: -40, dx: 0 }),
      true
    );
  });

  /* ── resistPull: rubber-banding ─────────────────────────────────────────── */

  await h.test("tracks the finger linearly up to the threshold", () => {
    h.assertEqual(resistPull(10), 10);
    h.assertEqual(resistPull(PULL_THRESHOLD), PULL_THRESHOLD);
  });

  await h.test("damps travel past the threshold and caps it", () => {
    // Past the threshold the indicator must slow down, or it hits the cap
    // abruptly and reads as the gesture having hung.
    const justPast = resistPull(PULL_THRESHOLD + 30);
    h.assert(
      justPast < PULL_THRESHOLD + 30,
      "travel past the threshold should be damped, not linear"
    );
    h.assert(justPast > PULL_THRESHOLD, "damping must still grow, not stall");
    h.assertEqual(resistPull(10000), PULL_MAX);
  });

  await h.test("clamps an upward drag to zero", () => {
    // Dragging up from the top must leave the indicator at rest, not open a gap.
    h.assertEqual(resistPull(-50), 0);
    h.assertEqual(resistPull(0), 0);
  });

  /* ── progress and arming ────────────────────────────────────────────────── */

  await h.test("progress saturates at the threshold", () => {
    h.assertEqual(pullProgress(0), 0);
    h.assertEqual(pullProgress(PULL_THRESHOLD / 2), 0.5);
    h.assertEqual(pullProgress(PULL_THRESHOLD), 1);
    // Past the threshold it must stay pinned at 1 rather than exceeding it, or
    // the ring would over-rotate.
    h.assertEqual(pullProgress(PULL_MAX), 1);
    h.assertEqual(pullProgress(-10), 0);
  });

  await h.test("arms exactly at the threshold", () => {
    h.assertEqual(isArmed(PULL_THRESHOLD - 1), false);
    h.assertEqual(isArmed(PULL_THRESHOLD), true);
  });

  /* ── phaseFor: single source of truth for the indicator ─────────────────── */

  await h.test("reports refreshing ahead of any drag distance", () => {
    // A refresh in flight is the current truth even if the indicator still holds
    // its drag distance; otherwise the label would flip back to "Pull".
    h.assertEqual(phaseFor(0, true), "refreshing");
    h.assertEqual(phaseFor(PULL_MAX, true), "refreshing");
  });

  await h.test("walks idle -> pulling -> armed with distance", () => {
    h.assertEqual(phaseFor(0, false), "idle");
    h.assertEqual(phaseFor(10, false), "pulling");
    h.assertEqual(phaseFor(PULL_THRESHOLD, false), "armed");
    h.assertEqual(phaseFor(PULL_MAX, false), "armed");
  });

  await h.test("labels each phase and keeps idle label empty", () => {
    h.assertEqual(pullLabel("idle"), "");
    h.assertEqual(pullLabel("pulling"), "Pull to refresh");
    h.assertEqual(pullLabel("armed"), "Release to refresh");
    h.assertEqual(pullLabel("refreshing"), "Refreshing…");
  });

  /* ── the abandonment case, end to end ───────────────────────────────────── */

  await h.test("a gesture abandoned mid-drag never arms", () => {
    /*
     * The sequence this guards: touch starts at the top, tracks past the
     * threshold, then the user scrolls the list down. canStartPull turns false,
     * the component resets distance to 0, and on release there is nothing to
     * fire. Asserting it as a sequence is the point -- each individual call is
     * correct, and the bug only appears in the ordering.
     */
    let distance = 0;
    let tracking = false;

    // Pull far enough to arm.
    h.assert(
      canStartPull({ scrollTop: 0, scrollLeft: 0, touches: 1, refreshing: false }),
      "pull should be allowed at the top"
    );
    tracking = true;
    distance = resistPull(90);
    h.assertEqual(isArmed(distance), true);

    // Now the list scrolls away mid-gesture.
    const stillEligible = canStartPull({
      scrollTop: 120,
      scrollLeft: 0,
      touches: 1,
      refreshing: false,
    });
    h.assertEqual(stillEligible, false);

    // The component resets, so the release sees nothing to refresh.
    if (!stillEligible) {
      distance = 0;
      tracking = false;
    }
    h.assertEqual(tracking, false);
    h.assertEqual(isArmed(distance), false);
    h.assertEqual(phaseFor(distance, false), "idle");
  });

  h.summary();
})();
