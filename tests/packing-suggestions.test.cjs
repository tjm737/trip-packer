/*
 * Tests for packing-suggestion prompt building and response normalising.
 *
 * These run in plain Node with no native bridge, which is the point of keeping
 * the logic pure. The cases that matter are the defensive ones: the on-device
 * model is small and returns surprise shapes, and a surprise must degrade to
 * "no suggestion", never to a crash or a duplicate row.
 */

const h = require("./harness.cjs");

const {
  addability,
  buildPackingPrompt,
  normalizeSuggestions,
  describeTrip,
  MAX_SUGGESTIONS,
} = h.loadModule("src/lib/packingSuggestions.ts");

(async () => {
  await h.test("describeTrip includes only the facts it was given", async () => {
    h.assertEqual(describeTrip({ destination: "Tokyo, Japan", days: 7, month: 10 }), "Tokyo, Japan, 7 days, in October");
    h.assertEqual(describeTrip({ destination: "Lisbon" }), "Lisbon");
    // No invented context: a missing month must not become a guess.
    h.assertEqual(describeTrip({ destination: "Lisbon", days: 3 }), "Lisbon, 3 days");
  });

  await h.test("describeTrip singularises a one-day trip", async () => {
    h.assertEqual(describeTrip({ destination: "Oslo", days: 1 }), "Oslo, 1 day");
  });

  await h.test("describeTrip ignores nonsense day/month values", async () => {
    h.assertEqual(describeTrip({ destination: "Oslo", days: 0 }), "Oslo");
    h.assertEqual(describeTrip({ destination: "Oslo", days: -4 }), "Oslo");
    h.assertEqual(describeTrip({ destination: "Oslo", month: 13 }), "Oslo");
    h.assertEqual(describeTrip({ destination: "Oslo", month: 0 }), "Oslo");
  });

  await h.test("prompt names the destination and forbids repeats", async () => {
    const prompt = buildPackingPrompt(
      { destination: "Reykjavik, Iceland", days: 5, month: 2 },
      ["Parka", "Gloves"]
    );
    h.assert(prompt.includes("Reykjavik, Iceland"), "should name the destination");
    h.assert(prompt.includes("5 days"), "should include trip length");
    h.assert(prompt.includes("February"), "should name the month");
    h.assert(prompt.includes("Parka") && prompt.includes("Gloves"), "should list what is packed");
    h.assert(prompt.includes("Do not suggest"), "should forbid repeats");
    h.assert(prompt.includes("JSON"), "should demand JSON");
  });

  await h.test("prompt omits the do-not-repeat clause when nothing is packed", async () => {
    const prompt = buildPackingPrompt({ destination: "Cairo" }, []);
    h.assert(!prompt.includes("Do not suggest"), "nothing packed means no repeat clause");
  });

  await h.test("prompt caps the existing list so it cannot crowd out the rules", async () => {
    const many = Array.from({ length: 80 }, (_, i) => `Item${i}`);
    const prompt = buildPackingPrompt({ destination: "Cairo" }, many);
    h.assert(prompt.includes("Item39"), "should keep the head of the list");
    h.assert(!prompt.includes("Item40"), "should drop the tail of the list");
    // The instruction must survive the trim.
    h.assert(prompt.includes("Do not suggest"), "the rule must survive the trim");
  });

  await h.test("normalises the prompted shape", async () => {
    const out = normalizeSuggestions({
      items: [
        { name: "Rain jacket", reason: "Likely showers" },
        { name: "Umbrella" },
      ],
    });
    h.assertEqual(out.length, 2);
    h.assertEqual(out[0].name, "Rain jacket");
    h.assertEqual(out[0].reason, "Likely showers");
    h.assertEqual(out[1].name, "Umbrella");
    h.assertEqual(out[1].reason, undefined);
  });

  await h.test("normalises a bare array and plain-string entries", async () => {
    h.assertEqual(normalizeSuggestions(["Sunscreen", "Hat"]).map((s) => s.name), ["Sunscreen", "Hat"]);
  });

  await h.test("accepts the model's common key and field aliases", async () => {
    const out = normalizeSuggestions({ suggestions: [{ item: "Adapter", why: "Different sockets" }] });
    h.assertEqual(out.length, 1);
    h.assertEqual(out[0].name, "Adapter");
    h.assertEqual(out[0].reason, "Different sockets");
  });

  await h.test("finds a single array under an unexpected key", async () => {
    const out = normalizeSuggestions({ packing: [{ name: "Towel" }] });
    h.assertEqual(out.map((s) => s.name), ["Towel"]);
  });

  await h.test("drops entries with no usable name instead of rendering blanks", async () => {
    const out = normalizeSuggestions({
      items: [{ name: "   " }, { reason: "no name" }, null, 42, { name: "Socks" }],
    });
    h.assertEqual(out.map((s) => s.name), ["Socks"]);
  });

  await h.test("returns nothing for unusable responses rather than throwing", async () => {
    h.assertEqual(normalizeSuggestions(null).length, 0);
    h.assertEqual(normalizeSuggestions(undefined).length, 0);
    h.assertEqual(normalizeSuggestions("not json").length, 0);
    h.assertEqual(normalizeSuggestions(42).length, 0);
    // Ambiguous: two arrays and no known key -- refuse rather than guess.
    h.assertEqual(normalizeSuggestions({ a: [1], b: [2] }).length, 0);
  });

  /*
   * The core guarantee. If this ever fails, the feature has started editing
   * the user's list on its own.
   */
  await h.test("never returns an item the user already has", async () => {
    const out = normalizeSuggestions(
      { items: [{ name: "Passport" }, { name: "Sunscreen" }, { name: "Adapter" }] },
      ["passport", "  SUNSCREEN  "]
    );
    h.assertEqual(out.map((s) => s.name), ["Adapter"]);
  });

  await h.test("deduplicates repeats within a single response", async () => {
    const out = normalizeSuggestions({
      items: [{ name: "Adapter" }, { name: "adapter" }, { name: "ADAPTER" }],
    });
    h.assertEqual(out.length, 1);
  });

  await h.test("trims whitespace and caps the number returned", async () => {
    const out = normalizeSuggestions({
      items: Array.from({ length: MAX_SUGGESTIONS + 10 }, (_, i) => ({ name: `  Item${i}  ` })),
    });
    h.assertEqual(out.length, MAX_SUGGESTIONS);
    h.assertEqual(out[0].name, "Item0");
  });

  /*
   * Click-time gate. This is the logic that makes "the user chooses, the list
   * is never touched automatically" true even when the list changes between
   * generating suggestions and clicking one.
   */

  await h.test("allows a fresh item", async () => {
    h.assertEqual(addability("Thermal base layer", false), "ok");
  });

  await h.test("refuses an item already on the list", async () => {
    h.assertEqual(addability("Parka", true), "duplicate");
  });

  await h.test("refuses a blank name", async () => {
    h.assertEqual(addability("   ", false), "blank");
  });

  await h.test("blank beats duplicate -- an empty name is never addable", async () => {
    // Ordering matters: a blank name is not a duplicate, it is unusable. If
    // these ever swap, a blank row could be treated as an existing item.
    h.assertEqual(addability("", true), "blank");
  });

  await h.test("normalising against a stale list still lets the click gate catch it", async () => {
    // Realistic race: suggestions were generated when the list was empty, so
    // normalisation keeps "Socks". The user adds it from another tab. Clicking
    // the stale row must be refused by the live-list gate, not the stale copy.
    const generated = normalizeSuggestions({ items: [{ name: "Socks" }] }, []);
    h.assertEqual(generated.length, 1, "stale generation still offers Socks");

    const liveListNowHasIt = true;
    h.assertEqual(
      addability(generated[0].name, liveListNowHasIt),
      "duplicate",
      "live list must veto the stale suggestion"
    );
  });

  h.summary();
})();
