#!/usr/bin/env node
/*
 * Print sections: which lists a printed sheet carries.
 *
 * Why these tests look like this
 * ------------------------------
 * "Print only the packing list" is the feature, and the whole feature is one
 * parser plus one predicate. The interesting cases are the ABSENT cases -- the
 * URL nobody typed a parameter into, the parameter someone typed wrong, and the
 * parameter that legitimately names nothing. Each of those has a different
 * correct answer, and collapsing any two of them is the bug this file exists to
 * catch:
 *
 *   ?            (no param)        -> everything   (the default document)
 *   ?parts=        (empty string)  -> everything   (same as absent)
 *   ?parts=packing                -> just packing
 *   ?parts=notes  (unknown token)  -> nothing      (NOT everything)
 *
 * The last one is the trap. If unknown tokens fell back to "print everything",
 * a typo or a renamed section would silently print a different document than
 * the one asked for -- and the user would not find out until the paper came out
 * of the printer.
 */

const assert = require("node:assert");
const path = require("node:path");
const h = require("./harness.cjs");
const { test, loadModule } = h;

const layout = loadModule(path.join(h.SRC, "lib", "itineraryLayout.ts"));
const { parsePrintSections, togglePrintSection, PRINT_SECTIONS } = layout;

test("no parameter at all prints the full document", () => {
  // undefined is the real shape when the URL has no query string.
  assert.deepStrictEqual(parsePrintSections(undefined), ["itinerary", "actions", "packing"]);
  // "" is what Next gives for `?parts=`. Same intent as absent.
  assert.deepStrictEqual(parsePrintSections(""), ["itinerary", "actions", "packing"]);
  // A repeated parameter arrives as an array; the first value wins.
  assert.deepStrictEqual(parsePrintSections(["packing", "actions"]), ["actions", "packing"]);
});

test("a single section prints only that section", () => {
  assert.deepStrictEqual(parsePrintSections("packing"), ["packing"]);
  assert.deepStrictEqual(parsePrintSections("actions"), ["actions"]);
  assert.deepStrictEqual(parsePrintSections("itinerary"), ["itinerary"]);
});

test("two sections print in document order, not parameter order", () => {
  // The sheet's section order is itinerary -> actions -> packing. Asking for
  // packing first must not move it above the itinerary on the page.
  assert.deepStrictEqual(parsePrintSections("packing,itinerary"), ["itinerary", "packing"]);
  assert.deepStrictEqual(parsePrintSections("actions,packing"), ["actions", "packing"]);
});

test("unknown tokens are dropped, and an all-unknown param selects nothing", () => {
  // The important one. A renamed or mistyped section must NOT fall back to
  // printing everything: the caller distinguishes [] from the default and asks
  // the user to choose. See the print page's empty-selection branch.
  assert.deepStrictEqual(parsePrintSections("notes"), []);
  assert.deepStrictEqual(parsePrintSections("notes,map"), []);
  // A mixture keeps only the known token.
  assert.deepStrictEqual(parsePrintSections("packing,notes"), ["packing"]);
});

test("whitespace, casing and duplicates are normalised away", () => {
  assert.deepStrictEqual(parsePrintSections(" packing , actions "), ["actions", "packing"]);
  assert.deepStrictEqual(parsePrintSections("PACKING"), ["packing"]);
  assert.deepStrictEqual(parsePrintSections("packing,packing,packing"), ["packing"]);
});

test("a valid subset never contains a section that does not exist", () => {
  // Guards against a future PRINT_SECTIONS edit that forgets to update the
  // parser: every returned token must be a real section.
  for (const s of parsePrintSections("itinerary,actions,packing,notes")) {
    assert.ok(PRINT_SECTIONS.includes(s), `unexpected section returned: ${s}`);
  }
});

test("toggling is a pure operation, including on the last section", () => {
  /*
   * The helper is a pure toggle and has no opinion about staying non-empty:
   * clicking the last one off returns []. The toolbar is what refuses that
   * click (it disables the checkbox when `selected.length === 1`), so the empty
   * selection is unreachable through the UI -- but if a caller ever does get
   * [], the print page renders its "no sections selected" notice rather than a
   * bare sheet. This test pins the pure behaviour so nobody "fixes" it into
   * silently retaining a section, which would make the toggle lie about state.
   */
  assert.deepStrictEqual(togglePrintSection(["packing"], "packing"), []);
  // Toggling a section off keeps the others, in document order.
  assert.deepStrictEqual(togglePrintSection(["itinerary", "actions", "packing"], "actions"), [
    "itinerary",
    "packing",
  ]);
  // Toggling on adds it in document order, not at the end.
  assert.deepStrictEqual(togglePrintSection(["packing"], "itinerary"), ["itinerary", "packing"]);
});

console.log("action-print-sections: all assertions passed");
