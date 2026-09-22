/*
 * Tests for share-link visibility.
 *
 * What these guard against: a section an owner believed they had hidden still
 * being readable by whoever holds the link.
 *
 * That is a privacy bug, and it has two distinct failure shapes worth testing
 * separately:
 *
 *   1. THE CONTROL DOES NOTHING. A toggle writes, but the read path never looks
 *      at it, so the page renders everything anyway.
 *
 *   2. THE DATA STILL SHIPS. The page looks right because React declined to
 *      render a section, but the rows are in the JSON response. Anyone with the
 *      link can open devtools and read the "hidden" packing list. This is the
 *      subtler one, so the assertions below mostly check ABSENCE FROM THE
 *      PAYLOAD rather than the presence of a boolean.
 *
 * The last group covers the boundary rules: a stored value that is missing,
 * partial, corrupt, or hostile must resolve to something safe rather than
 * throwing, because this code runs inside the public endpoint and a throw there
 * takes the share page down for a legitimate viewer.
 */

const h = require("./harness.cjs");

const {
  SHARE_SECTIONS,
  SHAREABLE_SECTIONS,
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  parseStoredVisibility,
  serializeVisibility,
  isVisible,
  filterForShare,
} = h.loadModule("src/lib/shareVisibility.ts");

/* --------------------------------------------------------------------- data */

function trip(overrides = {}) {
  return {
    id: "t1",
    userId: "owner-1",
    name: "Japan",
    destination: "Tokyo",
    startDate: "2026-10-13",
    endDate: "2026-10-20",
    notes: "Bring the JR pass",
    icon: "🗾",
    archived: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reservation(overrides = {}) {
  return {
    id: "r1",
    tripId: "t1",
    type: "flight",
    title: "NH 105",
    confirmation: "ABC123",
    location: "HND",
    startDate: "2026-10-13",
    endDate: "2026-10-13",
    startTime: "11:00",
    endTime: "15:00",
    notes: "window seat",
    ...overrides,
  };
}

const ALL_ROWS = () => ({
  reservations: [reservation()],
  tasks: [{ id: "k1", tripId: "t1", title: "Buy JR pass", done: false, dueDate: "2026-10-01" }],
  categories: [{ id: "c1", tripId: "t1", name: "Clothes", icon: "👕", order: 0 }],
  items: [{ id: "i1", tripId: "t1", categoryId: "c1", name: "Socks", checked: false }],
});

/* --------------------------------------------------------------- the tests */

async function run() {
  /* -- defaults ---------------------------------------------------------- */

  await h.test("a link with no stored setting shows everything", () => {
    // The pre-feature behaviour. A row written before this column existed has
    // NULL here, and it must not start hiding things the owner never hid.
    const v = parseStoredVisibility(null);
    for (const section of SHARE_SECTIONS) {
      h.assertEqual(v[section], true, `${section} should default to visible`);
    }
  });

  await h.test("the default record is visible for every section", () => {
    for (const section of SHARE_SECTIONS) {
      h.assertEqual(DEFAULT_VISIBILITY[section], true);
    }
  });

  await h.test("the itinerary cannot be hidden", () => {
    // A link showing nothing is a dead URL, so this is forced even when asked.
    h.assertEqual(normalizeVisibility({ itinerary: false }).itinerary, true);
    h.assertEqual(normalizeVisibility({ itinerary: false }).packing, true);
  });

  /* -- hostile / malformed input ----------------------------------------- */

  await h.test("non-boolean values are ignored, not coerced", () => {
    // "false" and 0 are the classic coercion traps: `if (value)` would treat one
    // as hidden and the other as visible, and both readings are wrong.
    const v = normalizeVisibility({ packing: "false", tasks: 0, confirmations: null });
    h.assertEqual(v.packing, true, '"false" is not a boolean and must not hide');
    h.assertEqual(v.tasks, true, "0 is not a boolean and must not hide");
    h.assertEqual(v.confirmations, true);
  });

  await h.test("unknown keys are dropped", () => {
    const v = normalizeVisibility({ packing: false, __proto__: { evil: true }, nope: 1 });
    h.assertEqual(v.packing, false, "a real setting must still apply");
    h.assertEqual(Object.prototype.hasOwnProperty.call(v, "nope"), false);
  });

  await h.test("a corrupt stored value falls back to visible instead of throwing", () => {
    // This runs on the public endpoint; a throw here is a 500 for a valid viewer.
    const v = parseStoredVisibility("{not json at all");
    h.assertEqual(v.packing, true);
    h.assertEqual(v.itinerary, true);
  });

  await h.test("a partial stored record fills in the missing keys as visible", () => {
    const v = parseStoredVisibility(JSON.stringify({ packing: false }));
    h.assertEqual(v.packing, false, "the stored choice is honoured");
    h.assertEqual(v.tasks, true, "an unstored key defaults to visible");
  });

  await h.test("serialize then parse round-trips", () => {
    const v = normalizeVisibility({ packing: false, tasks: true });
    const back = parseStoredVisibility(serializeVisibility(v));
    h.assertEqual(back.packing, false);
    h.assertEqual(back.tasks, true);
  });

  await h.test("serialize writes only known keys", () => {
    const json = serializeVisibility({ ...DEFAULT_VISIBILITY, junk: true });
    h.assertEqual(json.includes("junk"), false, "input keys must not be copied through");
  });

  await h.test("isVisible treats an unknown section name as hidden", () => {
    // Guards a URL param or typo silently reading as `undefined` (falsy) in a
    // render branch.
    h.assertEqual(isVisible(DEFAULT_VISIBILITY, "packing"), true);
    h.assertEqual(isVisible(DEFAULT_VISIBILITY, "map"), false);
    h.assertEqual(isVisible(DEFAULT_VISIBILITY, "toString"), false);
  });

  /* -- the enforcement that actually matters ----------------------------- */

  await h.test("hiding the packing list removes the items AND categories from the payload", () => {
    /*
     * The key assertion in this file. Checking only that the UI would skip the
     * section would pass against code that still shipped the data.
     */
    const p = filterForShare(trip(), normalizeVisibility({ packing: false }), ALL_ROWS());
    h.assertEqual(p.items.length, 0, "packing items must not be in the payload");
    h.assertEqual(p.categories.length, 0, "categories must not be in the payload either");
    h.assertEqual(JSON.stringify(p).includes("Socks"), false, "no item names anywhere in the JSON");
  });

  await h.test("hiding the to-do list removes the tasks from the payload", () => {
    const p = filterForShare(trip(), normalizeVisibility({ tasks: false }), ALL_ROWS());
    h.assertEqual(p.tasks.length, 0);
    h.assertEqual(JSON.stringify(p).includes("Buy JR pass"), false);
  });

  await h.test("hiding confirmation numbers blanks the field but keeps the booking", () => {
    /*
     * These two have to be separable. A confirmation number can be enough to
     * change a reservation, but its absence must not cost the viewer the flight
     * time — so the row stays and one field is emptied.
     */
    const withRefs = filterForShare(trip(), normalizeVisibility({ confirmations: true }), ALL_ROWS());
    h.assertEqual(withRefs.reservations[0].confirmation, "ABC123");

    const p = filterForShare(trip(), normalizeVisibility({ confirmations: false }), ALL_ROWS());
    h.assertEqual(p.reservations.length, 1, "the booking itself must still be listed");
    h.assertEqual(p.reservations[0].confirmation, "", "the reference must be blanked");
    h.assertEqual(p.reservations[0].title, "NH 105", "other fields must survive");
    h.assertEqual(
      JSON.stringify(p).includes("ABC123"),
      false,
      "the reference must not appear anywhere in the JSON"
    );
  });

  await h.test("hiding the packing list does not disturb the itinerary", () => {
    // Sections are independent; one toggle must not have a side effect on another.
    const p = filterForShare(trip(), normalizeVisibility({ packing: false }), ALL_ROWS());
    h.assertEqual(p.reservations.length, 1);
    h.assertEqual(p.tasks.length, 1);
  });

  await h.test("the payload never carries the owner's user id", () => {
    // The share page is unauthenticated; who owns the trip is not the viewer's
    // business, and a spread of the trip row would have leaked it.
    const p = filterForShare(trip(), DEFAULT_VISIBILITY, ALL_ROWS());
    h.assertEqual("userId" in p.trip, false, "userId must not be in the shared payload");
    h.assertEqual(JSON.stringify(p).includes("owner-1"), false);
  });

  await h.test("the payload carries the visibility record so the view can match the server", () => {
    const v = normalizeVisibility({ packing: false });
    const p = filterForShare(trip(), v, ALL_ROWS());
    h.assertEqual(p.visibility.packing, false, "the view needs to know what was hidden");
  });

  await h.test("a fully-hidden-optional link still shows the itinerary", () => {
    // The floor: whatever is ticked off, the page must not come out empty.
    const v = normalizeVisibility({ packing: false, tasks: false, confirmations: false });
    const p = filterForShare(trip(), v, ALL_ROWS());
    h.assertEqual(p.trip.name, "Japan");
    h.assertEqual(p.reservations.length, 1);
  });

  /* -- the toggle set the UI offers -------------------------------------- */

  await h.test("only packing, tasks and confirmations are offered as hideable", () => {
    // A toggle for something the view never renders is worse than no toggle: the
    // owner would tick it believing they had hidden something.
    h.assertEqual(SHAREABLE_SECTIONS.includes("itinerary"), false, "the itinerary is always shown");
    h.assertEqual(SHAREABLE_SECTIONS.length, 3);
    for (const s of SHAREABLE_SECTIONS) {
      h.assertEqual(SHARE_SECTIONS.includes(s), true, `${s} must be a real section`);
    }
  });
}

(async function main() {
  await run();
  h.summary();
})();
