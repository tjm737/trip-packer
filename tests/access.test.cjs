/*
 * Negative isolation tests — the property that makes multi-user safe.
 *
 * The bug these guard against: filtering responses by a client-supplied user id
 * while writes still trust the client. That "works" in every happy-path demo and
 * fails catastrophically the first time one account touches another's trip. The
 * assertion that matters is therefore NEGATIVE: user A must not be able to read
 * or mutate user B's trip, even when A asks for it by exact id.
 *
 * These tests exercise the REAL access-control module (src/lib/access.ts)
 * through the same transpile-the-source harness as the rest of the suite, so a
 * passing run means the shipped guards are correct rather than a test-local
 * reimplementation of them.
 */

const h = require("./harness.cjs");

const accessPath = require("node:path").join(h.SRC, "lib", "access.ts");
const access = h.loadModule(accessPath);

/*
 * Two accounts, each owning one trip. B's trip id is passed EXPLICITLY into
 * every A-side call — the point is that knowing the id must not be enough.
 * A real attacker has the id (share links, URLs, referrers); the guard has to
 * hold anyway.
 */
const ALICE = "user-alice";
const BOB = "user-bob";
const ALICE_TRIP = "trip-alice";
const BOB_TRIP = "trip-bob";

/** Minimal in-memory state: two users, one trip each, plus a shared category. */
function makeState() {
  return {
    users: [
      { id: ALICE, name: "Alice", avatarColor: "#a3a3a3", createdAt: "2026-01-01" },
      { id: BOB, name: "Bob", avatarColor: "#b3b3b3", createdAt: "2026-01-01" },
    ],
    activeUserId: ALICE,
    trips: [
      { id: ALICE_TRIP, userId: ALICE, name: "Alice in Iceland", startDate: "2026-06-01" },
      { id: BOB_TRIP, userId: BOB, name: "Bob in Japan", startDate: "2026-07-01" },
    ],
    categories: [
      { id: "cat-alice", tripId: ALICE_TRIP, name: "Clothing" },
      { id: "cat-bob", tripId: BOB_TRIP, name: "Electronics" },
    ],
    items: [
      { id: "item-alice", categoryId: "cat-alice", tripId: ALICE_TRIP, name: "Parka" },
      { id: "item-bob", categoryId: "cat-bob", tripId: BOB_TRIP, name: "Adapter" },
    ],
    tasks: [],
    reservations: [
      { id: "res-alice", tripId: ALICE_TRIP, type: "flight", title: "KEF" },
      { id: "res-bob", tripId: BOB_TRIP, type: "flight", title: "NRT" },
    ],
    // trip_members: nobody is a member of anyone else's trip yet.
    tripMembers: [],
  };
}

;(async () => {
  /* ------------------------------------------------------------------ */
  /* Reading another account's trip                                      */
  /* ------------------------------------------------------------------ */

  await h.test("state for Alice excludes Bob's trips and their children", () => {
    const scoped = access.scopeStateForUser(makeState(), ALICE);

    const tripIds = scoped.trips.map((t) => t.id);
    h.assert(tripIds.includes(ALICE_TRIP), "Alice should still see her own trip");
    h.assert(!tripIds.includes(BOB_TRIP), "Alice must NOT see Bob's trip");

    // Children must be filtered too — leaking categories/items/reservations
    // while hiding the trip row still exposes the itinerary.
    h.assert(
      !scoped.categories.some((c) => c.tripId === BOB_TRIP),
      "Alice must NOT see categories of Bob's trip"
    );
    h.assert(
      !scoped.items.some((i) => i.tripId === BOB_TRIP),
      "Alice must NOT see items of Bob's trip"
    );
    h.assert(
      !scoped.reservations.some((r) => r.tripId === BOB_TRIP),
      "Alice must NOT see reservations of Bob's trip"
    );
  });

  await h.test("Bob's trip is not readable by Alice even when asked for by exact id", () => {
    const state = makeState();
    h.assert(
      access.canReadTrip(state, ALICE, BOB_TRIP) === false,
      "knowing the trip id must not grant read access"
    );
    h.assert(
      access.canReadTrip(state, BOB, BOB_TRIP) === true,
      "the owner must still be able to read their own trip"
    );
  });

  /* ------------------------------------------------------------------ */
  /* Mutating another account's trip                                     */
  /* ------------------------------------------------------------------ */

  await h.test("Alice cannot mutate Bob's trip", () => {
    const state = makeState();
    h.assert(
      access.assertCanWriteTrip(state, ALICE, BOB_TRIP) === false,
      "writing another account's trip must be refused"
    );
    h.assert(
      access.assertCanWriteTrip(state, BOB, BOB_TRIP) === true,
      "the owner must be able to write their own trip"
    );
  });

  await h.test("Alice cannot mutate a child of Bob's trip by naming the child id", () => {
    // The realistic attack: don't touch the trip row at all, just retitle an
    // item. Ownership has to be resolved through the parent chain.
    const state = makeState();
    h.assert(
      access.canWriteEntityOfTrip(state, ALICE, BOB_TRIP, "item", "item-bob") === false,
      "must not be able to write an item belonging to another account's trip"
    );
    h.assert(
      access.canWriteEntityOfTrip(state, BOB, BOB_TRIP, "item", "item-bob") === true,
      "owner must be able to write their own item"
    );
  });

  await h.test("a child id from another trip is rejected even under the correct trip", () => {
    // Defence in depth: passing Bob's trip id WITH Alice's trip id must not
    // let the item id drift across the trip boundary.
    const state = makeState();
    h.assert(
      access.canWriteEntityOfTrip(state, ALICE, ALICE_TRIP, "item", "item-bob") === false,
      "an item id from another trip must be rejected under Alice's trip"
    );
  });

  /* ------------------------------------------------------------------ */
  /* Unauthenticated access                                              */
  /* ------------------------------------------------------------------ */

  await h.test("no session means no state", () => {
    h.assert(
      access.scopeStateForUser(makeState(), null) === null,
      "a missing user id must yield null, not the full dataset"
    );
    h.assert(
      access.scopeStateForUser(makeState(), "") === null,
      "an empty user id must yield null, not the full dataset"
    );
  });

  await h.test("an unknown user id is not a wildcard", () => {
    const scoped = access.scopeStateForUser(makeState(), "user-does-not-exist");
    // Either null or an empty view is acceptable; returning everyone's data is not.
    const leaks = scoped !== null && scoped.trips && scoped.trips.length > 0;
    h.assert(!leaks, "an unknown user id must not expose any trips");
  });

  /* ------------------------------------------------------------------ */
  /* Membership sharing (option C: schema present, read-only links first) */
  /* ------------------------------------------------------------------ */

  await h.test("a trip member can read the shared trip but not a stranger's", () => {
    const state = makeState();
    bodyguard: {
      state.tripMembers = [{ tripId: BOB_TRIP, userId: ALICE, role: "viewer" }];
    }
    h.assert(
      access.canReadTrip(state, ALICE, BOB_TRIP) === true,
      "an explicit member must be able to read the shared trip"
    );
    h.assert(
      access.assertCanWriteTrip(state, ALICE, BOB_TRIP) === false,
      "a viewer must NOT be able to write the shared trip"
    );
  });

  await h.test("an editor member can write the shared trip", () => {
    const state = makeState();
    state.tripMembers = [{ tripId: BOB_TRIP, userId: ALICE, role: "editor" }];
    h.assert(
      access.canReadTrip(state, ALICE, BOB_TRIP) === true,
      "an editor must be able to read the shared trip"
    );
    h.assert(
      access.assertCanWriteTrip(state, ALICE, BOB_TRIP) === true,
      "an editor must be able to write the shared trip"
    );
  });

  await h.test("membership does not leak the trip owner's other trips", () => {
    // Being a member of one of Bob's trips must not expose Bob's other trips.
    const state = makeState();
    state.trips.push({
      id: "trip-bob-secret",
      userId: BOB,
      name: "Bob solo",
      startDate: "2026-08-01",
    });
    state.tripMembers = [{ tripId: BOB_TRIP, userId: ALICE, role: "viewer" }];

    const scoped = access.scopeStateForUser(state, ALICE);
    const ids = scoped.trips.map((t) => t.id);
    h.assert(ids.includes(BOB_TRIP), "the shared trip should be visible");
    h.assert(!ids.includes("trip-bob-secret"), "Bob's unshared trip must stay hidden");
  });

  h.summary();

})();
