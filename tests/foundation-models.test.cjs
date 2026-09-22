/*
 * Tests for the Foundation Models bridge's web-side parsing.
 *
 * Why this needs testing rather than trusting: `generateObject` asks a
 * language model for JSON, and models do not reliably give you bare JSON. The
 * failure is not hypothetical -- it shows up as a fenced block, a friendly
 * sentence before the object, or both. If the parser is brittle the user sees
 * no suggestions at all, and the cause (a chatty model) is invisible from the
 * UI, which just looks like the feature did not work.
 *
 * The contract being defended is narrow and deliberate: extract the outermost
 * object and parse it, or return null. It does NOT attempt repair. A
 * half-understood suggestion is worse than none, because it would be presented
 * to the user as advice about their trip.
 */

const h = require("./harness.cjs");

const { parseLooseJson } = h.loadModule("src/lib/foundationModels.ts");

async function run() {
  /* -- the happy path --------------------------------------------------- */

  await h.test("bare JSON parses", () => {
    const r = parseLooseJson('{"item":"Rain jacket","reason":"Rain expected"}');
    h.assertEqual(r.item, "Rain jacket");
    h.assertEqual(r.reason, "Rain expected");
  });

  /* -- the shapes models actually emit --------------------------------- */

  await h.test("a fenced json block parses", () => {
    const r = parseLooseJson(
      '```json\n{"item":"Sunscreen"}\n```'
    );
    h.assertEqual(r.item, "Sunscreen");
  });

  await h.test("a fence without a language tag parses", () => {
    const r = parseLooseJson('```\n{"item":"Sunscreen"}\n```');
    h.assertEqual(r.item, "Sunscreen");
  });

  await h.test("a sentence before the object is tolerated", () => {
    const r = parseLooseJson(
      'Here is a packing suggestion:\n{"item":"Umbrella","reason":"Showers"}'
    );
    h.assertEqual(r.item, "Umbrella");
  });

  await h.test("a fence plus surrounding prose parses", () => {
    const r = parseLooseJson(
      'Sure! Here you go:\n```json\n{"item":"Gloves","reason":"Cold"}\n```\nHope that helps.'
    );
    h.assertEqual(r.item, "Gloves");
  });

  /*
   * The two cases below are the ONLY ones where stripping the fence changes
   * the answer, and they are the reason that code exists.
   *
   * Every other fence case passes with the fence left in place, because the
   * outermost-brace extraction happens to find the same object either way --
   * so a test suite made only of those cases stays green even with the
   * fence-stripping deleted. That was true of this file's first revision,
   * and a mutation test is what exposed it.
   *
   * Both shapes are realistic: a model that offers two candidates, and one
   * that writes prose containing braces before the object.
   */

  await h.test("a second object after the fenced one does not corrupt parsing", () => {
    /* Without fence-stripping this spans from the FIRST `{` to the LAST `}`,
     * producing `{"item":"A"} ... {"item":"B"}` -- invalid JSON, and the
     * suggestion is silently lost. */
    const r = parseLooseJson(
      '```json\n{"item":"Rain jacket"}\n```\nOr alternatively {"item":"Umbrella"}'
    );
    h.assertEqual(r.item, "Rain jacket");
  });

  await h.test("braces in the prose before the fence are ignored", () => {
    /* The prose mentions `{braces}`; bare extraction starts there and fails. */
    const r = parseLooseJson(
      'Wrap it in {curly} braces like this:\n```json\n{"item":"Boots"}\n```'
    );
    h.assertEqual(r.item, "Boots");
  });

  await h.test("whitespace and newlines are fine", () => {
    const r = parseLooseJson('\n\n  {"item":" Hat "}  \n\n');
    h.assertEqual(r.item, " Hat ");
  });

  /* -- nested objects: the outermost braces must be the ones used ------- */

  await h.test("nested objects parse as one value", () => {
    const r = parseLooseJson(
      '{"item":"Jacket","detail":{"waterproof":true,"packable":true}}'
    );
    h.assertEqual(r.item, "Jacket");
    h.assertEqual(r.detail.waterproof, true);
    h.assertEqual(r.detail.packable, true);
  });

  await h.test("prose after an object does not break it", () => {
    const r = parseLooseJson('{"a":"1"} and that is my answer.');
    h.assertEqual(r.a, "1");
  });

  /* -- the honest failures: null, never a half-read object -------------- */

  await h.test("empty and near-empty input returns null", () => {
    h.assertEqual(parseLooseJson(""), null);
    h.assertEqual(parseLooseJson("   "), null);
    h.assertEqual(parseLooseJson("no object here"), null);
  });

  await h.test("an unclosed object returns null", () => {
    h.assertEqual(parseLooseJson('{"item":"Hat"'), null);
  });

  await h.test("a bare array is not an object and returns null", () => {
    h.assertEqual(parseLooseJson('[1,2,3]'), null);
  });

  await h.test("a malformed object returns null rather than partial data", () => {
    /* A trailing comma is the classic model output; JSON.parse rejects it
     * and that is the correct outcome -- better no suggestion than a
     * silently truncated one. */
    h.assertEqual(parseLooseJson('{"item":"Hat",}'), null);
  });

  await h.test("a JSON string is not an object and returns null", () => {
    h.assertEqual(parseLooseJson('"just a string"'), null);
  });

  await h.test("null literal inside braces returns null", () => {
    /* `{}` parses to an object but `null` does not, and neither should be
     * mistaken for a suggestion. */
    h.assertEqual(parseLooseJson("null"), null);
  });

  /* -- a guard on the contract itself ---------------------------------- */

  await h.test("the return is always an object or null, never an array", () => {
    const cases = [
      '{"a":1}',
      "[1,2]",
      '```json\n{"a":1}\n```',
      "garbage",
      "",
      '{"nested":{"a":[1,2]}}',
    ];
    for (const c of cases) {
      const r = parseLooseJson(c);
      h.assert(
        r === null || (typeof r === "object" && !Array.isArray(r)),
        `parseLooseJson(${JSON.stringify(c)}) returned ${
          Array.isArray(r) ? "an array" : typeof r
        }, expected object or null`
      );
    }
  });
}

(async function main() {
  await run();
  h.summary();
})();
