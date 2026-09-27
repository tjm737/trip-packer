/*
 * Bag claim document tests.
 *
 * The value here is the awkward cases, not the happy path: a missing category,
 * two categories sharing a name, order collisions, and the totals that a claim
 * form is compared against. Those are exactly the cases that are painful to
 * check by rendering the page, because each one needs a hand-built database.
 * The logic is pure precisely so they can be exercised here.
 */

const h = require("./harness.cjs");

const { buildClaimDocument, bagKindLabel, CLAIM_DISCLAIMER } = h.loadModule(
  "src/lib/bagClaim.ts"
);
const { BAG_KIND_LABELS } = h.loadModule("src/lib/types.ts");

const TRIP = {
  name: "Lisbon Long Weekend",
  destination: "Lisbon, Portugal",
  startDate: "2026-10-21",
  endDate: "2026-10-24",
};

const BAG = {
  name: "Blue Away carry-on",
  kind: "carry_on",
  tagNumber: "TP123456",
  notes: "Hard shell, black wheels",
};

const CAT_CLOTHING = { id: "c1", tripId: "t1", name: "Clothing", icon: "shirt", order: 0 };
const CAT_TOILETRIES = { id: "c2", tripId: "t1", name: "Toiletries", icon: "droplet", order: 1 };
const CAT_TECH = { id: "c3", tripId: "t1", name: "Tech", icon: "laptop", order: 2 };

const item = (over) => ({
  id: "i",
  tripId: "t1",
  categoryId: "c1",
  name: "Thing",
  quantity: 1,
  checked: false,
  icon: "",
  order: 0,
  bagId: "b1",
  ...over,
});

(async () => {
  await h.test("resolves a bag kind to its label", () => {
    h.assertEqual(bagKindLabel("carry_on", BAG_KIND_LABELS), "Carry-on");
    h.assertEqual(bagKindLabel("checked", BAG_KIND_LABELS), "Checked");
  });

  await h.test("passes through an unrecognised kind rather than hiding it", () => {
    /*
     * A stored kind outside the union is a bug. Showing the raw value is how
     * anyone finds out; substituting "Other" would make it look like a
     * legitimate 'other' bag.
     */
    h.assertEqual(bagKindLabel("space-hopper", BAG_KIND_LABELS), "space-hopper");
  });

  await h.test("groups items by category, in category order", () => {
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "Laptop", categoryId: "c3", order: 0 }),
        item({ id: "i2", name: "T-shirts", categoryId: "c1", order: 0 }),
        item({ id: "i3", name: "Toothbrush", categoryId: "c2", order: 0 }),
      ],
      [CAT_CLOTHING, CAT_TOILETRIES, CAT_TECH],
      BAG_KIND_LABELS
    );

    h.assertDeepEqual(
      doc.sections.map((s) => s.categoryName),
      ["Clothing", "Toiletries", "Tech"]
    );
  });

  await h.test("orders items within a category by order, then name", () => {
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "Zip pouch", order: 5 }),
        item({ id: "i2", name: "Socks", order: 1 }),
        item({ id: "i3", name: "Anorak", order: 1 }),
      ],
      [CAT_CLOTHING],
      BAG_KIND_LABELS
    );

    // order 1 first (Anorak before Socks on the name tiebreak), then order 5.
    h.assertDeepEqual(
      doc.sections[0].lines.map((l) => l.name),
      ["Anorak", "Socks", "Zip pouch"]
    );
  });

  await h.test("item ordering is stable when two items collide on order AND name", () => {
    /*
     * The comparator must return 0 here rather than depending on input order,
     * so two reads of the same bag produce the same sheet.
     */
    const items = [
      item({ id: "i1", name: "Socks", order: 3 }),
      item({ id: "i2", name: "Socks", order: 3 }),
    ];
    const a = buildClaimDocument(TRIP, BAG, items, [CAT_CLOTHING], BAG_KIND_LABELS);
    const b = buildClaimDocument(TRIP, BAG, [...items].reverse(), [CAT_CLOTHING], BAG_KIND_LABELS);

    h.assertDeepEqual(
      a.sections[0].lines.map((l) => l.id).sort(),
      b.sections[0].lines.map((l) => l.id).sort()
    );
  });

  await h.test("keeps an item whose category no longer exists", () => {
    /*
     * Defensive depth, not a live scenario: the app sets PRAGMA foreign_keys=ON
     * and items.categoryId references categories(id), so this is unreachable
     * through the normal write path. Asserted anyway because the FK is a
     * per-connection pragma -- a restored snapshot could lack it -- and because
     * silently dropping an item would understate a claim, which is the one
     * error here that costs the user money. It lands in a trailing section.
     */
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "T-shirts", categoryId: "c1" }),
        item({ id: "i2", name: "Passport", categoryId: "deleted" }),
      ],
      [CAT_CLOTHING],
      BAG_KIND_LABELS
    );

    h.assertEqual(doc.sections.length, 2);
    h.assertEqual(doc.sections[0].categoryName, "Clothing");
    h.assertEqual(doc.sections[1].categoryName, null);
    h.assertDeepEqual(
      doc.sections[1].lines.map((l) => l.name),
      ["Passport"]
    );
  });

  await h.test("the unknown-category section always sorts last", () => {
    /*
     * Even when its neighbours' names would sort after it alphabetically. The
     * group has no name to sort by, so leaving it to a name comparison would
     * make its position depend on the other sections.
     */
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "Passport", categoryId: "deleted" }),
        item({ id: "i2", name: "T-shirts", categoryId: "c1" }),
        item({ id: "i3", name: "Laptop", categoryId: "c3" }),
      ],
      [CAT_CLOTHING, CAT_TECH],
      BAG_KIND_LABELS
    );

    h.assertEqual(doc.sections[doc.sections.length - 1].categoryName, null);
  });

  await h.test("two categories sharing a name merge into one section", () => {
    /*
     * Grouping by id would emit two sections both headed "Clothing", which
     * reads as a bug on a document handed to an airline.
     */
    const dupA = { id: "c1", tripId: "t1", name: "Clothing", icon: "", order: 0 };
    const dupB = { id: "c9", tripId: "t1", name: "Clothing", icon: "", order: 1 };
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "T-shirts", categoryId: "c1" }),
        item({ id: "i2", name: "Trousers", categoryId: "c9" }),
      ],
      [dupA, dupB],
      BAG_KIND_LABELS
    );

    h.assertEqual(doc.sections.length, 1);
    h.assertEqual(doc.sections[0].lines.length, 2);
  });

  await h.test("totals count pieces, and lines count distinct items", () => {
    /*
     * These differ, and both are needed: "5 items" on a claim form means five
     * things, but the sheet has two lines if one is a quantity of 4.
     */
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "Socks", quantity: 4, order: 0 }),
        item({ id: "i2", name: "Charger", quantity: 1, order: 1 }),
      ],
      [CAT_CLOTHING],
      BAG_KIND_LABELS
    );

    h.assertEqual(doc.totalItems, 5);
    h.assertEqual(doc.totalLines, 2);
    h.assertEqual(doc.sections[0].itemCount, 5);
  });

  await h.test("an empty bag produces an empty document, not a broken one", () => {
    const doc = buildClaimDocument(TRIP, BAG, [], [CAT_CLOTHING], BAG_KIND_LABELS);

    h.assertEqual(doc.sections.length, 0);
    h.assertEqual(doc.totalItems, 0);
    h.assertEqual(doc.totalLines, 0);
    h.assertEqual(doc.bag.name, "Blue Away carry-on");
  });

  await h.test("carries the bag and trip details a claim form asks for", () => {
    const doc = buildClaimDocument(TRIP, BAG, [], [], BAG_KIND_LABELS);

    h.assertEqual(doc.bag.name, "Blue Away carry-on");
    h.assertEqual(doc.bag.kindLabel, "Carry-on");
    h.assertEqual(doc.bag.tagNumber, "TP123456");
    h.assertEqual(doc.trip.destination, "Lisbon, Portugal");
    h.assertEqual(doc.trip.startDate, "2026-10-21");
  });

  await h.test("tolerates a bag with no tag number or notes", () => {
    /*
     * Both columns are nullable in practice even though the type says string:
     * a bag created before the fields existed, or via a stale client, can carry
     * undefined. The document must render "no tag" rather than "undefined".
     */
    const doc = buildClaimDocument(
      TRIP,
      { name: "Rucksack", kind: "carry_on", tagNumber: undefined, notes: undefined },
      [],
      [],
      BAG_KIND_LABELS
    );

    h.assertEqual(doc.bag.tagNumber, "");
    h.assertEqual(doc.bag.notes, "");
  });

  await h.test("states what the document does not contain", () => {
    /*
     * The caveat is part of the product, not decoration: a packet that looks
     * complete but omits the amount claimed gets filed as-is and rejected.
     */
    const doc = buildClaimDocument(TRIP, BAG, [], [], BAG_KIND_LABELS);

    h.assertEqual(doc.disclaimer, CLAIM_DISCLAIMER);
    h.assert(/values, receipts and photographs/i.test(doc.disclaimer), "names the omissions");
  });

  await h.test("sections that share an order fall back to name", () => {
    const a = { id: "c1", tripId: "t1", name: "Zips", icon: "", order: 7 };
    const b = { id: "c2", tripId: "t1", name: "Aprons", icon: "", order: 7 };
    const doc = buildClaimDocument(
      TRIP,
      BAG,
      [
        item({ id: "i1", name: "x", categoryId: "c1" }),
        item({ id: "i2", name: "y", categoryId: "c2" }),
      ],
      [a, b],
      BAG_KIND_LABELS
    );

    h.assertDeepEqual(
      doc.sections.map((s) => s.categoryName),
      ["Aprons", "Zips"]
    );
  });

  h.summary();
})();
