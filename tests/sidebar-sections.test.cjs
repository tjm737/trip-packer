/*
 * Tests for sidebar section collapse state.
 *
 * The failure modes that matter are about the persisted blob, since that is the
 * only input a user can corrupt:
 *
 *   1. A missing or unparseable entry must not throw inside a render path.
 *   2. A partial entry must not collapse a section the user never touched.
 *   3. Adding the control must not change the default view for anyone who never
 *      touches it -- accounts and companions stay expanded.
 */

const h = require("./harness.cjs");

const {
  DEFAULT_EXPANDED,
  normalizeExpanded,
  toggleSection,
} = h.loadModule("src/lib/sidebarSections.ts");

async function run() {
  /* -- defaults ------------------------------------------------------------ */

  await h.test("accounts and companions default to expanded", () => {
    /*
     * Load-bearing for backward compatibility. Every existing user has no
     * persisted entry, so these defaults ARE what they see after this ships.
     * Flipping either to false would hide accounts/companions that were visible
     * before the collapse control existed.
     */
    h.assertEqual(DEFAULT_EXPANDED.accounts, true);
    h.assertEqual(DEFAULT_EXPANDED.companions, true);
  });

  await h.test("archived defaults to collapsed and upcoming to expanded", () => {
    h.assertEqual(DEFAULT_EXPANDED.archived, false);
    h.assertEqual(DEFAULT_EXPANDED.upcoming, true);
  });

  /* -- toggling ------------------------------------------------------------ */

  await h.test("toggling flips only the named section", () => {
    const before = { ...DEFAULT_EXPANDED };
    const after = toggleSection(before, "accounts");
    h.assertEqual(after.accounts, false);
    // Every other key must be untouched, or collapsing one section would move
    // its neighbours.
    h.assertEqual(after.companions, true);
    h.assertEqual(after.upcoming, true);
    h.assertEqual(after.archived, false);
    // And the input must not be mutated in place -- React state updates depend
    // on getting a new object back.
    h.assertEqual(before.accounts, true);
  });

  await h.test("toggling twice returns to the original state", () => {
    const once = toggleSection(DEFAULT_EXPANDED, "companions");
    const twice = toggleSection(once, "companions");
    h.assertDeepEqual(twice, DEFAULT_EXPANDED);
  });

  /* -- reading a persisted blob -------------------------------------------- */

  await h.test("a missing entry falls back to defaults", () => {
    h.assertDeepEqual(normalizeExpanded(undefined), DEFAULT_EXPANDED);
    h.assertDeepEqual(normalizeExpanded(null), DEFAULT_EXPANDED);
  });

  await h.test("junk input falls back to defaults instead of throwing", () => {
    // A number, a string and an array are all `typeof === object` or not, and
    // none of them should crash a render.
    h.assertDeepEqual(normalizeExpanded(42), DEFAULT_EXPANDED);
    h.assertDeepEqual(normalizeExpanded("nope"), DEFAULT_EXPANDED);
    h.assertDeepEqual(normalizeExpanded({}), DEFAULT_EXPANDED);
  });

  await h.test("a partial entry leaves untouched sections at their defaults", () => {
    /*
     * The important one. A stored blob written by an older build -- or by a
     * build that knows about fewer sections -- must not collapse the sections it
     * says nothing about. Only `accounts: false` is present here.
     */
    const got = normalizeExpanded({ accounts: false });
    h.assertEqual(got.accounts, false);
    h.assertEqual(got.companions, true);
    h.assertEqual(got.upcoming, true);
    h.assertEqual(got.archived, false);
  });

  await h.test("non-boolean values are ignored rather than coerced", () => {
    /*
     * "false" (the string) is truthy in JS, and 0 is falsy -- coercing either
     * would silently invert the user's intent. Anything that is not a real
     * boolean falls back to the default.
     */
    const got = normalizeExpanded({ accounts: "false", companions: 0, upcoming: 1 });
    h.assertEqual(got.accounts, DEFAULT_EXPANDED.accounts);
    h.assertEqual(got.companions, DEFAULT_EXPANDED.companions);
    h.assertEqual(got.upcoming, DEFAULT_EXPANDED.upcoming);
  });

  await h.test("unknown keys in the blob are dropped", () => {
    // Keeps the returned object the exact known shape, so downstream code can
    // index it without a fallback.
    const got = normalizeExpanded({ accounts: false, nonsense: true });
    h.assertDeepEqual(Object.keys(got).sort(), [
      "accounts",
      "archived",
      "companions",
      "upcoming",
    ]);
  });

  await h.test("a fully persisted entry round-trips", () => {
    const stored = { accounts: false, companions: false, upcoming: true, archived: true };
    h.assertDeepEqual(normalizeExpanded(stored), stored);
  });

  await h.summary();
}

run();
