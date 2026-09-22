/*
 * Access control — the single place that decides who may see and change what.
 *
 * Why this is its own module rather than checks sprinkled through the route
 * handlers: the failure mode we are guarding against is *partial* coverage. An
 * app where /api/state is correctly scoped but one of the twenty-two mutate ops
 * forgets to check ownership is not "mostly secure" — it is fully compromised
 * by that one op. Centralising the decisions means a new op gets a guard by
 * construction, and there is exactly one implementation to test.
 *
 * Two rules, both non-negotiable:
 *
 *   1. The acting user comes from the SESSION. A user id in the request body is
 *      attacker-controlled and is never consulted for identity.
 *   2. Ownership is resolved through the parent chain. An item belongs to a
 *      category belongs to a trip; permission on the item is permission on the
 *      trip. Checking the child id alone proves nothing, because the child id
 *      is exactly what an attacker supplies.
 *
 * This module is deliberately pure: it takes state and ids, and returns
 * decisions. No database, no request objects, no Next.js. That is what lets it
 * be tested directly, which is the only reason to trust it.
 */

import type { AppState, User } from "./types";

/** Role a user holds on a trip they do not own. */
export type TripRole = "owner" | "editor" | "viewer";

/**
 * Membership row. Owner is implicit (trips.userId) and is not stored here, so
 * a membership row can never contradict the trip's actual owner.
 */
export type TripMember = {
  tripId: string;
  userId: string;
  role: "editor" | "viewer";
};

/**
 * The shape this module needs to make decisions. Kept structural rather than
 * importing a concrete type so tests can build a fixture without satisfying the
 * whole AppState surface.
 */
type AccessState = {
  trips: { id: string; userId: string }[];
  categories?: { id: string; tripId: string }[];
  items?: { id: string; tripId?: string; categoryId?: string }[];
  tasks?: { id: string; tripId: string }[];
  reservations?: { id: string; tripId: string }[];
  tripMembers?: TripMember[];
};

/** Entity kinds whose membership we can resolve back to a trip. */
export type EntityKind = "trip" | "category" | "item" | "task" | "reservation";

/* ------------------------------------------------------------------ */
/* Identity resolution                                                 */
/* ------------------------------------------------------------------ */

/**
 * Whether a user id is usable as an identity.
 *
 * Empty string and null/undefined are rejected explicitly. Treating "" as a
 * valid id would make every malformed session resolve to whichever row happens
 * to have an empty id, which is the classic way an auth bypass ships.
 */
function isRealUserId(userId: string | null | undefined): userId is string {
  return typeof userId === "string" && userId.length > 0;
}

/* ------------------------------------------------------------------ */
/* Trip-level decisions                                                */
/* ------------------------------------------------------------------ */

/** The role a user holds on a trip, or null if they have none. */
export function roleOnTrip(
  state: AccessState,
  userId: string | null | undefined,
  tripId: string
): TripRole | null {
  if (!isRealUserId(userId)) return null;

  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip) return null;

  // Ownership wins over any membership row, always.
  if (trip.userId === userId) return "owner";

  const member = (state.tripMembers ?? []).find(
    (m) => m.tripId === tripId && m.userId === userId
  );
  if (!member) return null;

  return member.role === "editor" ? "editor" : "viewer";
}

/** Whether a user may read a trip: owner, or any member. */
export function canReadTrip(
  state: AccessState,
  userId: string | null | undefined,
  tripId: string
): boolean {
  return roleOnTrip(state, userId, tripId) !== null;
}

/**
 * Whether a user may write a trip: owner or editor, but NOT viewer.
 *
 * Named `assertCanWriteTrip` for historical symmetry with the guard call sites;
 * it returns a boolean rather than throwing so it composes with both route
 * handlers and tests.
 */
export function assertCanWriteTrip(
  state: AccessState,
  userId: string | null | undefined,
  tripId: string
): boolean {
  const role = roleOnTrip(state, userId, tripId);
  return role === "owner" || role === "editor";
}

/* ------------------------------------------------------------------ */
/* Entity-level decisions                                              */
/* ------------------------------------------------------------------ */

/**
 * Which trip owns this entity — resolved WITHOUT a caller-supplied claim.
 *
 * This is the server-side-resolution primitive. The route layer never passes a
 * trip id for updates and deletes; it hands over a bare entity id and this
 * function answers "whose is it?" from the database alone. That ordering is the
 * whole point of the design: the caller cannot lie about the parent because the
 * caller never states it.
 *
 * Returns null when the entity does not exist. Callers must treat null as a
 * refusal, never as "no restriction".
 */
export function owningTripId(
  state: AccessState,
  kind: EntityKind,
  entityId: string
): string | null {
  if (typeof entityId !== "string" || entityId.length === 0) return null;

  if (kind === "trip") {
    return state.trips.some((t) => t.id === entityId) ? entityId : null;
  }

  if (kind === "category") {
    const cat = (state.categories ?? []).find((c) => c.id === entityId);
    return cat ? cat.tripId : null;
  }

  if (kind === "item") {
    const item = (state.items ?? []).find((i) => i.id === entityId);
    if (!item) return null;
    // Items carry a tripId directly in the normalised shape; fall back to the
    // parent category when the field is absent so both shapes are covered.
    return item.tripId ?? owningTripIdViaCategory(state, item.categoryId);
  }

  if (kind === "task") {
    const task = (state.tasks ?? []).find((t) => t.id === entityId);
    return task ? task.tripId : null;
  }

  if (kind === "reservation") {
    const res = (state.reservations ?? []).find((r) => r.id === entityId);
    return res ? res.tripId : null;
  }

  return null;
}

/**
 * Resolve an entity id to the trip that owns it, confirming a claimed trip id.
 *
 * Returns null when the entity does not exist OR does not belong to `tripId`.
 * Those two cases are deliberately conflated: distinguishing them would let a
 * caller probe which ids exist in other accounts' data.
 *
 * Used for CREATE operations, where the parent trip legitimately arrives in the
 * payload because the entity does not exist yet. For updates and deletes use
 * `owningTripId`, which does not trust a claim.
 */
export function resolveEntityTripId(
  state: AccessState,
  kind: EntityKind,
  entityId: string,
  tripId: string
): string | null {
  const owning = owningTripId(state, kind, entityId);
  return owning !== null && owning === tripId ? tripId : null;
}

function owningTripIdViaCategory(
  state: AccessState,
  categoryId: string | undefined
): string | null {
  if (!categoryId) return null;
  const cat = (state.categories ?? []).find((c) => c.id === categoryId);
  return cat ? cat.tripId : null;
}

/**
 * Whether a user may write a specific entity that is claimed to live under
 * `tripId`.
 *
 * Both conditions must hold: the user must be able to write the trip, AND the
 * entity must actually belong to that trip. The second check is what stops a
 * caller from smuggling an id across a trip boundary — passing your own trip id
 * alongside someone else's item id.
 */
export function canWriteEntityOfTrip(
  state: AccessState,
  userId: string | null | undefined,
  tripId: string,
  kind: EntityKind,
  entityId: string
): boolean {
  if (!assertCanWriteTrip(state, userId, tripId)) return false;
  return resolveEntityTripId(state, kind, entityId, tripId) !== null;
}

/**
 * Whether a user may write an entity identified by a BARE id, with the owning
 * trip resolved server-side.
 *
 * This is the guard for update and delete operations. The distinction from
 * `canWriteEntityOfTrip` is the whole security story:
 *
 *   canWriteEntityOfTrip(state, u, tripId, kind, id)
 *       "may you write this trip, and does this entity belong to it?"
 *       -- starts from a trip id the CALLER supplied.
 *
 *   canMutateEntityById(state, u, kind, id)
 *       "whose is this entity, and may you write it?"
 *       -- starts from the entity and trusts nothing from the caller.
 *
 * The first is only safe when the parent genuinely must come from the client,
 * i.e. creates. Using it for updates reintroduces the confused-deputy bug where
 * a caller pairs their own trip id with someone else's entity id: the trip check
 * passes, and whether the entity check passes depends on whether the caller
 * bothered to be consistent. This function removes the caller's input entirely.
 *
 * A null resolution means the entity does not exist, which is a refusal.
 */
export function canMutateEntityById(
  state: AccessState,
  userId: string | null | undefined,
  kind: EntityKind,
  entityId: string
): boolean {
  if (!isRealUserId(userId)) return false;

  const tripId = owningTripId(state, kind, entityId);
  if (tripId === null) return false;

  return assertCanWriteTrip(state, userId, tripId);
}

/**
 * Whether a user may read an entity identified by a bare id.
 *
 * The read-side counterpart to `canMutateEntityById`, for the same reason: a
 * bare id must be resolved rather than trusted.
 */
export function canReadEntityById(
  state: AccessState,
  userId: string | null | undefined,
  kind: EntityKind,
  entityId: string
): boolean {
  if (!isRealUserId(userId)) return false;

  const tripId = owningTripId(state, kind, entityId);
  if (tripId === null) return false;

  return canReadTrip(state, userId, tripId);
}

/* ------------------------------------------------------------------ */
/* State scoping                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reduce the full dataset to exactly what `userId` may see.
 *
 * Returns null when there is no usable identity. Null is the correct answer
 * rather than an empty object: an empty object is indistinguishable from "this
 * account has no trips yet", which would silently mask an auth failure as a
 * fresh account. The route layer turns null into a 401.
 *
 * Children are filtered by resolving each one back to a visible trip, so a
 * shared trip brings its own categories/items/reservations and nothing else.
 */
export function scopeStateForUser(
  state: AccessState & Partial<Pick<AppState, "users" | "activeUserId">>,
  userId: string | null | undefined
): (AccessState & { users: User[]; activeUserId: string }) | null {
  if (!isRealUserId(userId)) return null;

  // The user must actually exist. An unknown id is not a wildcard.
  const users = (state.users ?? []) as User[];
  const knownUser = users.some((u) => u.id === userId);
  if (state.users && !knownUser) return null;

  const visibleTrips = state.trips.filter(
    (t) => roleOnTrip(state, userId, t.id) !== null
  );
  const visibleTripIds = new Set(visibleTrips.map((t) => t.id));

  return {
    /*
     * Fall back to a minimal record for the authenticated user rather than to an
     * empty list: the client needs someone to render in the sidebar, and a
     * synthetic entry with only an id is the least we can hand over without
     * leaking other accounts. The credential fields on User are optional, so a
     * bare { id, name, ... } satisfies the type.
     */
    users:
      users.length > 0
        ? users
        : [{ id: userId, name: "Traveler", avatarColor: "#64748b", createdAt: "" }],
    // activeUserId is a legacy profile-switching concept. With real sessions it
    // is simply the authenticated user, so the client has nothing to switch.
    activeUserId: userId,
    trips: visibleTrips,
    categories: (state.categories ?? []).filter((c) => visibleTripIds.has(c.tripId)),
    items: (state.items ?? []).filter((i) => {
      const owning =
        i.tripId ?? owningTripIdViaCategory(state, i.categoryId);
      return owning !== null && visibleTripIds.has(owning as string);
    }),
    tasks: (state.tasks ?? []).filter((t) => visibleTripIds.has(t.tripId)),
    reservations: (state.reservations ?? []).filter((r) =>
      visibleTripIds.has(r.tripId)
    ),
    tripMembers: (state.tripMembers ?? []).filter((m) =>
      visibleTripIds.has(m.tripId)
    ),
  };
}
