/*
 * Tests for the stale-itinerary cue.
 *
 * Why this is worth testing rather than eyeballing: the whole point of the cue
 * is to stop the app from silently presenting a cached departure time as
 * current. A bug here reintroduces exactly the failure it exists to prevent,
 * and it would only ever appear offline — the hardest state to check by hand
 * and the one a traveller is actually in when it matters.
 *
 * Two halves are covered: the pure age arithmetic (staleCue.ts) and the
 * service-worker reply that supplies the timestamp (GET_TRIP_STAMP), because
 * a correct formatter fed a broken timestamp still shows nothing.
 */

const h = require("./harness.cjs");

const { describeSavedAt } = h.loadModule("src/lib/staleCue.ts");

/** Build a fixed "now" so the assertions do not depend on wall-clock time. */
const NOW = new Date("2026-09-22T12:00:00.000Z");

/** An ISO stamp that many minutes before NOW. */
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

async function run() {
  /* -- the honest cases: how old is this copy? --------------------------- */

  await h.test("a fresh copy reads as 'just now'", () => {
    const r = describeSavedAt(ago(0), NOW);
    h.assertEqual(r.short, "just now");
    h.assertEqual(r.isStale, false);
  });

  await h.test("minutes, hours and days each pick their own unit", () => {
    h.assertEqual(describeSavedAt(ago(20), NOW).short, "20 min");
    h.assertEqual(describeSavedAt(ago(3 * 60), NOW).short, "3 hr");
    h.assertEqual(describeSavedAt(ago(26 * 60), NOW).short, "1 day");
    h.assertEqual(describeSavedAt(ago(72 * 60), NOW).short, "3 days");
  });

  await h.test("sub-minute ages are 'just now', not '0 min'", () => {
    /*
     * Clocks are not synchronised. A copy saved 30 seconds ago on a device
     * whose clock is a minute slow would otherwise render as saved in the
     * future, or as a confusing "0 min". Either reads as a bug to the user.
     */
    h.assertEqual(describeSavedAt(ago(0.5), NOW).short, "just now");
    h.assertEqual(describeSavedAt(ago(0.9), NOW).short, "just now");
  });

  /* -- the threshold: when should we actually warn? ---------------------- */

  await h.test("stale flips only past six hours", () => {
    /*
     * The threshold is the difference between a useful warning and noise. Too
     * short and every offline glance cries wolf, so the user learns to ignore
     * it — which is worse than not having it. Too long and yesterday's flight
     * time passes as current.
     */
    h.assertEqual(describeSavedAt(ago(359), NOW).isStale, false);
    h.assertEqual(describeSavedAt(ago(361), NOW).isStale, true);
    h.assertEqual(describeSavedAt(ago(24 * 60), NOW).isStale, true);
  });

  await h.test("the full string names the day, so it survives midnight", () => {
    /*
     * "saved 3:40 PM" is ambiguous the moment the day rolls over, which is
     * precisely the case that matters — a copy from yesterday afternoon. The
     * title carries the date for that reason.
     */
    const r = describeSavedAt(ago(26 * 60), NOW);
    h.assert(r.full.includes("Saved"), "full should say when it was saved");
    h.assert(r.full.includes("1 day ago"), "full should include the age");
  });

  /* -- hostile input: never render nonsense ------------------------------ */

  await h.test("no stamp renders nothing rather than 'Invalid Date'", () => {
    /*
     * A trip never opened online has no stamp. That is a normal state, so the
     * caller must get null and render nothing — not a placeholder that implies
     * the copy is current, and not a literal "Invalid Date".
     */
    h.assertEqual(describeSavedAt(null, NOW), null);
    h.assertEqual(describeSavedAt(undefined, NOW), null);
    h.assertEqual(describeSavedAt("", NOW), null);
    h.assertEqual(describeSavedAt("not a date", NOW), null);
  });

  await h.test("a future stamp is treated as current, not as negative age", () => {
    /*
     * Reachable in practice: the stamp is written on one device and read on
     * another, and a device whose clock is behind will see a future time.
     * "Saved -3 hr ago" would be alarming and unfixable by the user, and it is
     * not evidence of anything they need to act on.
     *
     * Asserts on `full`, not on `short`/`isStale`. Formatting alone already
     * floors a negative age through the `minutes < 1` branch and yields "just
     * now", so those two fields pass with or without the guard and would not
     * catch its removal — verified by reverting the guard and watching this
     * test stay green. `full` is the field the guard actually protects: without
     * it the string reads "Saved Sep 22, 11:00 AM — just now ago", which is the
     * nonsense the guard exists to prevent.
     */
    const r = describeSavedAt(ago(-180), NOW);
    h.assertEqual(r.isStale, false);
    h.assertEqual(r.short, "just now");
    h.assert(!r.full.includes("just now ago"), `full must not self-contradict: ${r.full}`);
    h.assert(!r.full.includes("-"), `full must not show a negative age: ${r.full}`);
    h.assert(r.full.includes("Saved"), `full should still say when it was saved: ${r.full}`);
  });
}

(async function main() {
  await run();
  h.summary();
})();
