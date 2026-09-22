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

  /* ------------------------------------------------------------------ */
  /* Server-side resolution: bare entity id, no caller-supplied claim     */
  /* ------------------------------------------------------------------ */

  await h.test("owningTripId resolves the owner without any claim", () => {
    const s = makeState();
    // The caller states nothing but the entity id. This is the primitive the
    // update/delete guards are built on.
    h.assertEqual(access.owningTripId(s, "item", "item-bob"), BOB_TRIP);
    h.assertEqual(access.owningTripId(s, "category", "cat-bob"), BOB_TRIP);
    h.assertEqual(access.owningTripId(s, "reservation", "res-bob"), BOB_TRIP);
    h.assertEqual(access.owningTripId(s, "trip", BOB_TRIP), BOB_TRIP);
  });

  await h.test("owningTripId returns null for unknown or empty ids", () => {
    const s = makeState();
    h.assertEqual(access.owningTripId(s, "item", "does-not-exist"), null);
    h.assertEqual(access.owningTripId(s, "item", ""), null);
    h.assertEqual(access.owningTripId(s, "trip", "nope"), null);
  });

  await h.test("owningTripId resolves an item via its parent category", () => {
    // Legacy shape: no tripId on the item, ownership only via categoryId.
    const s = makeState();
    delete s.items[1].tripId;
    h.assertEqual(
      access.owningTripId(s, "item", "item-bob"),
      BOB_TRIP,
      "must fall back to the parent category"
    );
  });

  /*
   * The confused-deputy attack this pair of functions exists to prevent.
   *
   * canWriteEntityOfTrip starts from a trip id the CALLER supplied. If it were
   * used for updates, an attacker could pass their OWN trip id alongside a
   * victim's item id, and the trip-level check would pass. Whether the request
   * was refused would then depend on whether they also bothered to be
   * consistent about the entity — a fragile place to put the only real check.
   */
  await h.test("canWriteEntityOfTrip is satisfied by own trip + foreign entity", () => {
    const s = makeState();
    // Alice's own trip, Bob's item id. The trip check passes; the entity check
    // is the only thing refusing it.
    h.assertEqual(
      access.canWriteEntityOfTrip(s, ALICE, ALICE_TRIP, "item", "item-bob"),
      false,
      "entity/parent mismatch must be refused by the entity check"
    );
  });

  await h.test("canMutateEntityById ignores the caller entirely", () => {
    const s = makeState();
    // No trip id is accepted as a parameter at all, so the attack above is not
    // expressible: the trip is resolved from the entity.
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", "item-bob"),
      false,
      "Alice must not write Bob's item"
    );
    h.assertEqual(
      access.canMutateEntityById(s, BOB, "item", "item-bob"),
      true,
      "Bob may write his own item"
    );
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", "item-alice"),
      true,
      "Alice may write her own item"
    );
  });

  await h.test("canMutateEntityById refuses unknown entities and bad identities", () => {
    const s = makeState();
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", "no-such-item"),
      false,
      "a non-existent entity is a refusal, never a pass"
    );
    h.assertEqual(
      access.canMutateEntityById(s, null, "item", "item-alice"),
      false,
      "null identity cannot write"
    );
    h.assertEqual(
      access.canMutateEntityById(s, "", "item", "item-alice"),
      false,
      "empty-string identity cannot write"
    );
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", ""),
      false,
      "empty entity id cannot write"
    );
  });

  await h.test("a viewer may read but not mutate an entity by id", () => {
    const s = makeState();
    s.tripMembers = [
      { id: "m1", tripId: BOB_TRIP, userId: ALICE, role: "viewer" },
    ];
    h.assertEqual(
      access.canReadEntityById(s, ALICE, "item", "item-bob"),
      true,
      "viewer may read"
    );
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", "item-bob"),
      false,
      "viewer must not write"
    );
  });

  await h.test("an editor may mutate an entity by id on a shared trip", () => {
    const s = makeState();
    s.tripMembers = [
      { id: "m2", tripId: BOB_TRIP, userId: ALICE, role: "editor" },
    ];
    h.assertEqual(
      access.canMutateEntityById(s, ALICE, "item", "item-bob"),
      true,
      "editor may write on a shared trip"
    );
  });

  await h.test("canReadEntityById refuses a foreign entity", () => {
    const s = makeState();
    h.assertEqual(
      access.canReadEntityById(s, ALICE, "item", "item-bob"),
      false,
      "Alice must not read Bob's item when not a member"
    );
    h.assertEqual(
      access.canReadEntityById(s, ALICE, "reservation", "res-bob"),
      false,
      "reservation too"
    );
    h.assertEqual(
      access.canReadEntityById(s, null, "item", "item-alice"),
      false,
      "no identity, no read"
    );
  });

  h.summary();

})();
