/*
 * Tests for the WIRING half of packing suggestions.
 *
 * Why a second file: packing-suggestions.test.cjs covers the pure prompt and
 * normalising logic, but the decisions the COMPONENT makes with those results
 * -- when the button is live, which rows render as addable, what payload gets
 * written, what survives a failure -- lived inline in PackingSuggestions.tsx.
 * This repo has no DOM or React test runner, so none of it was exercised: the
 * click-to-add path had been written and never run even once.
 *
 * Those decisions are now pure functions in src/lib/packingSuggestions.ts and
 * are tested here against the real source module. Nothing is re-implemented in
 * the test; the functions under test are the ones the component calls.
 *
 * The contract every case below protects: the feature PRODUCES candidates and
 * the user's click WRITES them. A bug that flips either half -- offering a
 * dead row, writing a padded duplicate name, or adding without a click -- is
 * what these assertions exist to catch.
 */

const h = require("./harness.cjs");

const {
  addPayload,
  addableRowCount,
  buildSuggestionRows,
  generateControlState,
  suggestionsAfterAdd,
  suggestionsFromResponse,
  suggestionsViewState,
  unavailableHint,
} = h.loadModule("src/lib/packingSuggestions.ts");

const CATEGORY = "Suggested";
const ICON = "✨";

/** A report shaped like the one the bridge resolves to. */
const report = (available, reason = "available", message = "") => ({
  available,
  reason,
  message,
});

/** Build rows the way the component does, with a stubbed live-list lookup. */
function rowsFor(suggestions, onList = [], adding = []) {
  const onListSet = new Set(onList);
  return buildSuggestionRows(
    suggestions,
    (name) => onListSet.has(name),
    new Set(adding),
    "trip-1",
    CATEGORY,
    ICON
  );
}

(async () => {
  /* -- the generate control: dead unless the model is really there --------- */

  await h.test("the button is dead until an availability report actually says yes", async () => {
    /*
     * The dangerous direction is a false positive. If a missing report ever
     * enabled the button, the click would call the native model on a platform
     * that has none -- the exact call this feature's availability check exists
     * to avoid. So null must be disabled, not "probably fine".
     */
    const beforeCheck = generateControlState(null, false, false);
    h.assertEqual(beforeCheck.enabled, false, "no report yet must not enable the control");

    h.assertEqual(
      generateControlState(report(false, "os_too_old", "Old iOS"), false, false).enabled,
      false,
      "an unavailable report must keep the control dead"
    );
    h.assertEqual(
      generateControlState(report(true), false, false).enabled,
      true,
      "an available report enables the control"
    );
  });

  await h.test("the button is dead while a generation is already running", async () => {
    // Otherwise a second click starts a second native generation and the two
    // responses race to set state.
    h.assertEqual(generateControlState(report(true), true, false).enabled, false);
  });

  await h.test("the label walks idle -> thinking -> suggest again", async () => {
    h.assertEqual(generateControlState(report(true), false, false).label, "Suggest items");
    h.assertEqual(generateControlState(report(true), true, false).label, "Thinking…");
    h.assertEqual(generateControlState(report(true), false, true).label, "Suggest again");
  });

  await h.test("a failed attempt still counts as an attempt", async () => {
    /*
     * The label reflects that the user pressed the button, not that anything
     * useful came back. Reverting to "Suggest items" after a press that found
     * nothing usable reads as if the press had been dropped -- and the empty
     * message below it would look like it belonged to a button never pressed.
     */
    h.assertEqual(generateControlState(report(true), false, true).label, "Suggest again");
  });

  await h.test("the spinner flag is reported even when the control is disabled", async () => {
    const s = generateControlState(report(true), true, false);
    h.assertEqual(s.generating, true, "the button must be able to show a spinner");
    h.assertEqual(s.enabled, false);
  });

  /* -- the candidate area's three states ---------------------------------- */

  await h.test("never-generated and generated-but-empty are different states", async () => {
    /*
     * Collapsing these is a real UX bug, not a cosmetic one: "nothing new to
     * suggest" shown before the user has asked would be a lie, and an empty
     * area after a real reply would look like the button did nothing.
     */
    h.assertEqual(suggestionsViewState(null), "idle");
    h.assertEqual(suggestionsViewState([]), "empty");
    h.assertEqual(suggestionsViewState([{ name: "Socks" }]), "list");
  });

  /* -- a raw bridge response becomes rows --------------------------------- */

  await h.test("the bridge's failure value becomes an empty list, not a crash", async () => {
    /*
     * generateObject resolves null for an absent plugin, a thrown native call,
     * and unparseable JSON alike. All three must land on the same "generated,
     * nothing usable" outcome so the component has one branch, not four.
     */
    h.assertEqual(suggestionsFromResponse(null), []);
    h.assertEqual(suggestionsFromResponse(undefined), []);
    h.assertEqual(suggestionsFromResponse("not json"), []);
    h.assertEqual(suggestionsFromResponse({ nonsense: true }), []);
  });

  await h.test("a real response survives the trip through the bridge wrapper", async () => {
    const out = suggestionsFromResponse(
      { items: [{ name: "Rain jacket", reason: "Likely showers" }] },
      []
    );
    h.assertEqual(out.length, 1);
    h.assertEqual(out[0].name, "Rain jacket");
    h.assertEqual(out[0].reason, "Likely showers");
  });

  await h.test("items already on the list are filtered before a row is ever built", async () => {
    const out = suggestionsFromResponse(
      { items: [{ name: "Passport" }, { name: "Adapter" }] },
      ["passport"]
    );
    h.assertEqual(out.map((s) => s.name), ["Adapter"]);
  });

  /* -- rows: what is actionable ------------------------------------------- */

  await h.test("a fresh suggestion yields a row with a full add payload", async () => {
    const rows = rowsFor([{ name: "Sunscreen", reason: "Beach days" }]);
    h.assertEqual(rows.length, 1);
    h.assertEqual(rows[0].name, "Sunscreen");
    h.assertEqual(rows[0].reason, "Beach days");
    h.assertEqual(rows[0].canAdd, true);
    h.assert(rows[0].payload !== null, "an addable row must carry a payload");
    h.assertEqual(rows[0].adding, false);
  });

  await h.test("a suggestion already on the live list gets no payload", async () => {
    /*
     * The list can gain an item between generating and rendering -- another
     * tab, a sync, an earlier click. A row with a payload here would be a live
     * button whose click silently does nothing.
     */
    const rows = rowsFor([{ name: "Parka" }], ["Parka"]);
    h.assertEqual(rows[0].canAdd, false);
    h.assertEqual(rows[0].payload, null);
  });

  await h.test("a blank name is never actionable, even when it is not a duplicate", async () => {
    const rows = rowsFor([{ name: "   " }]);
    h.assertEqual(rows[0].canAdd, false);
    h.assertEqual(rows[0].payload, null);
  });

  await h.test("a row being written shows the in-flight flag and stays put", async () => {
    /*
     * The row must remain in the list while its write is in flight -- removing
     * it on click would collapse the grid and make the "nothing new" message
     * flash before the write even lands.
     */
    const rows = rowsFor([{ name: "Adapter" }], [], ["Adapter"]);
    h.assertEqual(rows.length, 1);
    h.assertEqual(rows[0].adding, true);
  });

  await h.test("the in-flight flag is keyed on the trimmed name", async () => {
    /*
     * The click handler keys its in-flight set on the trimmed name, because
     * that is what gets written. If the row looked itself up by the untrimmed
     * name it would miss, render no spinner, and invite a second click at the
     * same item -- the duplicate this whole feature is built to avoid.
     */
    const rows = rowsFor([{ name: "  Socks  " }], [], ["Socks"]);
    h.assertEqual(rows[0].adding, true, "row must match the in-flight set by trimmed name");
  });

  await h.test("the live list is consulted per row, not against a stale snapshot", async () => {
    /*
     * Each row is resolved independently. If the lookup were applied once and
     * reused, one already-present item would hide the others or vice versa.
     */
    const rows = rowsFor(
      [{ name: "Parka" }, { name: "Socks" }, { name: "Adapter" }],
      ["Socks"]
    );
    h.assertEqual(rows.map((r) => r.canAdd), [true, false, true]);
    h.assertEqual(rows.map((r) => r.payload === null), [false, true, false]);
  });

  /* -- the payload written on click --------------------------------------- */

  await h.test("the payload carries exactly the category and quantity the feature promises", async () => {
    const p = addPayload("trip-9", { name: "Towel" }, CATEGORY, ICON);
    h.assertEqual(p.tripId, "trip-9");
    h.assertEqual(p.categoryName, "Suggested");
    h.assertEqual(p.categoryIcon, "✨");
    h.assertEqual(p.name, "Towel");
    h.assertEqual(p.quantity, 1, "a suggestion adds one item, never a guessed quantity");
  });

  await h.test("the payload trims the name it writes", async () => {
    /*
     * The model pads output with whitespace. Writing " Socks" while the
     * duplicate check and the in-flight set both key on "Socks" would let the
     * same physical item be added twice under two different strings.
     */
    const p = addPayload("trip-9", { name: "  Socks  " }, CATEGORY, ICON);
    h.assertEqual(p.name, "Socks");
  });

  await h.test("every row's payload names the category that was actually asked for", async () => {
    // Guards against a transposed argument putting the icon in the name slot.
    const rows = rowsFor([{ name: "Gloves" }]);
    h.assertEqual(rows[0].payload.categoryName, CATEGORY);
    h.assertEqual(rows[0].payload.categoryIcon, ICON);
    h.assertEqual(rows[0].payload.name, "Gloves");
  });

  /* -- after an add ------------------------------------------------------ */

  await h.test("adding a name drops exactly that row", async () => {
    const before = [{ name: "Parka" }, { name: "Socks" }, { name: "Adapter" }];
    const after = suggestionsAfterAdd(before, "Socks");
    h.assertEqual(after.map((s) => s.name), ["Parka", "Adapter"]);
  });

  await h.test("the dropped row is matched by trimmed name", async () => {
    /*
     * The handler is given the trimmed name (that is what was written). If the
     * filter compared raw strings, a padded " Socks " row would survive its own
     * add and offer a second click that the click-time gate then refuses --
     * which reads as a dead button.
     */
    const after = suggestionsAfterAdd([{ name: "  Socks  " }, { name: "Adapter" }], "Socks");
    h.assertEqual(after.map((s) => s.name), ["Adapter"]);
  });

  await h.test("an untouched list is left as a list, not turned into idle", async () => {
    /*
     * null means "never generated" and drives a different message. An add must
     * not be able to push the component back to idle; only a fresh generate
     * sets the list, and it only ever sets an array.
     */
    h.assertEqual(suggestionsAfterAdd(null, "Socks"), null);
    h.assertEqual(suggestionsAfterAdd([], "Socks"), []);
  });

  await h.test("adding the last candidate leaves an empty list, not null", async () => {
    h.assertEqual(suggestionsAfterAdd([{ name: "Socks" }], "Socks"), []);
  });

  /* -- the rendered area collapses when nothing is actionable ------------- */

  await h.test("the suggestion area is offered only while a live add remains", async () => {
    /*
     * This is the decision that stopped a header sitting above an empty grid.
     * A row that is already on the list, or mid-add, is not a thing the user
     * can act on, so none of them may keep the area on screen.
     */
    h.assertEqual(addableRowCount(rowsFor([])), 0, "no rows, nothing to offer");
    h.assertEqual(addableRowCount(rowsFor([{ name: "Socks" }])), 1);
    h.assertEqual(
      addableRowCount(rowsFor([{ name: "Socks" }], ["Socks"])),
      0,
      "an already-added row is not actionable"
    );
    h.assertEqual(
      addableRowCount(rowsFor([{ name: "Socks" }], [], ["Socks"])),
      0,
      "a row mid-write is not actionable"
    );
    h.assertEqual(
      addableRowCount(rowsFor([{ name: "Socks" }, { name: "Parka" }], ["Socks"])),
      1,
      "other rows keep the area alive"
    );
  });

  await h.test("blank rows cannot keep the area alive on their own", async () => {
    h.assertEqual(addableRowCount(rowsFor([{ name: "  " }])), 0);
  });

  /* -- the reason the control is dead ------------------------------------ */

  await h.test("each unavailable reason explains itself in words", async () => {
    /*
     * This is the copy a user reads at the exact moment the button refuses to
     * work. A branch returning "" here leaves a dead control with no
     * explanation anywhere on screen.
     */
    h.assertEqual(
      unavailableHint(report(false, "os_too_old", "")),
      "Packing suggestions need a newer version of iOS."
    );
    h.assertEqual(
      unavailableHint(report(false, "device_not_eligible", "")),
      "This device doesn't support on-device Apple Intelligence."
    );
    h.assertEqual(
      unavailableHint(report(false, "not_enabled", "")),
      "Turn on Apple Intelligence in Settings to use packing suggestions."
    );
    h.assertEqual(
      unavailableHint(report(false, "model_not_ready", "")),
      "The on-device model is still getting ready — try again shortly."
    );
    h.assertEqual(
      unavailableHint(report(false, "something_new", "")),
      "On-device suggestions aren't available right now.",
      "an unknown reason must still say something"
    );
  });

  await h.test("the plugin's own message wins over the fallback wording", async () => {
    /*
     * The native side knows the device's actual state; the switch is only the
     * fallback for reasons that arrive with an empty message. Preferring the
     * local string would make this copy drift from the plugin's.
     */
    h.assertEqual(
      unavailableHint(report(false, "os_too_old", "Update to iOS 26 to use this.")),
      "Update to iOS 26 to use this."
    );
  });

  await h.test("no hint is shown before the check resolves or when it succeeds", async () => {
    // "Checking device support…" is the not-yet state; available yields "" so
    // the inline note can test `!available` and render nothing.
    h.assertEqual(unavailableHint(null), "Checking device support…");
    h.assertEqual(unavailableHint(report(true, "available", "Ready.")), "");
  });

  h.summary();
})();
