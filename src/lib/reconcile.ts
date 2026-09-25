/*
 * Local-first reconciliation.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `fetchState()` mirrors every successful server read straight into the offline
 * cache, and `AppContext` applies whatever the server returns as the new state.
 * That is correct only while there is nothing pending. As soon as the offline
 * queue is non-empty the server copy is *older* than the local one: it does not
 * contain the edit still sitting in the queue. Overwriting the cache with it —
 * or rendering it — silently drops an edit the user was explicitly told was
 * saved. That is the "offline edit is silently lost" bug.
 *
 * THE POLICY
 * ----------
 * Server state is the base; pending queued ops are replayed on top of it, in
 * order, in memory, to produce what the UI should actually show and what the
 * cache should hold. This is deliberately NOT last-write-wins per entity in the
 * sense of "whoever has the bigger timestamp": the queue is the set of writes
 * the user performed locally and the server has not yet acknowledged, so every
 * one of them must survive the arrival of any server snapshot. Replaying them
 * over the base is exactly equivalent to the server having already accepted
 * them, which is what the eventual flush will make true.
 *
 * Entities the queue does not mention are taken verbatim from the server, so a
 * change made on another device still shows up. Entities the queue does mention
 * end up with the local value — the local device is the only writer that could
 * know about them.
 *
 * This module is pure and has no browser or CSS dependencies, so it can be unit
 * tested directly.
 */

import type {
  AppState,
  Bag,
  Category,
  PackingItem,
  Reservation,
  Task,
  Trip,
  User,
} from "./types";

type Collection = "users" | "trips" | "categories" | "items" | "tasks" | "reservations";

/*
 * The mutate-op body shapes we need to understand. Kept structurally identical
 * to the union in src/app/api/mutate/route.ts so a body produced there can be
 * replayed here without translation.
 */
type OpBody =
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
  | { op: "state.replace"; state: AppState };

/** Coerces an unknown queued body into the typed union for switching. */
function asOp(body: unknown): OpBody | null {
  if (!body || typeof body !== "object" || typeof (body as { op?: unknown }).op !== "string") {
    return null;
  }
  return body as OpBody;
}

function upsert<T extends { id: string }>(list: T[], entity: T): T[] {
  const idx = list.findIndex((e) => e.id === entity.id);
  if (idx === -1) return [...list, entity];
  const next = list.slice();
  next[idx] = { ...list[idx], ...entity };
  return next;
}

function patch<T extends { id: string }>(list: T[], id: string, updates: Partial<T>): T[] {
  return list.map((e) => (e.id === id ? { ...e, ...updates } : e));
}

/**
 * Applies one mutate-op body to a state, returning a new state.
 *
 * Side effects mirror the server's exact semantics (see /api/mutate): a trip
 * delete cascades to its categories, items and tasks; deleting the active user
 * re-homes to the first remaining user; state.replace swaps everything.
 *
 * Unknown or malformed ops are ignored rather than thrown on, so one bad queue
 * entry cannot make reconciliation — and therefore the whole UI — explode.
 */
export function applyOpToState(state: AppState, body: unknown): AppState {
  const op = asOp(body);
  if (!op) return state;

  switch (op.op) {
    case "user.add":
      return { ...state, users: upsert(state.users, op.user), activeUserId: op.user.id };

    case "user.update":
      return { ...state, users: patch(state.users, op.id, op.updates) };

    case "user.delete": {
      const users = state.users.filter((u) => u.id !== op.id);
      return {
        ...state,
        users,
        activeUserId: state.activeUserId === op.id ? (users[0]?.id ?? "") : state.activeUserId,
      };
    }

    case "trip.create":
      return { ...state, trips: upsert(state.trips, op.trip) };

    case "trip.update":
      return { ...state, trips: patch(state.trips, op.id, op.updates) };

    case "trip.delete":
      // Mirror the database cascade so no reconciliation can resurrect orphans.
      return {
        ...state,
        trips: state.trips.filter((t) => t.id !== op.id),
        categories: state.categories.filter((c) => c.tripId !== op.id),
        items: state.items.filter((i) => i.tripId !== op.id),
        tasks: state.tasks.filter((t) => t.tripId !== op.id),
        reservations: state.reservations.filter((r) => r.tripId !== op.id),
        bags: (state.bags ?? []).filter((b) => b.tripId !== op.id),
      };

    case "category.create":
      return { ...state, categories: upsert(state.categories, op.category) };

    case "category.update":
      return { ...state, categories: patch(state.categories, op.id, op.updates) };

    case "category.delete":
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== op.id),
        items: state.items.filter((i) => i.categoryId !== op.id),
      };

    case "item.create":
      return { ...state, items: upsert(state.items, op.item) };

    case "item.update":
      return { ...state, items: patch(state.items, op.id, op.updates) };

    case "item.delete":
      return { ...state, items: state.items.filter((i) => i.id !== op.id) };

    case "bag.create":
      return { ...state, bags: upsert(state.bags ?? [], op.bag) };

    case "bag.update":
      return { ...state, bags: patch(state.bags ?? [], op.id, op.updates) };

    case "bag.delete":
      /*
       * Deleting a bag does NOT delete its items, and this is the one place in
       * this file that deliberately diverges from category.delete above.
       *
       * A category IS its items -- an item without a category is meaningless,
       * and the packing list is organised by category, so removing one removes
       * the rows. A bag is only a container. An item's existence does not depend
       * on where it happens to be packed, and a user who deletes "the blue
       * suitcase" expects their things to become unpacked, not to vanish from
       * the list. Deleting them here would silently destroy data the user never
       * asked to delete.
       */
      return {
        ...state,
        bags: (state.bags ?? []).filter((b) => b.id !== op.id),
        items: state.items.map((i) => (i.bagId === op.id ? { ...i, bagId: null } : i)),
      };

    case "task.create":
      return { ...state, tasks: upsert(state.tasks, op.task) };

    case "task.update":
      return { ...state, tasks: patch(state.tasks, op.id, op.updates) };

    case "task.delete":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== op.id) };

    case "reservation.create":
      return { ...state, reservations: upsert(state.reservations, op.reservation) };

    case "reservation.update":
      return { ...state, reservations: patch(state.reservations, op.id, op.updates) };

    case "reservation.delete":
      return { ...state, reservations: state.reservations.filter((r) => r.id !== op.id) };

    case "reservation.reorder": {
      const ids = op.orderedIds;
      const rank = new Map(ids.map((id, i) => [id, i]));
      return {
        ...state,
        reservations: state.reservations.map((r) =>
          r.tripId === op.tripId && rank.has(r.id) ? { ...r, order: rank.get(r.id)! } : r
        ),
      };
    }

    case "state.replace":
      // The newest full snapshot in the queue wins wholesale; anything queued
      // before it is already contained in it.
      return op.state;

    default:
      return state;
  }
}

/**
 * Replays a list of queued op bodies over a base state, in order.
 *
 * Exported separately from `reconcile` so a caller that has already read the
 * queue can apply it without re-deriving the bodies.
 */
export function replayOps(base: AppState, bodies: unknown[]): AppState {
  return bodies.reduce<AppState>((acc, body) => applyOpToState(acc, body), base);
}

/**
 * THE reconciliation entry point.
 *
 * Given the authoritative server state and whatever is still queued locally,
 * returns the state the client should render and cache. When nothing is pending
 * this is exactly the server state. When ops are pending, they are replayed over
 * it, so an offline edit can never be clobbered by a server snapshot that has
 * not seen it yet.
 */
export function reconcile(serverState: AppState, pendingBodies: unknown[]): AppState {
  if (pendingBodies.length === 0) return serverState;
  return replayOps(serverState, pendingBodies);
}
