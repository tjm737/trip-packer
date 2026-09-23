/*
 * Tests for activity-aware packing suggestions.
 *
 * The feature under test: the on-device model should be told what the trip
 * actually involves -- a booked dinner, a hike, a spa day -- so it can suggest
 * a formal outfit for the dinner rather than only climate-appropriate clothes.
 * Before this, the prompt carried destination/length/month and an explicit
 * "Do not invent activities" guard, so a restaurant reservation contributed
 * nothing.
 *
 * The cases that matter are the context-window ones. The on-device model has a
 * small window, and the existing-item list is already capped for that reason.
 * An activity list that grows unbounded would push the JSON-format instruction
 * out of the window and produce a malformed reply -- which fails as "no
 * suggestions at all", i.e. worse than never having added the feature.
 */

const h = require("./harness.cjs");

const {
  activitiesFromReservations,
  buildPackingPrompt,
  describeActivities,
  MAX_ACTIVITIES_IN_PROMPT,
} = h.loadModule("src/lib/packingSuggestions.ts");

(async () => {
  await h.test("describeActivities formats title, time and notes", async () => {
    h.assertDeepEqual(
      describeActivities([
        { title: "Noma", time: "19:30", notes: "jacket required" },
      ]),
      ["Noma at 19:30 (jacket required)"]
    );
  });

  await h.test("describeActivities omits absent time and notes cleanly", async () => {
    // No dangling "at" or empty parens -- the model reads these literally.
    h.assertDeepEqual(describeActivities([{ title: "Blue Lagoon" }]), ["Blue Lagoon"]);
    h.assertDeepEqual(
      describeActivities([{ title: "Blue Lagoon", time: "10:00", notes: "" }]),
      ["Blue Lagoon at 10:00"]
    );
    h.assertDeepEqual(
      describeActivities([{ title: "Blue Lagoon", notes: "bring towel" }]),
      ["Blue Lagoon (bring towel)"]
    );
  });

  await h.test("describeActivities drops activities with no usable title", async () => {
    // A nameless activity is not something the model can reason about, and an
    // empty bullet would waste context.
    h.assertDeepEqual(
      describeActivities([
        { title: "   " },
        { title: "" },
        { title: "Noma" },
      ]),
      ["Noma"]
    );
  });

  await h.test("describeActivities collapses whitespace and clips long notes", async () => {
    const long = "x".repeat(200);
    const [line] = describeActivities([{ title: "Gala", notes: long }]);
    // Clipped, with an ellipsis, and materially shorter than the input.
    h.assert(line.includes("…"), "long note should be elided with an ellipsis");
    h.assert(line.length < 120, `clipped line should be short, got ${line.length}`);

    const [spaced] = describeActivities([{ title: "Gala", notes: "a\n\n  b" }]);
    h.assertEqual(spaced, "Gala (a b)");
  });

  await h.test("describeActivities caps the list at MAX_ACTIVITIES_IN_PROMPT", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Thing ${i}` }));
    const out = describeActivities(many);
    h.assertEqual(out.length, MAX_ACTIVITIES_IN_PROMPT);
    // Order preserved, so the earliest (most imminent) activities survive.
    h.assertEqual(out[0], "Thing 0");
    h.assertEqual(out[MAX_ACTIVITIES_IN_PROMPT - 1], `Thing ${MAX_ACTIVITIES_IN_PROMPT - 1}`);
  });

  await h.test("activitiesFromReservations keeps activity and other, drops transport and lodging", async () => {
    const got = activitiesFromReservations([
      { type: "flight", title: "Delta 4021", startTime: "06:00", notes: "" },
      { type: "lodging", title: "Blue Lagoon Guesthouse", startTime: "", notes: "" },
      { type: "activity", title: "Noma", startTime: "19:30", notes: "jacket required" },
      { type: "car", title: "Hertz", startTime: "", notes: "" },
      { type: "train", title: "Shinkansen", startTime: "08:00", notes: "" },
      { type: "ferry", title: "Fjord ferry", startTime: "", notes: "" },
      { type: "other", title: "Spa day", startTime: "14:00", notes: "" },
    ]);
    h.assertDeepEqual(got, [
      { title: "Noma", time: "19:30", notes: "jacket required" },
      { title: "Spa day", time: "14:00", notes: "" },
    ]);
  });

  await h.test("activitiesFromReservations handles an empty or missing list", async () => {
    h.assertDeepEqual(activitiesFromReservations([]), []);
  });

  await h.test("prompt includes a planned-activities section when activities exist", async () => {
    const prompt = buildPackingPrompt({
      destination: "Copenhagen",
      days: 5,
      month: 6,
      activities: [{ title: "Noma", time: "19:30", notes: "jacket required" }],
    });
    h.assert(
      prompt.includes("Planned activities"),
      "prompt should introduce the activities section"
    );
    h.assert(
      prompt.includes("- Noma at 19:30 (jacket required)"),
      "prompt should carry the activity line verbatim"
    );
  });

  await h.test("prompt omits the activities section entirely when there are none", async () => {
    // An empty heading would waste context and invite the model to invent.
    const prompt = buildPackingPrompt({ destination: "Copenhagen", days: 5, month: 6 });
    h.assert(
      !prompt.toLowerCase().includes("planned activities"),
      "prompt must not mention activities when none were supplied"
    );
    h.assert(
      !prompt.includes("\n- "),
      "prompt must not emit an empty bullet list"
    );
  });

  await h.test("prompt no longer forbids activities", async () => {
    // This guard was correct when the model had no activity data, but with real
    // bookings supplied it suppressed the reasoning the feature exists for.
    const prompt = buildPackingPrompt({
      destination: "Copenhagen",
      days: 5,
      month: 6,
      activities: [{ title: "Noma", time: "19:30" }],
    });
    h.assert(
      !/do not invent activities/i.test(prompt),
      "the do-not-invent-activities guard must be gone"
    );
  });

  await h.test("activities do not dislodge the JSON-format instruction", async () => {
    // The regression this guards: a long activity list pushing the output
    // contract out of the small context window, yielding a malformed reply.
    const many = Array.from({ length: 50 }, (_, i) => ({
      title: `Venue ${i}`,
      time: "19:30",
      notes: "y".repeat(120),
    }));
    const prompt = buildPackingPrompt({
      destination: "Copenhagen",
      days: 5,
      month: 6,
      activities: many,
    });
    h.assert(
      prompt.includes('{"items":[{"name":"...","reason":"..."}]}'),
      "the JSON shape instruction must survive a large activity list"
    );
    h.assertEqual(
      (prompt.match(/^- /gm) || []).length,
      MAX_ACTIVITIES_IN_PROMPT,
      "no more than the cap should be emitted"
    );
  });

  await h.test("activities and already-packed rules coexist", async () => {
    const prompt = buildPackingPrompt(
      {
        destination: "Copenhagen",
        activities: [{ title: "Noma", time: "19:30" }],
      },
      ["Passport", "Charger"]
    );
    h.assert(prompt.includes("- Noma at 19:30"), "activity present");
    h.assert(prompt.includes("Passport"), "already-packed rule present");
  });

  h.summary();
})();
