#!/usr/bin/env node
/*
 * Natural-language trip entry: prompt building, response normalisation, and
 * the date handling that keeps a malformed value out of SQLite.
 *
 * The model call is not exercised -- there is no on-device model in CI. What is
 * exercised is everything that has actually been observed to break: a model
 * that invents a destination, a "date" that is not a date, a reversed range,
 * and a response wrapped in prose.
 */
const h = require("./harness.cjs");

(async () => {
  const {
    buildExtractionPrompt,
    normaliseTripDraft,
    isIsoDate,
    inferIcon,
    isUsefulDraft,
    TRIP_FIELDS,
  } = h.loadModule(h.SRC + "/lib/naturalLanguageTrip.ts");

  /* ------------------------------------------------------------- prompt */

  await h.test("prompt carries today's date so relative dates can resolve", () => {
    const p = buildExtractionPrompt("Lisbon next Friday", "2026-09-27");
    h.assert(
      p.includes("2026-09-27"),
      "the model has no clock; today's date must be in the prompt"
    );
  });

  await h.test("prompt includes the user's message verbatim", () => {
    const msg = "Weekend in Porto, 3rd to 6th October";
    const p = buildExtractionPrompt(msg, "2026-09-27");
    h.assert(p.includes(msg), "message must reach the model unaltered");
  });

  await h.test("prompt forbids inventing a destination", () => {
    const p = buildExtractionPrompt("some trip", "2026-09-27");
    h.assert(
      /do NOT guess a destination/i.test(p),
      "a fabricated city is the worst failure mode; the guard must be explicit"
    );
    h.assert(
      /never invent a value/i.test(p),
      "the empty-string rule must be stated for every field"
    );
  });

  await h.test("prompt names every field the flow needs", () => {
    const p = buildExtractionPrompt("x", "2026-09-27");
    for (const f of TRIP_FIELDS) {
      h.assert(p.includes(f), `prompt must specify the '${f}' key`);
    }
  });

  /* --------------------------------------------------------- date checks */

  await h.test("isIsoDate accepts real dates", () => {
    h.assert(isIsoDate("2026-10-03"), "plain valid date");
    h.assert(isIsoDate("2028-02-29"), "leap day in a leap year");
  });

  await h.test("isIsoDate rejects shapes that only look like dates", () => {
    // The regex alone would pass the first three of these.
    h.assert(!isIsoDate("2026-02-31"), "31 February is not a date");
    h.assert(!isIsoDate("2026-13-01"), "month 13 is not a date");
    h.assert(!isIsoDate("2026-00-10"), "month 0 is not a date");
    h.assert(!isIsoDate("03/10/2026"), "non-ISO format");
    h.assert(!isIsoDate("2026-10-3"), "unpadded day");
    h.assert(!isIsoDate(""), "empty");
    h.assert(!isIsoDate("next Friday"), "unresolved relative date");
  });

  /* ------------------------------------------------------- normalisation */

  await h.test("normalise passes through a clean model response", () => {
    const d = normaliseTripDraft(
      {
        name: "Lisbon Getaway",
        destination: "Lisbon",
        startDate: "2026-10-03",
        endDate: "2026-10-06",
        notes: "Hotel on Avenida da Liberdade",
      },
      "Lisbon in October"
    );
    h.assertEqual(d.destination, "Lisbon", "destination");
    h.assertEqual(d.startDate, "2026-10-03", "start");
    h.assertEqual(d.endDate, "2026-10-06", "end");
    h.assertEqual(d.name, "Lisbon Getaway", "name");
  });

  await h.test("normalise drops a malformed date rather than persisting it", () => {
    const d = normaliseTripDraft(
      { destination: "Porto", startDate: "2026-02-31", endDate: "soon" },
      "Porto sometime"
    );
    h.assertEqual(d.startDate, "", "invalid start must be dropped");
    h.assertEqual(d.endDate, "", "unresolved end must be dropped");
  });

  await h.test("normalise discards a backwards date range", () => {
    const d = normaliseTripDraft(
      {
        destination: "Rome",
        startDate: "2026-10-10",
        endDate: "2026-10-02",
      },
      "Rome in October"
    );
    h.assertEqual(d.startDate, "2026-10-10", "start kept");
    h.assertEqual(d.endDate, "", "end before start is not a trip");
  });

  await h.test("normalise tolerates a non-object response", () => {
    h.assertEqual(
      normaliseTripDraft(null, "Lisbon").destination,
      "",
      "null must not throw"
    );
    h.assertEqual(
      normaliseTripDraft("not json", "Lisbon").destination,
      "",
      "string must not throw"
    );
  });

  await h.test("normalise collapses whitespace the model added", () => {
    const d = normaliseTripDraft(
      { destination: "  New   York ", name: " NYC\n\tTrip " },
      "New York"
    );
    h.assertEqual(d.destination, "New York", "destination tidied");
    h.assertEqual(d.name, "NYC Trip", "name tidied");
  });

  await h.test("normalise falls back to destination when name is empty", () => {
    const d = normaliseTripDraft(
      { name: "", destination: "Oslo" },
      "trip to Oslo"
    );
    h.assertEqual(
      d.name,
      "Oslo",
      "a destination is a better title than an empty box"
    );
  });

  await h.test("normalise falls back to a neutral name when nothing is given", () => {
    const d = normaliseTripDraft({}, "no idea where");
    h.assertEqual(d.name, "New Trip", "placeholder name");
    h.assertEqual(d.destination, "", "no invented destination");
  });

  /*
   * The critical guarantee: whatever the model returns, a destination only
   * survives if it was a non-empty string. This is what stands between a
   * fabricated city and a saved trip.
   */
  await h.test("normalise never fabricates a destination", () => {
    for (const bad of [undefined, null, "", "   ", 42, {}, []]) {
      const d = normaliseTripDraft({ destination: bad }, "vague message");
      h.assertEqual(d.destination, "", `destination must be empty for ${JSON.stringify(bad)}`);
    }
  });

  /* --------------------------------------------------------------- icon */

  await h.test("inferIcon maps clear signals and stays silent otherwise", () => {
    h.assertEqual(inferIcon("beach holiday in Bali"), "🏖️", "beach");
    h.assertEqual(inferIcon("ski trip to the Alps"), "⛷️", "ski");
    h.assertEqual(inferIcon("hiking in the Dolomites"), "⛰️", "hike");
    h.assertEqual(inferIcon("work conference in Berlin"), "💼", "work");
    h.assertEqual(inferIcon("going to Lisbon"), "", "no signal -> no icon");
  });

  /* ------------------------------------------------------------ usefulness */

  await h.test("isUsefulDraft requires the sentence to have said something", () => {
    const base = { name: "x", destination: "", startDate: "", endDate: "", notes: "", icon: "" };
    h.assert(!isUsefulDraft(base), "nothing extracted is not useful");
    h.assert(
      isUsefulDraft({ ...base, destination: "Lisbon" }),
      "a destination is enough"
    );
    h.assert(
      isUsefulDraft({ ...base, startDate: "2026-10-03" }),
      "a date alone is enough"
    );
    // A name alone is NOT enough: it is the field we invent when nothing else
    // was found, so it would make every empty extraction look successful.
    h.assert(
      !isUsefulDraft({ ...base, name: "New Trip" }),
      "a defaulted name must not count as useful"
    );
  });

  h.summary();
})();
