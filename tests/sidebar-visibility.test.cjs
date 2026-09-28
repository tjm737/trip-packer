/*
 * Tests for sidebar section visibility.
 *
 * The bug this guards against shipped once already: the sidebar rendered the
 * account list and the companion controls to every sign-in, so a non-owner saw
 * the roster of who can sign in to a personal instance, plus buttons the server
 * answers with a 403. The client discards the mutate error, so the button just
 * silently did nothing.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *   1. A non-owner must not see accounts or companions.
 *   2. A non-owner MUST still see upcoming and archived -- the whole point of
 *      the sidebar for them. Gating too much is the failure mode of fixing this
 *      bug carelessly.
 */

const h = require("./harness.cjs");

const {
  OWNER_ONLY_SECTIONS,
  isSectionVisible,
  visibleSections,
} = h.loadModule("src/lib/sidebarVisibility.ts");

async function run() {
  /* -- the non-owner is the reason this exists ----------------------------- */

  await h.test("a non-owner cannot see accounts", () => {
    h.assertEqual(isSectionVisible("accounts", false), false);
  });

  await h.test("a non-owner cannot see companions", () => {
    h.assertEqual(isSectionVisible("companions", false), false);
  });

  await h.test("a non-owner still sees upcoming and archived", () => {
    /*
     * Load-bearing. If the gate were written as "show nothing unless owner"
     * these would go too, and a non-owner would get an empty sidebar with no
     * way to reach their own trips.
     */
    h.assertEqual(isSectionVisible("upcoming", false), true);
    h.assertEqual(isSectionVisible("archived", false), true);
  });

  /* -- the owner keeps everything ------------------------------------------ */

  await h.test("the owner sees every section", () => {
    for (const s of ["accounts", "companions", "upcoming", "archived"]) {
      h.assertEqual(isSectionVisible(s, true), true);
    }
  });

  /* -- the whole list, which is what the sidebar actually renders ---------- */

  await h.test("a non-owner's visible order is upcoming then archived", () => {
    /*
     * Order is asserted, not just membership: the sidebar renders these in
     * sequence, and getting the order wrong is a visible defect even when the
     * set is right.
     */
    h.assertDeepEqual(visibleSections(false), ["upcoming", "archived"]);
  });

  await h.test("the owner's visible order is unchanged from before the gate", () => {
    h.assertDeepEqual(visibleSections(true), [
      "accounts",
      "companions",
      "upcoming",
      "archived",
    ]);
  });

  /* -- the gate is a named list, not a hardcoded pair ---------------------- */

  await h.test("accounts and companions are the only owner-only sections", () => {
    /*
     * Pins the decision. Adding a section to OWNER_ONLY_SECTIONS without
     * thinking about it should show up as a deliberate edit here.
     */
    h.assertDeepEqual([...OWNER_ONLY_SECTIONS], ["accounts", "companions"]);
  });

  /* -- regressions --------------------------------------------------------- */

  await h.test("the owner gate does not depend on the collapse state", () => {
    /*
     * A collapsed section is still present; a hidden one is not. These two
     * concepts were easy to conflate because both live in the sidebar. The
     * visibility function takes no expanded-state argument precisely so this
     * cannot regress -- assert the arity so it stays that way.
     */
    h.assertEqual(isSectionVisible.length, 2);
  });

  await h.summary();
}

run();
