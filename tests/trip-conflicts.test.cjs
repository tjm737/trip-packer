#!/usr/bin/env node
/*
 * Trip conflict checking: the guarantees that must hold regardless of what the
 * on-device model returns.
 *
 * Why these tests look like this
 * ------------------------------
 * The model is non-deterministic and cannot be called from a test, so none of
 * this exercises the model. It exercises the CONTRACT AROUND the model -- the
 * prompt it is given and the filtering applied to what comes back. That is
 * where the correctness lives: a bug here is invisible in manual testing
 * because the model still answers, and only shows up as a confidently wrong
 * claim about someone's trip.
 *
 * Each normalisation test is written to fail if its guard is deleted. Passing
 * both before and after a change would make it documentation, not a test.
 */

const assert = require("node:assert");
const path = require("node:path");
const h = require("./harness.cjs");
const { test, loadModule } = h;

const mod = loadModule(path.join(h.SRC, "lib", "tripConflicts.ts"));

// A minimal reservation. Only the fields the checker reads.
function res(over) {
  return Object.assign(
    {
      id: "r1",
      tripId: "t1",
      type: "activity",
      title: "Something",
      confirmation: "",
      location: "",
      locationTo: "",
      startDate: "2026-10-14",
      startTime: "",
      endDate: "",
      endTime: "",
      cost: "",
      notes: "",
      order: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      confirmed: true,
    },
    over
  );
}

const trip = { id: "t1", name: "Lisbon Getaway", userId: "u1" };

// ---------------------------------------------------------------------------
// weekday / date helpers
// ---------------------------------------------------------------------------

/*
 * The suite is awaited inside this IIFE: test() returns a promise, and
 * calling summary() at module top level would run before anything settled --
 * printing "0 passed, 0 failed" and exiting 0 even when tests fail.
 */
(async () => {
  await test("weekdayOf returns the correct day name", () => {
    // 2026-10-14 really is a Wednesday; anchor against known dates rather than
    // recomputing with the same logic under test.
    assert.strictEqual(mod.weekdayOf("2026-10-14"), "Wednesday");
    assert.strictEqual(mod.weekdayOf("2026-10-17"), "Saturday");
    assert.strictEqual(mod.weekdayOf("2026-10-18"), "Sunday");
    assert.strictEqual(mod.weekdayOf("2026-01-01"), "Thursday");
  });

  await test("weekdayOf is empty for non-dates rather than throwing", () => {
    assert.strictEqual(mod.weekdayOf(""), "");
    assert.strictEqual(mod.weekdayOf("next friday"), "");
    assert.strictEqual(mod.weekdayOf("2026-13-45"), "");
  });

  await test("isRealDate rejects regex-shaped non-dates", () => {
    assert.strictEqual(mod.isRealDate("2026-02-31"), false);
    assert.strictEqual(mod.isRealDate("2026-10-14"), true);
    assert.strictEqual(mod.isRealDate("2026-10-1"), false);
  });

  // ---------------------------------------------------------------------------
  // digest building
  // ---------------------------------------------------------------------------

  await test("digest carries the weekday beside every date", () => {
    const inputs = mod.buildConflictInputs([res({ id: "r1", startDate: "2026-10-14" })]);
    const digest = mod.formatConflictDigest(inputs);
    // The model must not have to derive the weekday; it is supplied.
    assert.ok(digest.includes("2026-10-14 (Wednesday)"), digest);
  });

  await test("digest omits a repeated end date", () => {
    const inputs = mod.buildConflictInputs([
      res({ id: "r1", startDate: "2026-10-14", endDate: "2026-10-14" }),
    ]);
    const digest = mod.formatConflictDigest(inputs);
    const count = (digest.match(/2026-10-14/g) || []).length;
    assert.strictEqual(count, 1, digest);
  });

  await test("digest marks unconfirmed reservations", () => {
    const inputs = mod.buildConflictInputs([res({ id: "r9", confirmed: false })]);
    assert.ok(mod.formatConflictDigest(inputs).includes("[NOT CONFIRMED]"));
  });

  await test("digest is empty-safe", () => {
    assert.strictEqual(mod.formatConflictDigest([]), "(no reservations)");
  });

  await test("inputs are ordered chronologically with undated last", () => {
    const inputs = mod.buildConflictInputs([
      res({ id: "undated", startDate: "" }),
      res({ id: "late", startDate: "2026-10-20" }),
      res({ id: "early", startDate: "2026-10-14" }),
    ]);
    assert.deepStrictEqual(
      inputs.map((r) => r.id),
      ["early", "late", "undated"]
    );
  });

  await test("ordering is stable for identical dates", () => {
    const a = mod.buildConflictInputs([
      res({ id: "b", startDate: "2026-10-14" }),
      res({ id: "a", startDate: "2026-10-14" }),
    ]);
    const b = mod.buildConflictInputs([
      res({ id: "a", startDate: "2026-10-14" }),
      res({ id: "b", startDate: "2026-10-14" }),
    ]);
    // Same trip must give the same prompt, or input-order sensitivity reads as
    // inconsistent advice.
    assert.deepStrictEqual(a.map((r) => r.id), b.map((r) => r.id));
  });

  await test("free text is clipped before it reaches the prompt", () => {
    const inputs = mod.buildConflictInputs([res({ title: "x".repeat(500), location: "y".repeat(300) })]);
    assert.ok(inputs[0].title.length <= 80, `title was ${inputs[0].title.length}`);
    assert.ok(inputs[0].location.length <= 60, `location was ${inputs[0].location.length}`);
  });

  // ---------------------------------------------------------------------------
  // prompt contract
  // ---------------------------------------------------------------------------

  await test("prompt states the reservation count so 'none' is a legal answer", () => {
    const p = mod.buildConflictPrompt("Lisbon", "digest", 3);
    assert.ok(p.includes("3 reservations"), p);
    assert.ok(/empty array/.test(p), p);
  });

  await test("prompt requires an id citation on every conflict", () => {
    const p = mod.buildConflictPrompt("Lisbon", "digest", 3);
    assert.ok(/cite at least one id/.test(p), p);
  });

  await test("prompt tells the model not to recalculate dates", () => {
    const p = mod.buildConflictPrompt("Lisbon", "digest", 3);
    assert.ok(/exactly as they appear/.test(p), p);
  });

  // ---------------------------------------------------------------------------
  // normalisation: the guarantees
  // ---------------------------------------------------------------------------

  const INPUTS = mod.buildConflictInputs([
    res({ id: "r1", type: "flight", title: "Arrival LIS", startDate: "2026-10-14", startTime: "09:20" }),
    res({ id: "r2", type: "lodging", title: "Hotel", startDate: "2026-10-15", endDate: "2026-10-18" }),
    res({ id: "r3", type: "activity", title: "Fado show", startDate: "2026-10-14", startTime: "21:00" }),
  ]);

  await test("a well-formed finding survives", () => {
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          {
            severity: "warning",
            title: "Hotel starts after arrival",
            detail: "You land on 2026-10-14 but the hotel starts on 2026-10-15.",
            reservationIds: ["r1", "r2"],
          },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].severity, "warning");
    assert.deepStrictEqual(out[0].reservationIds, ["r1", "r2"]);
  });

  await test("GUARD: a finding citing an unknown id is dropped", () => {
    const out = mod.normaliseConflicts(
      { conflicts: [{ severity: "warning", title: "Ghost", detail: "About 2026-10-14.", reservationIds: ["r99"] }] },
      INPUTS
    );
    assert.strictEqual(out.length, 0, "fabricated reservation id was displayed");
  });

  await test("GUARD: a finding with no citations at all is dropped", () => {
    const out = mod.normaliseConflicts(
      { conflicts: [{ severity: "warning", title: "Vague", detail: "Something is wrong." }] },
      INPUTS
    );
    assert.strictEqual(out.length, 0, "unciteable finding was displayed");
  });

  await test("GUARD: a finding quoting a date absent from its reservations is dropped", () => {
    // The headline failure: both real dates are in October, but the model claims
    // a November hotel. Alarming and false.
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          {
            severity: "warning",
            title: "Hotel gap",
            detail: "You land 2026-10-14 but the hotel starts 2026-11-15.",
            reservationIds: ["r1", "r2"],
          },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out.length, 0, "fabricated date reached the user");
  });

  await test("GUARD: a date that IS among the cited reservations is allowed", () => {
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          {
            severity: "warning",
            title: "Hotel gap",
            detail: "You land 2026-10-14 but the hotel starts 2026-10-15.",
            reservationIds: ["r1", "r2"],
          },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out.length, 1, "a correct date claim was wrongly dropped");
  });

  await test("severity is coerced and never escalates past warning", () => {
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          { severity: "error", title: "Bad", detail: "Really bad.", reservationIds: ["r1"] },
          { severity: "critical", title: "Worse", detail: "Worse still.", reservationIds: ["r1"] },
          { severity: "note", title: "Mild", detail: "Worth a look.", reservationIds: ["r1"] },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out.length, 3);
    assert.ok(out.every((c) => c.severity === "warning" || c.severity === "note"));
    assert.strictEqual(out.filter((c) => c.severity === "warning").length, 2);
    assert.strictEqual(out.filter((c) => c.severity === "note").length, 1);
  });

  await test("warnings are sorted before notes", () => {
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          { severity: "note", title: "Mild", detail: "Worth a look.", reservationIds: ["r1"] },
          { severity: "warning", title: "Bad", detail: "Really bad.", reservationIds: ["r1"] },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out[0].severity, "warning");
  });

  await test("duplicate findings are collapsed", () => {
    const one = { severity: "warning", title: "Overlap", detail: "Two things at once.", reservationIds: ["r1", "r3"] };
    const out = mod.normaliseConflicts({ conflicts: [one, { ...one }] }, INPUTS);
    assert.strictEqual(out.length, 1, "the same conflict was shown twice");
  });

  await test("same title about different reservations is NOT collapsed", () => {
    const out = mod.normaliseConflicts(
      {
        conflicts: [
          { severity: "warning", title: "Overlap", detail: "A problem.", reservationIds: ["r1"] },
          { severity: "warning", title: "Overlap", detail: "A problem.", reservationIds: ["r2"] },
        ],
      },
      INPUTS
    );
    assert.strictEqual(out.length, 2);
  });

  await test("free text in findings is clipped", () => {
    const out = mod.normaliseConflicts(
      { conflicts: [{ severity: "warning", title: "T".repeat(400), detail: "D".repeat(2000), reservationIds: ["r1"] }] },
      INPUTS
    );
    assert.ok(out[0].title.length <= 90, `title ${out[0].title.length}`);
    assert.ok(out[0].detail.length <= 400, `detail ${out[0].detail.length}`);
  });

  await test("garbage input yields no findings rather than throwing", () => {
    for (const bad of [null, undefined, 42, "string", [], { conflicts: "nope" }, { conflicts: [null, 7, "x"] }]) {
      assert.deepStrictEqual(mod.normaliseConflicts(bad, INPUTS), []);
    }
  });

  // ---------------------------------------------------------------------------
  // orchestration
  // ---------------------------------------------------------------------------

  await test("a trip with no reservations never calls the model", async () => {
    let called = false;
    const { findings } = mod.checkTripConflicts(trip, [], async () => {
      called = true;
      return { conflicts: [] };
    });
    assert.deepStrictEqual(await findings, []);
    assert.strictEqual(called, false, "model was prompted about an empty trip, which invites invented conflicts");
  });

  await test("a model failure resolves to no findings, not a rejection", async () => {
    const { findings } = mod.checkTripConflicts(trip, [res({ tripId: "t1" })], async () => {
      throw new Error("bridge exploded");
    });
    assert.deepStrictEqual(await findings, []);
  });

  await test("checkTripConflicts scopes to the trip's own reservations", async () => {
    const mine = res({ id: "r1", tripId: "t1" });
    const theirs = res({ id: "other", tripId: "t2" });
    const { inputs } = mod.checkTripConflicts(trip, [mine, theirs], async () => ({ conflicts: [] }));
    assert.deepStrictEqual(inputs.map((r) => r.id), ["r1"]);
  });

  /*
   * Control state.
   *
   * The rule that matters: a trip with fewer than two bookings is not
   * reviewable, so the control is disabled with a reason rather than offered
   * and guaranteed to find nothing.
   */
  await test("control is disabled with a reason when there is nothing to compare", () => {
    const zero = mod.conflictControlState(true, false, false, 0);
    assert.strictEqual(zero.enabled, false);
    assert.ok(zero.hint.length > 0, "no explanation for a disabled control");

    const one = mod.conflictControlState(true, false, false, 1);
    assert.strictEqual(one.enabled, false);
    assert.ok(one.hint.length > 0);
    // The two cases say different things, because the user's next action differs.
    assert.notStrictEqual(zero.hint, one.hint);
  });

  await test("control is disabled on an unsupported device, with its own reason", () => {
    const s = mod.conflictControlState(false, false, false, 5);
    assert.strictEqual(s.enabled, false);
    assert.ok(/Intelligence/.test(s.hint), s.hint);
  });

  await test("the plugin's own message is preferred over our fallback", () => {
    const own = "Turn on Apple Intelligence in Settings to check for conflicts.";
    const s = mod.conflictControlState(false, false, false, 5, { message: own });
    assert.strictEqual(s.hint, own);

    // An empty plugin message must fall back rather than render a blank hint.
    const blank = mod.conflictControlState(false, false, false, 5, { message: "" });
    assert.ok(blank.hint.length > 0);
  });

  await test("control is enabled and relabels once it has run", () => {
    const first = mod.conflictControlState(true, false, false, 5);
    assert.strictEqual(first.enabled, true);
    assert.strictEqual(first.label, "Check for conflicts");
    assert.strictEqual(first.hint, "");

    const again = mod.conflictControlState(true, false, true, 5);
    assert.strictEqual(again.label, "Check again");
  });

  await test("control is disabled while running", () => {
    const s = mod.conflictControlState(true, true, false, 5);
    assert.strictEqual(s.enabled, false);
    assert.strictEqual(s.label, "Checking…");
  });

  /*
   * View state. null and [] must not collapse: one is "not asked yet", the
   * other is "checked and clean". Showing "no conflicts" before a check has run
   * is false reassurance.
   */
  await test("view state distinguishes never-run from clean", () => {
    assert.strictEqual(mod.conflictsViewState(null), "idle");
    assert.strictEqual(mod.conflictsViewState([]), "clean");
    assert.notStrictEqual(mod.conflictsViewState(null), mod.conflictsViewState([]));
  });

  await test("view state is a list when there are findings", () => {
    const findings = mod.normaliseConflicts(
      { conflicts: [{ severity: "warning", title: "X", detail: "Y.", reservationIds: ["r1"] }] },
      INPUTS
    );
    assert.strictEqual(mod.conflictsViewState(findings), "list");
  });

  /*
   * summary() sets process.exitCode itself when a test failed, so it is called
   * for that side effect and for the report. It returns undefined, and so must
   * not be ternaried against -- doing so forces exit 1 on a fully green run and
   * makes a passing suite look broken to the runner.
   */
  h.summary();
})();
