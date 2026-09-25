import { NextResponse } from "next/server";

import { readState, tx } from "@/lib/db";
import {
  assertCanWriteTrip,
  canMutateEntityById,
  scopeStateForUser,
} from "@/lib/access";
import type { EntityKind } from "@/lib/access";
import { permissionFor } from "@/lib/opPermissions";
import type { ActingUser } from "@/lib/session";
import type {
  AppState,
  Bag,
  Category,
  PackingItem,
  Reservation,
  Task,
  Trip,
  User,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/*
 * POST /api/mutate — single write endpoint.
 *
 * Rationale for one endpoint instead of REST-per-entity: the client already
 * speaks in terms of a normalized in-memory store, and the previous storage
 * layer exposed exactly these operations. Mirroring that shape keeps the
 * AppContext action methods as thin wrappers rather than a rewrite.
 *
 * Every handler returns the full fresh state so the client never has to guess
 * what the server actually persisted — this is what makes the optimistic
 * update in AppContext safe to reconcile.
 *
 * AUTHORISATION MODEL
 *
 * The acting user comes from the session, never from the body. There is no
 * `userId` field in any op payload and no `user.switch` — an earlier version of
 * this app let the client name the active user, which is not authentication.
 *
 * Each op declares its requirement in src/lib/opPermissions.ts. That table is
 * enforced HERE, once, before the switch runs, so an operation cannot be
 * dispatched without passing its guard. A test asserts every op in the Body
 * union appears in the table, so adding an op without a permission fails the
 * suite rather than shipping open.
 *
 * The two authorisation shapes, and why they differ:
 *
 *   create ops pass the parent trip in the payload (the entity does not exist
 *   yet). Safe because the guard checks BOTH that the user may write that trip
 *   AND that the payload is internally consistent.
 *
 *   byId ops name an existing entity by id alone. The owning trip is resolved
 *   server-side from the entity, so a caller cannot smuggle an id across an
 *   account boundary by pairing it with a trip id of their own.
 */

type Body =
  | { op: "user.add"; name: string; user: User }
  | { op: "user.update"; id: string; updates: Partial<User> }
  | { op: "user.delete"; id: string }
  | { op: "trip.create"; trip: Trip }
  | { op: "trip.update"; id: string; updates: Partial<Trip> }
  | { op: "trip.delete"; id: string }
  | { op: "category.create"; category: Category }
  | { op: "category.update"; id: string; updates: Partial<Category> }
  | { op: "category.delete"; id: string }
  | { op: "item.create"; item: PackingItem }
  | { op: "item.update"; id: string; updates: Partial<PackingItem> }
  | { op: "item.delete"; id: string }
  | { op: "bag.create"; bag: Bag }
  | { op: "bag.update"; id: string; updates: Partial<Bag> }
  | { op: "bag.delete"; id: string }
  | { op: "task.create"; task: Task }
  | { op: "task.update"; id: string; updates: Partial<Task> }
  | { op: "task.delete"; id: string }
  | { op: "reservation.create"; reservation: Reservation }
  | { op: "reservation.update"; id: string; updates: Partial<Reservation> }
  | { op: "reservation.reorder"; tripId: string; orderedIds: string[] }
  | { op: "reservation.delete"; id: string }
  | { op: "state.replace"; state: NonNullable<ReturnType<typeof readState>> };

/** The authenticated user, resolved by the session layer. */

/*
 * Pull the parent trip id out of a create payload.
 *
 * Returns null for a payload that does not name a parent, which the caller
 * treats as a validation failure rather than "no restriction".
 */
function parentTripIdOf(body: Body): string | null {
  switch (body.op) {
    case "category.create":
      return body.category?.tripId ?? null;
    case "item.create":
      return body.item?.tripId ?? null;
    case "task.create":
      return body.task?.tripId ?? null;
    case "reservation.create":
      return body.reservation?.tripId ?? null;
    case "bag.create":
      return body.bag?.tripId ?? null;
    case "reservation.reorder":
      return body.tripId ?? null;
    default:
      return null;
  }
}

/** The bare entity id a byId op acts on. */
function entityIdOf(body: Body): string | null {
  if ("id" in body && typeof body.id === "string") return body.id;
  return null;
}

/**
 * The entity kind a byId op acts on, from its op name prefix.
 *
 * This is a whitelist, not a parse-and-trust: an op whose prefix is not named
 * here returns null, and the caller treats null as "cannot resolve a parent
 * trip", which fails closed. Adding a bag case is what lets bag.update and
 * bag.delete be authorised at all -- without it they would 403 for everyone,
 * including the trip's owner, which reads as a permissions bug rather than a
 * missing case.
 */
function entityKindOf(body: Body): EntityKind | null {
  const prefix = body.op.split(".")[0];
  if (
    prefix === "trip" ||
    prefix === "category" ||
    prefix === "item" ||
    prefix === "task" ||
    prefix === "reservation" ||
    prefix === "bag"
  ) {
    return prefix;
  }
  return null;
}

/**
 * A mutation outcome.
 *
 * Declared as a named alias rather than written inline on the function, because
 * an inline union of object literals does not give TypeScript a discriminant to
 * narrow on at the call site — `if (!result.ok)` would not narrow `result` to the
 * error branch, and the route would not compile.
 */
export type MutationResult =
  | { ok: true; state: unknown }
  | { ok: false; status: number; error: string };

/**
 * Apply an operation.
 *
 * Exported so it can be driven directly from tests with an explicit acting
 * user, without going through cookie parsing. The HTTP wrapper below is then a
 * thin concern-layered shell around this, which keeps the authorisation tests
 * fast and free of session plumbing.
 */
export function applyMutation(
  body: Body,
  actor: ActingUser,
  deps: {
    readState: typeof readState;
    tx: typeof tx;
  } = { readState, tx }
): MutationResult {
  const { tx: t } = deps;

  const permission = permissionFor(body.op);
  if (!permission) {
    // Unknown ops are refused, never defaulted. Note this is also the path a
    // client hits if it sends an op this build does not know.
    return { ok: false, status: 400, error: "Unknown op" };
  }

  const full = deps.readState();
  if (!full) {
    return { ok: false, status: 500, error: "No state" };
  }

  /* ---------------------------------------------------------------- */
  /* The single authorisation chokepoint.                             */
  /* ---------------------------------------------------------------- */

  switch (permission.kind) {
    case "admin": {
      // Account administration. Closed registration: only an owner may mint
      // accounts, which is what makes "the user creates all accounts" a
      // server-side property rather than a UI omission.
      if (!actor.isOwner) {
        return { ok: false, status: 403, error: "Owner only" };
      }
      break;
    }

    case "self": {
      // trip.create is owned by whoever creates it. Nothing to check beyond
      // having an identity, which the caller guarantees.
      break;
    }

    case "selfOrAdmin": {
      /*
       * Account records are not trip-scoped, so there is no entity to resolve
       * through canMutateEntityById — the target has to be checked here against
       * the payload's id.
       *
       * Without this, relaxing user.update from admin would let any signed-in
       * user rename any other account by passing its id, and the store layer
       * would not catch it: updateUser's allow-list constrains which COLUMNS can
       * be written, not which ROW.
       *
       * user.delete is checked the same way for the same reason: relaxing it to
       * selfOrAdmin (which 5.1.1(v) requires) would otherwise let any signed-in
       * user delete any other account by passing its id.
       */
      const targetUserId =
        body.op === "user.update" || body.op === "user.delete" ? body.id : null;
      if (!targetUserId) {
        return { ok: false, status: 400, error: "Missing user id" };
      }
      if (targetUserId !== actor.id && !actor.isOwner) {
        return { ok: false, status: 403, error: "Not permitted on that user" };
      }
      break;
    }

    case "session": {
      break;
    }

    case "create": {
      const tripId = parentTripIdOf(body);
      if (!tripId) {
        return { ok: false, status: 400, error: "Missing parent tripId" };
      }
      if (!assertCanWriteTrip(full, actor.id, tripId)) {
        return { ok: false, status: 403, error: "Not permitted on that trip" };
      }

      /*
       * For an item, the parent category must also live under the same trip.
       * Otherwise a caller could create an item inside their own trip but
       * pointing at a victim's category id.
       */
      if (body.op === "item.create" && body.item?.categoryId) {
        const cat = (full.categories ?? []).find((c) => c.id === body.item.categoryId);
        if (!cat || cat.tripId !== tripId) {
          return { ok: false, status: 403, error: "Category is not on that trip" };
        }
      }

      /*
       * Reorder names a trip and a list of reservation ids. Every id must
       * belong to that trip, or a caller could reorder a victim's reservations
       * by naming their own trip.
       */
      if (body.op === "reservation.reorder") {
        if (!Array.isArray(body.orderedIds)) {
          return { ok: false, status: 400, error: "orderedIds required" };
        }
        for (const id of body.orderedIds) {
          if (!canMutateEntityById(full, actor.id, "reservation", id)) {
            return { ok: false, status: 403, error: "Not permitted on that reservation" };
          }
        }
      }
      break;
    }

    case "byId": {
      const entityId = entityIdOf(body);
      if (!entityId) {
        return { ok: false, status: 400, error: "Missing id" };
      }
      const kind = entityKindOf(body);
      if (!kind) {
        return { ok: false, status: 400, error: "Unknown entity kind" };
      }
      // Resolved server-side: the owning trip comes from the entity, not from
      // the caller. See access.ts for why this is not canWriteEntityOfTrip.
      if (!canMutateEntityById(full, actor.id, kind, entityId)) {
        return { ok: false, status: 403, error: "Not permitted" };
      }
      break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Dispatch. Guards have already passed.                            */
  /* ---------------------------------------------------------------- */

  try {
    switch (body.op) {
      case "user.add": {
        /*
         * The payload's user is a profile record; credentials come from the
         * create-account CLI. Forcing the id here would break that flow, so the
         * id is taken from the payload but the op is owner-gated above.
         */
        t.insertUser(body.user);
        break;
      }

      case "user.update":
        t.updateUser(body.id, body.updates);
        break;

      case "user.delete": {
        const current = deps.readState();
        const remaining = (current?.users ?? []).filter((u) => u.id !== body.id);
        // Never delete the last account: the app has no user-less state, and an
        // instance with zero accounts cannot be recovered through the UI.
        if (remaining.length === 0) {
          return { ok: false, status: 400, error: "Cannot delete the last user" };
        }
        t.deleteUser(body.id);
        /*
         * Deleting an account must also kill its sessions, or the deleted user
         * keeps a working cookie until it expires. Done here rather than in
         * tx.deleteUser so the cascade is visible at the call site.
         */
        t.deleteSessionsForUser(body.id);
        break;
      }

      case "trip.create": {
        /*
         * Ownership is FORCED to the acting user. Trusting body.trip.userId
         * would let a caller create a trip owned by someone else, which then
         * appears in that user's account.
         */
        t.insertTrip({ ...body.trip, userId: actor.id });
        break;
      }

      case "trip.update":
        /*
         * userId is stripped from updates so a trip cannot be reassigned to
         * another account by a writer who is not its owner. (Editors may write
         * the trip's contents; they may not transfer it.)
         */
        t.updateTrip(body.id, stripUserId(body.updates));
        break;

      case "trip.delete":
        t.deleteTrip(body.id);
        break;

      case "category.create":
        t.insertCategory(body.category);
        break;

      case "category.update":
        t.updateCategory(body.id, body.updates);
        break;

      case "category.delete":
        t.deleteCategory(body.id);
        break;

      case "item.create":
        t.insertItem(body.item);
        break;

      case "item.update":
        t.updateItem(body.id, body.updates);
        break;

      case "item.delete":
        t.deleteItem(body.id);
        break;

      case "task.create":
        t.insertTask(body.task);
        break;

      case "task.update":
        t.updateTask(body.id, body.updates);
        break;

      case "task.delete":
        t.deleteTask(body.id);
        break;

      case "reservation.create":
        t.insertReservation(body.reservation);
        break;

      case "reservation.update":
        t.updateReservation(body.id, body.updates);
        break;

      case "reservation.reorder":
        t.setReservationOrder(body.tripId, body.orderedIds);
        break;

      case "reservation.delete":
        t.deleteReservation(body.id);
        break;

      case "bag.create":
        t.insertBag(body.bag);
        break;

      case "bag.update":
        t.updateBag(body.id, body.updates);
        break;

      case "bag.delete":
        t.deleteBag(body.id);
        break;

      case "state.replace": {
        /*
         * state.replace rewrites the whole dataset, so it is admin-only AND
         * narrowed to the acting user's own visible rows. Without the narrowing
         * a full-snapshot push from the offline queue would delete every other
         * account's data — the sync path and the multi-user path have to
         * coexist, and the snapshot is a view of the pusher's own data, not a
         * claim about everyone else's.
         *
         * The incoming snapshot is scoped to the actor, then only the actor's
         * own rows are replaced. Rows belonging to others are left untouched.
         */
        const scoped = scopeStateForUser(body.state, actor.id);
        if (!scoped) {
          return { ok: false, status: 403, error: "Not permitted" };
        }
        t.replaceOwnedRows(
      actor.id,
      // scopeStateForUser's return type is deliberately structural (AccessState),
      // because it is also used against small test fixtures. Here the input is a
      // real AppState from the database, so the rows genuinely are full rows and
      // the widening is safe. This cast is the single point where that is
      // asserted.
      scoped as unknown as Pick<
        AppState,
        "trips" | "categories" | "items" | "tasks" | "reservations" | "bags"
      >
    );
        break;
      }
    }

    // Scope the response to the acting user. The client must never receive rows
    // it is not allowed to see, even as a side effect of its own write.
    const fresh = deps.readState();
    if (!fresh) {
      return { ok: false, status: 500, error: "No state" };
    }
    return { ok: true, state: scopeStateForUser(fresh, actor.id) };
  } catch (err) {
    console.error(`[api/mutate] ${body.op} failed:`, err);
    return { ok: false, status: 500, error: "Mutation failed" };
  }
}

/**
 * Remove `userId` from a trip update payload.
 *
 * Ownership transfer is not supported: an editor may change a trip's contents,
 * and only the owner owns it. Stripping the field makes an attempt a silent
 * no-op rather than an error, matching how the other partial updates behave.
 */
function stripUserId<T extends { userId?: unknown }>(updates: T): T {
  if (!updates || typeof updates !== "object") return updates;
  const { userId: _ignored, ...rest } = updates;
  return rest as T;
}

/* ------------------------------------------------------------------ */
/* HTTP shell                                                          */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  /*
   * The acting user is resolved by the session layer. Until that is wired in,
   * this returns 401 for every request rather than falling back to a
   * client-supplied identity — failing closed is the only safe interim state,
   * because a fallback here would be an auth bypass that looks like working
   * code.
   */
  const { getActingUser } = await import("@/lib/session");
  const actor = await getActingUser();
  if (!actor) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = applyMutation(body, actor);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ state: result.state });
}
