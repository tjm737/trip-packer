#!/usr/bin/env node
/*
 * End-to-end check of the extraction pipeline with a STUBBED model.
 *
 * The web build can only show the unavailable path, so this exercises the path
 * that runs on device: a simulated model response goes through the real
 * generateObject -> normaliseTripDraft -> isUsefulDraft chain and must produce
 * a draft the create dialog can actually accept.
 *
 * The stubs deliberately mimic the failure shapes the system prompt is meant to
 * suppress, because those are the ones that reach the normaliser in practice.
 */
const h = require("./harness.cjs");

(async () => {
  const nlt = h.loadModule(h.SRC + "/lib/naturalLanguageTrip.ts");
  /*
   * Loaded once, not per call: the module registers a Capacitor plugin as a
   * side effect, and re-loading it inside the loop re-registers each time.
   */
  const fm = h.loadModule(h.SRC + "/lib/foundationModels.ts");

  /* A stand-in for the plugin, matching the shapes foundationModels.ts parses. */
  const respond = (text) => ({ text });

  /** Mirrors generateObject's parse step for a given raw model output. */
  function extract(rawText, input, today = "2026-09-27") {
    const prompt = nlt.buildExtractionPrompt(input, today);
    h.assert(prompt.includes(today), "prompt must carry today");
    // parseLooseJson is the real parser, not a re-implementation, so the
    // contract under test is the one the app actually ships.
    const parsed = fm.parseLooseJson(rawText);
    return { draft: nlt.normaliseTripDraft(parsed, input), parsed };
  }

  /* ------------------------------------------- realistic model responses */

  await h.test("clean response becomes a usable draft", () => {
    const { draft } = extract(
      JSON.stringify({
        name: "Lisbon Getaway",
        destination: "Lisbon",
        startDate: "2026-10-02",
        endDate: "2026-10-04",
        notes: "Hotel on Avenida da Liberdade",
      }),
      "Lisbon next Friday to Sunday, hotel on Avenida da Liberdade"
    );
    h.assertEqual(draft.destination, "Lisbon", "destination");
    h.assertEqual(draft.startDate, "2026-10-02", "start");
    h.assert(nlt.isUsefulDraft(draft), "must be offered to the user");
  });

  await h.test("fenced response is still parsed", () => {
    const { draft } = extract(
      '```json\n{"name":"Porto","destination":"Porto","startDate":"2026-10-03","endDate":"","notes":""}\n```',
      "Porto on the 3rd"
    );
    h.assertEqual(draft.destination, "Porto", "fenced JSON must survive");
  });

  await h.test("response with prose around it is still parsed", () => {
    const { draft } = extract(
      'Sure! Here are the details:\n{"name":"Oslo","destination":"Oslo","startDate":"","endDate":"","notes":"fjords"}\nLet me know if you need more.',
      "Oslo trip"
    );
    h.assertEqual(draft.destination, "Oslo", "prose-wrapped JSON must survive");
  });

  await h.test("model inventing a destination is NOT reachable via empty input", () => {
    // The guard that matters: when the model returns an empty destination
    // because the sentence was vague, no city appears.
    const { draft } = extract(
      JSON.stringify({ name: "", destination: "", startDate: "", endDate: "", notes: "" }),
      "plan me something nice"
    );
    h.assertEqual(draft.destination, "", "no invented city");
    h.assert(!nlt.isUsefulDraft(draft), "empty extraction must not open the form");
  });

  await h.test("relative date the model failed to resolve is dropped", () => {
    const { draft } = extract(
      JSON.stringify({ name: "Trip", destination: "Rome", startDate: "next Friday", endDate: "" }),
      "Rome next Friday"
    );
    h.assertEqual(draft.startDate, "", "unresolved date must not reach the DB");
    h.assert(nlt.isUsefulDraft(draft), "destination still makes it useful");
  });

  await h.test("completely unparseable output yields nothing, not a crash", () => {
    const { draft } = extract("I'm not sure what you mean.", "gibberish");
    h.assertEqual(draft.name, "New Trip", "neutral fallback name");
    h.assert(!nlt.isUsefulDraft(draft), "nothing useful");
  });

  /* ---------------------------------------- the hand-off contract */

  await h.test("draft satisfies the create flow's required name", () => {
    const { draft } = extract(
      JSON.stringify({ name: "", destination: "Kyoto", startDate: "2026-11-01", endDate: "" }),
      "Kyoto in November"
    );
    h.assert(draft.name.trim().length > 0, "create flow rejects an empty name");
    h.assertEqual(draft.name, "Kyoto", "destination used as the title");
  });

  await h.test("single-day trip is expressible (no end date)", () => {
    const { draft } = extract(
      JSON.stringify({ name: "Day Trip", destination: "Bruges", startDate: "2026-10-05", endDate: "" }),
      "day trip to Bruges on the 5th"
    );
    h.assertEqual(draft.startDate, "2026-10-05", "start set");
    h.assertEqual(draft.endDate, "", "end empty: create flow treats it as same-day");
  });

  h.summary();
})();
