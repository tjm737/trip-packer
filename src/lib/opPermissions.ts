/*
 * The permission table for every mutate operation.
 *
 * Why a table instead of a check inside each `case`: the switch in the route
 * handler has 22 branches, and a guard written per-branch is 22 chances to
 * forget one. A forgotten guard does not fail loudly — it silently becomes an
 * operation any authenticated user can run against anyone's data. That is the
 * failure mode this file exists to make unrepresentable.
 *
 * So: every op declares what it needs here, the route enforces the declaration
 * at a single chokepoint BEFORE dispatching, and a test asserts that every op
 * name in the route's Body union appears in this table. Adding an operation
 * without a permission therefore fails the suite rather than shipping open.
 *
 * The three requirement kinds:
 *
 *   { kind: "create",   entity }  parent trip comes from the payload, because
 *                                 the entity does not exist yet. Verified with
 *                                 canWriteEntityOfTrip, which checks both that
 *                                 the user may write THAT trip and that any
 *                                 referenced parents live under it.
 *
 *   { kind: "byId",     entity }  the op names an existing entity by id. The
 *                                 owning trip is resolved server-side with
 *                                 canMutateEntityById; the caller's claimed
 *                                 parent is never trusted. See access.ts for
 *                                 why this is a different function.
 *
 *   { kind: "admin" }             account administration. Any owner may run it.
 *
 *   { kind: "self" }              acts on the acting user's own record.
 *
 *   { kind: "selfOrAdmin" }       editing an account record: an owner may edit
 *                                 anyone, everyone else only themselves. Used
 *                                 for user.update, where both are legitimate —
 *                                 the sidebar's traveler editor is owner-only,
 *                                 while the profile screen is self-service.
 *                                 The route checks the target id, because this
 *                                 op names its user in the payload.
 *
 *   { kind: "session" }           no data access; affects the session only.
 *
 * Anything not listed here must still be listed explicitly — there is no
 * default. `state.replace` is the notable one: it rewrites everything, so it
 * gets `admin` and is additionally narrowed in the route to the caller's own
 * rows.
 */

import type { EntityKind } from "./access";

export type Permission =
  | { kind: "create"; entity: EntityKind }
  | { kind: "byId"; entity: EntityKind }
  | { kind: "admin" }
  | { kind: "self" }
  | { kind: "selfOrAdmin" }
  | { kind: "session" };

/*
 * Account records are NOT trip-scoped entities. A user is not owned by a trip,
 * so EntityKind (which is deliberately trip-scoped) does not include them and
 * `canMutateEntityById` cannot be used for them. Account ops are therefore all
 * `admin`, enforced against the target user in the route rather than resolved
 * through a trip. Naming this explicitly so the omission of "user" from
 * EntityKind reads as intentional rather than as a gap.
 */

/**
 * Every mutate op, with what it requires.
 *
 * `satisfies Record<string, Permission>` keeps the literal key union available
 * to the type checker while still constraining the values, so a typo in a
 * permission object is caught at compile time.
 */
export const OP_PERMISSIONS = {
  /*
   * Account administration.
   *
   * Closed registration: there is no public signup. These exist for the
   * owner-created-accounts model and for the create-account CLI. `user.add` is
   * admin rather than open because an open registration endpoint on a personal
   * instance is an invitation.
   */
  "user.add": { kind: "admin" },
  /*
   * Deleting an account is selfOrAdmin, not admin.
   *
   * App Store guideline 5.1.1(v) requires that a user be able to delete their
   * own account from inside the app, and an owner-only op cannot satisfy that:
   * the whole point is that the person deleting is not the owner. The target is
   * therefore enforced in the route (same shape as user.update) so a caller can
   * only ever delete themselves unless they are an owner.
   *
   * This is deliberately narrower than it looks: "who can log in" is still
   * owner-controlled for everyone else, and the route keeps the last-account
   * guard — an instance with zero accounts has no way back in through the UI.
   */
  "user.delete": { kind: "selfOrAdmin" },
  /*
   * Editing an account is the one account op that is not purely administrative.
   * The sidebar's traveler editor (owner-only) and the profile screen
   * (self-service) share it, so the permission permits both and the route
   * enforces the target. Adding or deleting accounts stays admin-only: those
   * change who can log in, which is not a self-service action.
   */
  "user.update": { kind: "selfOrAdmin" },

  /*
   * Trips.
   *
   * trip.create's parent is the acting user themselves — a trip is owned by
   * whoever makes it, so there is no foreign parent to validate. The route
   * additionally forces trip.userId to the session user rather than trusting
   * the payload's userId, which is what stops "create a trip owned by someone
   * else".
   */
  "trip.create": { kind: "self" },
  "trip.update": { kind: "byId", entity: "trip" },
  "trip.delete": { kind: "byId", entity: "trip" },

  /* Children: created under a payload-supplied trip, mutated by bare id. */
  "category.create": { kind: "create", entity: "category" },
  "category.update": { kind: "byId", entity: "category" },
  "category.delete": { kind: "byId", entity: "category" },

  "item.create": { kind: "create", entity: "item" },
  "item.update": { kind: "byId", entity: "item" },
  "item.delete": { kind: "byId", entity: "item" },

  "task.create": { kind: "create", entity: "task" },
  "task.update": { kind: "byId", entity: "task" },
  "task.delete": { kind: "byId", entity: "task" },

  "reservation.create": { kind: "create", entity: "reservation" },
  "reservation.update": { kind: "byId", entity: "reservation" },
  "reservation.delete": { kind: "byId", entity: "reservation" },

  /*
   * Reorder names a trip and a list of reservation ids. The trip is a
   * payload-supplied parent, but the ids must also be checked to belong to that
   * trip — otherwise a caller could reorder a victim's reservations by naming
   * their own trip. Handled as `create`-style: parent from payload, plus a
   * per-id membership check in the route.
   */
  "reservation.reorder": { kind: "create", entity: "reservation" },

  /*
   * state.replace rewrites the whole dataset. Under multi-user this is a
   * wipe-everyone button, so it is admin-only AND narrowed in the route to the
   * caller's own visible rows. Retained rather than deleted because the offline
   * sync path uses it to push a full local snapshot.
   */
  "state.replace": { kind: "admin" },
} satisfies Record<string, Permission>;

export type OpName = keyof typeof OP_PERMISSIONS;

/** Every op name, as a runtime array (for tests and exhaustiveness checks). */
export const ALL_OPS = Object.keys(OP_PERMISSIONS) as OpName[];

/**
 * Look up an op's requirement, returning null for an unknown op.
 *
 * The route turns null into a 400. Note this is a REFUSAL, not a default: an op
 * that is not in the table cannot run. If this function ever returned a
 * permissive default, the whole table would be decorative.
 */
export function permissionFor(op: string): Permission | null {
  return Object.prototype.hasOwnProperty.call(OP_PERMISSIONS, op)
    ? (OP_PERMISSIONS as Record<string, Permission>)[op]
    : null;
}
