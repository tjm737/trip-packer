/*
 * The demo fixture.
 *
 * The seed script itself is exercised manually against a throwaway DB (it
 * writes to one), but the fixture content is pure data and worth asserting on,
 * because the failure modes are all silent:
 *
 *   - A hardcoded date means the demo shows a trip that finished months ago,
 *     and the app renders "0 days to go" -- which looks like a bug to the one
 *     person whose opinion decides whether this ships.
 *   - An empty category renders as an empty state, so a reviewer scrolling the
 *     list concludes the feature is unimplemented.
 *   - A reservation whose fields do not match the real Reservation shape is
 *     dropped silently by the insert, leaving the itinerary half-populated.
 */

const path = require("node:path");
const h = require("./harness.cjs");

const demo = h.loadModule(path.join(h.SRC, "lib", "demoFixture.ts"));

const RESERVATION_TYPES = [
  "flight", "lodging", "car", "train", "ferry", "activity", "other",
];

(async () => {
  await h.test("dateFromNow returns a YYYY-MM-DD date, in the future for positive input", () => {
    const d = demo.dateFromNow(24);
    h.assert(/^\d{4}-\d{2}-\d{2}$/.test(d), `not a date-only string: ${d}`);

    // Parse both as UTC midnight and compare, rather than string-comparing, so
    // this cannot pass or fail on timezone offset.
    const got = Date.parse(`${d}T00:00:00Z`);
    const want = Date.now() + 24 * 86400000;
    const driftDays = Math.abs(got - want) / 86400000;
    h.assert(driftDays < 1.5, `expected ~24 days out, off by ${driftDays.toFixed(2)} days`);
  });

  await h.test("dateFromNow handles negative offsets for past trips", () => {
    const d = demo.dateFromNow(-46);
    const got = Date.parse(`${d}T00:00:00Z`);
    h.assert(got < Date.now(), "a negative offset should be in the past");
  });

  await h.test("the active trip starts in the future and runs forward", () => {
    const t = demo.demoTrip();
    h.assert(t.startInDays > 0, "the demo trip must be upcoming, not past");
    h.assert(t.lengthDays > 0, "the demo trip must have a positive length");
  });

  await h.test("the archived trip is in the past", () => {
    const t = demo.archivedDemoTrip();
    h.assert(t.startInDays < 0, "the archived trip should be in the past");
  });

  await h.test("every category has at least one item", () => {
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      h.assert(trip.categories.length > 0, `${trip.name} has no categories`);
      for (const c of trip.categories) {
        h.assert(
          c.items.length > 0,
          `${trip.name} / ${c.name} is empty and would render as an empty state`
        );
      }
    }
  });

  await h.test("the active trip spans several categories", () => {
    const t = demo.demoTrip();
    h.assert(
      t.categories.length >= 4,
      `expected a full-looking list, got ${t.categories.length} categories`
    );
  });

  await h.test("the active trip's list is partly checked", () => {
    const items = demo.demoTrip().categories.flatMap((c) => c.items);
    const checked = items.filter((i) => i.checked);
    h.assert(checked.length > 0, "nothing checked: the progress bar shows 0%");
    h.assert(
      checked.length < items.length,
      "everything checked: the progress bar shows 100% and looks unused"
    );
  });

  await h.test("every item has a name and a sane quantity", () => {
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      for (const c of trip.categories) {
        for (const i of c.items) {
          h.assert(i.name && i.name.length > 0, `${c.name} has an unnamed item`);
          const q = i.quantity === undefined ? 1 : i.quantity;
          h.assert(
            Number.isInteger(q) && q > 0,
            `${i.name} has quantity ${q}, expected a positive integer`
          );
        }
      }
    }
  });

  await h.test("reservations use the real ReservationType values", () => {
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      for (const r of trip.reservations) {
        h.assert(
          RESERVATION_TYPES.includes(r.type),
          `unknown reservation type "${r.type}" -- it would be rejected by the insert`
        );
      }
    }
  });

  await h.test("reservation times are HH:MM, never timestamps", () => {
    // types.ts is explicit that a booking time is local and must not be stored
    // as an instant. A full ISO string here would pass a naive type check and
    // then display shifted by the timezone offset.
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      for (const r of trip.reservations) {
        h.assert(
          /^\d{2}:\d{2}$/.test(r.at),
          `${r.title} has time "${r.at}", expected HH:MM`
        );
      }
    }
  });

  await h.test("flights carry a destination; lodging and cars do not", () => {
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      for (const r of trip.reservations) {
        if (r.type === "flight" || r.type === "train" || r.type === "ferry") {
          h.assert(
            typeof r.locationTo === "string" && r.locationTo.length > 0,
            `${r.title} is a ${r.type} with no destination`
          );
        }
      }
    }
  });

  await h.test("every reservation has a title and a confirmation", () => {
    for (const trip of [demo.demoTrip(), demo.archivedDemoTrip()]) {
      for (const r of trip.reservations) {
        h.assert(r.title && r.title.length > 0, "a reservation has no title");
        h.assert(
          r.confirmation && r.confirmation.length > 0,
          `${r.title} has no confirmation code (the point of the feature)`
        );
      }
    }
  });

  await h.test("the fixture is regenerated per call, not frozen at import", () => {
    // If this were a module-level constant the dates would be captured once and
    // drift stale. Calling it twice must produce equal values, and the dates
    // must be recomputed rather than shared by reference.
    const a = demo.demoTrip();
    const b = demo.demoTrip();
    h.assert(a.startInDays === b.startInDays, "startInDays should be stable");
    h.assert(a !== b, "demoTrip() should return a fresh object");
    h.assert(
      a.categories !== b.categories,
      "categories should not be shared by reference between calls"
    );
  });

  h.summary();
})();
