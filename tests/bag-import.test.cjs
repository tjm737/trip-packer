/**
 * Bag import: id minting, item remapping, and source selection.
 *
 * The failure mode this file exists to catch is silent id reuse. If a copy
 * keeps the source bag's id, the new trip's bag and the old trip's bag are the
 * same row in the same table -- the import appears to work in the UI and
 * corrupts both trips. Every test that touches buildBagImport asserts on fresh
 * ids for that reason.
 */
const h = require("./harness.cjs");

(async () => {
  const {
    bagSourceTrips,
    bagImportCandidates,
    buildBagImport,
    bagImportSummary,
    BAG_KIND_LABELS,
    BAG_KINDS,
    NO_IMPORT,
  } = await h.loadModule("src/lib/bagImport.ts");

  const bag = (id, tripId, name, kind = "carry_on") => ({
    id,
    tripId,
    name,
    kind,
    tagNumber: `TAG-${id}`,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const item = (id, tripId, bagId, name = `Item ${id}`) => ({
    id,
    tripId,
    categoryId: "c1",
    name,
    quantity: 1,
    checked: true,
    icon: "box",
    order: 0,
    bagId,
  });
  const trip = (id, name) => ({ id, name });

  // A deterministic minter: counter-based so assertions can name exact ids.
  const counter = () => {
    let n = 0;
    return () => `new-${++n}`;
  };
  const NOW = "2026-06-01T12:00:00.000Z";

  /* ---------------- bagSourceTrips ---------------- */

  await h.test("only trips that actually have bags are offered", () => {
    const state = {
      trips: [trip("t1", "Has bags"), trip("t2", "Empty")],
      bags: [bag("b1", "t1", "One")],
    };
    const sources = bagSourceTrips(state);
    h.assertEqual(sources.length, 1);
    h.assertEqual(sources[0].id, "t1");
    h.assertEqual(sources[0].bagCount, 1);
  });

  await h.test("the trip being created is excluded from its own sources", () => {
    const state = {
      trips: [trip("t1", "Old"), trip("t2", "New")],
      bags: [bag("b1", "t1", "One"), bag("b2", "t2", "Two")],
    };
    const sources = bagSourceTrips(state, "t2");
    h.assertEqual(sources.length, 1);
    h.assertEqual(sources[0].id, "t1");
  });

  await h.test("a trip with several bags reports the right count", () => {
    const state = {
      trips: [trip("t1", "Old")],
      bags: [bag("b1", "t1", "a"), bag("b2", "t1", "b"), bag("b3", "t1", "c")],
    };
    h.assertEqual(bagSourceTrips(state)[0].bagCount, 3);
  });

  await h.test("no trips at all yields no sources, not a crash", () => {
    h.assertDeepEqual(bagSourceTrips({ trips: [], bags: [] }), []);
  });

  await h.test("a state with no bags key yields no sources", () => {
    h.assertDeepEqual(bagSourceTrips({ trips: [trip("t1", "Old")] }), []);
  });

  /* ---------------- bagImportCandidates ---------------- */

  const twoTrips = () => ({
    bags: [bag("b1", "t1", "Carry-on", "carry_on"), bag("b2", "t1", "Checked", "checked"), bag("b3", "t2", "Other trip")],
    items: [
      item("i1", "t1", "b1", "In bag 1"),
      item("i2", "t1", "b2", "In bag 2"),
      item("i3", "t1", null, "Loose item"),
      item("i4", "t2", "b3", "Other trip item"),
    ],
  });

  await h.test("candidates are the items ALREADY IN a source trip's bags", () => {
    const c = bagImportCandidates(twoTrips(), { tripId: "t1", itemIds: null });
    const names = c.map((i) => i.name).sort();
    // The loose item must NOT come along: importing bags is not importing the
    // whole list.
    h.assertDeepEqual(names, ["In bag 1", "In bag 2"]);
  });

  await h.test("candidates never cross into another trip", () => {
    const c = bagImportCandidates(twoTrips(), { tripId: "t1", itemIds: null });
    h.assert(!c.some((i) => i.name === "Other trip item"), "t2's item must not appear");
  });

  await h.test("no source trip means no candidates", () => {
    h.assertDeepEqual(bagImportCandidates(twoTrips(), { tripId: null, itemIds: null }), []);
  });

  await h.test("an explicit item list narrows the candidates", () => {
    const c = bagImportCandidates(twoTrips(), { tripId: "t1", itemIds: ["i1"] });
    h.assertDeepEqual(c.map((i) => i.name), ["In bag 1"]);
  });

  await h.test("a STALE selection degrades to the truth, not to a phantom import", () => {
    // "i9" was ticked, then removed from the source trip before Create.
    const c = bagImportCandidates(twoTrips(), { tripId: "t1", itemIds: ["i1", "i9"] });
    h.assertDeepEqual(c.map((i) => i.name), ["In bag 1"]);
  });

  await h.test("an item whose bagId points at another trip is not a candidate", () => {
    const state = {
      bags: [bag("b1", "t1", "One")],
      // Malformed: item in t1 whose bagId names a bag in t2.
      items: [item("i1", "t1", "b-foreign", "Foreign")],
    };
    h.assertDeepEqual(bagImportCandidates(state, { tripId: "t1", itemIds: null }), []);
  });

  /* ---------------- buildBagImport ---------------- */

  await h.test("import mints NEW bag ids and remaps items onto them", () => {
    const state = twoTrips();
    const mint = counter();
    const { bags, items } = buildBagImport(state, "t-new", { tripId: "t1", itemIds: null }, mint, NOW);

    h.assertEqual(bags.length, 2);
    const newIds = bags.map((b) => b.id);
    // The core guarantee: no source id survives.
    h.assert(!newIds.includes("b1") && !newIds.includes("b2"), "source bag ids must not be reused");
    h.assertDeepEqual(newIds, ["new-1", "new-2"]);

    // Every copied bag belongs to the new trip.
    h.assert(bags.every((b) => b.tripId === "t-new"), "copies must land in the new trip");

    // Items point at the copies, not the originals.
    h.assertEqual(items.length, 2);
    h.assert(
      items.every((i) => newIds.includes(i.bagId)),
      "every imported item must reference a NEWLY created bag"
    );
    h.assert(
      items.every((i) => !["b1", "b2"].includes(i.bagId)),
      "no imported item may reference a source bag"
    );
    h.assert(items.every((i) => i.tripId === "t-new"), "copies must land in the new trip");
  });

  await h.test("the item->bag mapping is the CORRECT one, not just any new id", () => {
    const state = twoTrips();
    const mint = counter();
    const { bags, items } = buildBagImport(state, "t-new", { tripId: "t1", itemIds: null }, mint, NOW);
    // "In bag 1" came from b1, which became new-1. Mapping it onto new-2 would
    // silently reshuffle the user's packing into the wrong case.
    const byName = new Map(items.map((i) => [i.name, i.bagId]));
    h.assertEqual(byName.get("In bag 1"), bags.find((b) => b.name === "Carry-on").id);
    h.assertEqual(byName.get("In bag 2"), bags.find((b) => b.name === "Checked").id);
  });

  await h.test("imported items arrive UNCHECKED", () => {
    const state = twoTrips();
    const { items } = buildBagImport(state, "t-new", { tripId: "t1", itemIds: null }, counter(), NOW);
    // The source items were checked; a new trip's list is a plan.
    h.assert(items.every((i) => i.checked === false), "nothing may arrive pre-checked");
  });

  await h.test("imported bags carry the tag number (the point of the copy)", () => {
    const { bags } = buildBagImport(twoTrips(), "t-new", { tripId: "t1", itemIds: null }, counter(), NOW);
    h.assertDeepEqual(bags.map((b) => b.tagNumber), ["TAG-b1", "TAG-b2"]);
  });

  await h.test("imported bags are stamped now, not with the source timestamps", () => {
    const { bags } = buildBagImport(twoTrips(), "t-new", { tripId: "t1", itemIds: null }, counter(), NOW);
    h.assert(bags.every((b) => b.createdAt === NOW && b.updatedAt === NOW), "copies must be freshly stamped");
  });

  await h.test("no selection produces nothing at all", () => {
    const { bags, items } = buildBagImport(twoTrips(), "t-new", NO_IMPORT, counter(), NOW);
    h.assertEqual(bags.length, 0);
    h.assertEqual(items.length, 0);
  });

  await h.test("a narrowed item selection imports FEWER items but still all the bags", () => {
    const { bags, items } = buildBagImport(
      twoTrips(),
      "t-new",
      { tripId: "t1", itemIds: ["i1"] },
      counter(),
      NOW
    );
    // Bags are the unit being imported; item selection refines their contents.
    h.assertEqual(bags.length, 2);
    h.assertEqual(items.length, 1);
    h.assertEqual(items[0].name, "In bag 1");
  });

  await h.test("an item whose bag is not in the copy set is DROPPED, never orphaned", () => {
    const state = {
      bags: [bag("b1", "t1", "One")],
      items: [item("i1", "t1", "b1", "Kept"), item("i2", "t1", "b-gone", "Dangling")],
    };
    const { bags, items } = buildBagImport(state, "t-new", { tripId: "t1", itemIds: null }, counter(), NOW);
    h.assertEqual(bags.length, 1);
    // The dangling item must not be imported with an unresolvable bagId.
    h.assertDeepEqual(items.map((i) => i.name), ["Kept"]);
  });

  await h.test("importing from an empty trip yields nothing", () => {
    const state = { bags: [], items: [] };
    const { bags, items } = buildBagImport(state, "t-new", { tripId: "t1", itemIds: null }, counter(), NOW);
    h.assertEqual(bags.length, 0);
    h.assertEqual(items.length, 0);
  });

  /* ---------------- summary + kind labels ---------------- */

  await h.test("summary pluralises correctly for one and for many", () => {
    const one = {
      bags: [bag("b1", "t1", "One")],
      items: [item("i1", "t1", "b1")],
    };
    h.assertEqual(bagImportSummary(one, { tripId: "t1", itemIds: null }), "1 bag, 1 item");

    const many = twoTrips();
    h.assertEqual(bagImportSummary(many, { tripId: "t1", itemIds: null }), "2 bags, 2 items");
  });

  await h.test("summary names only the bags when they carry no items", () => {
    const state = { bags: [bag("b1", "t1", "One")], items: [] };
    h.assertEqual(bagImportSummary(state, { tripId: "t1", itemIds: null }), "1 bag");
  });

  await h.test("summary is null when there is nothing to import", () => {
    h.assertEqual(bagImportSummary(twoTrips(), NO_IMPORT), null);
  });

  await h.test("every BagKind has a label (no undefined rendered in the UI)", () => {
    for (const k of BAG_KINDS) {
      h.assert(typeof BAG_KIND_LABELS[k] === "string" && BAG_KIND_LABELS[k].length > 0, `missing label for ${k}`);
    }
  });

  h.summary();
})();
