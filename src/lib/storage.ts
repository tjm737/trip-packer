import {
  AppState,
  User,
  Trip,
  Category,
  PackingItem,
  Task,
  Reservation,
  ReservationType,
} from "./types";
import { compareByDate, daysUntilDate, isValidDate } from "./dates";
import { readCachedState, writeCachedState } from "./offlineCache";
import { clearQueue, enqueueOp, listQueuedOps, removeQueuedOp } from "./offlineQueue";

/*
 * Client-side API wrapper.
 *
 * This used to be a localStorage read-modify-write layer. It is now a thin
 * client over /api/state and /api/mutate, which persist to SQLite.
 *
 * Every mutation posts the entity to the server and returns the authoritative
 * state the server actually stored. Callers surface that state directly rather
 * than re-deriving it locally, so a failed write cannot leave the UI showing
 * data that was never persisted.
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

/*
 * The avatar palette. Exported so the profile editor's colour picker offers
 * exactly the colours the auto-assignment can produce - a picker with its own
 * hardcoded list would drift the moment either side changed.
 */
export const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-500",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function createDefaultUser(): User {
  const id = generateId();
  return {
    id,
    name: "You",
    avatarColor: AVATAR_COLORS[hashString(id) % AVATAR_COLORS.length],
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------- transport */

/**
 * Mutations that fail to reach the server are retried once, because a dev
 * server restart (or a brief HMR blip) would otherwise silently drop a change
 * the user just made. A 4xx is never retried — those are deterministic.
 *
 * If it still cannot reach the server the op is queued for replay rather than
 * thrown away. `label` is what the offline banner shows; callers that omit it
 * get a generic one, which is still better than losing the write.
 */
async function post<T>(body: unknown, attempt = 0, label = "Change"): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (attempt === 0) return post<T>(body, 1, label);
    // Out of retries and still unreachable: this is offline, not a bad request.
    enqueueOp(body, label);
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(detail.error ?? `Request failed (${res.status})`, res.status);
  }

  return (await res.json()) as T;
}

/** Marker string so callers can tell "queued for later" from a real failure. */
export const OFFLINE_MESSAGE = "You're offline — this change is saved and will sync";

/**
 * Queues a mutation by hand. Used where an optimistic UI change is made for an
 * op we cannot even attempt (e.g. offline at the moment of the click).
 */
export function queueMutation(body: unknown, label: string): void {
  enqueueOp(body, label);
}

/**
 * Replays queued mutations in order, stopping at the first non-connectivity
 * failure so dependent ops are not applied out of order or against state that
 * does not exist.
 *
 * Returns the authoritative state from the last successful op, or null when
 * nothing was replayed — the caller keeps its current state in that case.
 */
export async function flushOfflineQueue(): Promise<AppState | null> {
  const pending = listQueuedOps();
  if (pending.length === 0) return null;

  let latest: AppState | null = null;

  for (const op of pending) {
    try {
      const { state } = await post<{ state: AppState }>(op.body, 0, op.label);
      latest = state;
      removeQueuedOp(op.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Still offline (and post() has re-queued a fresh copy) — stop and
        // leave the rest for the next reconnect.
        break;
      }
      // A deterministic rejection: this op will never succeed. Drop it and
      // keep going, otherwise one bad write blocks the queue forever.
      removeQueuedOp(op.id);
    }
  }

  return latest;
}

/** Discards every queued mutation. Exposed for a "discard pending changes" action. */
export function discardOfflineQueue(): void {
  clearQueue();
}

async function mutate(body: unknown, label?: string): Promise<AppState> {
  const { state } = await post<{ state: AppState }>(body, 0, label);
  return state;
}

/* ----------------------------------------------------------------- reads */

/**
 * Returns null when the database has no users yet (fresh install).
 *
 * On success the result is mirrored into the offline cache. If the request
 * fails because there is no network, the cached copy is returned instead of
 * throwing, so a cold start offline still renders the itinerary. A genuine
 * server error (5xx) is not masked by the cache — that is a real fault the
 * user should see, not a connectivity problem.
 */
export async function fetchState(): Promise<AppState | null> {
  let res: Response;
  try {
    res = await fetch("/api/state", { cache: "no-store" });
  } catch {
    const cached = readCachedState();
    if (cached) return cached.state;
    throw new ApiError("You're offline and no saved copy is available", 0);
  }

  if (!res.ok) throw new ApiError("Could not load your data", res.status);

  const { state } = (await res.json()) as { state: AppState | null };
  if (state) writeCachedState(state);
  return state;
}

/**
 * Seeds the initial user. There is no server-side "initialize" op because the
 * server cannot invent an id the client has not seen; the client creates the
 * default user and posts it.
 *
 * Cannot work offline: seeding only makes sense against a database that is
 * actually reachable, and inventing a user locally would risk a second id on
 * top of one that already exists.
 */
export async function initializeRemoteState(): Promise<AppState> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ApiError("You're offline — connect once to set up your account", 0);
  }
  const user = createDefaultUser();
  return mutate({ op: "user.add", name: user.name, user });
}

/* --------------------------------------------------------------- actions */

export async function addUser(name: string): Promise<{ state: AppState; user: User }> {
  const user = createDefaultUser();
  user.name = name;
  const state = await mutate({ op: "user.add", name, user });
  return { state, user };
}

export async function updateUser(id: string, updates: Partial<User>): Promise<AppState> {
  return mutate({ op: "user.update", id, updates });
}

export async function deleteUser(id: string): Promise<AppState> {
  return mutate({ op: "user.delete", id });
}

export async function switchUser(userId: string): Promise<AppState> {
  return mutate({ op: "user.switch", id: userId });
}

export async function createTrip(
  userId: string,
  data: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    notes: string;
    icon: string;
  }
): Promise<{ state: AppState; trip: Trip; categories: Category[]; items: PackingItem[] }> {
  const now = new Date().toISOString();
  const trip: Trip = {
    id: generateId(),
    userId,
    name: data.name,
    destination: data.destination,
    startDate: data.startDate,
    endDate: data.endDate,
    notes: data.notes,
    icon: data.icon,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  const defaultCategories: { name: string; icon: string }[] = [
    { name: "Clothing", icon: "👕" },
    { name: "Toiletries", icon: "🧴" },
    { name: "Electronics", icon: "🔌" },
    { name: "Documents", icon: "📄" },
    { name: "Money", icon: "💳" },
    { name: "Miscellaneous", icon: "📦" },
  ];

  const defaultItems: Record<string, Array<{ name: string; quantity: number; icon: string }>> = {
    Clothing: [
      { name: "T-shirts", quantity: 5, icon: "👕" },
      { name: "Underwear", quantity: 7, icon: "🩲" },
      { name: "Socks", quantity: 7, icon: "🧦" },
      { name: "Pants/Shorts", quantity: 3, icon: "👖" },
      { name: "Sleepwear", quantity: 2, icon: "👘" },
      { name: "Jacket/Outerwear", quantity: 1, icon: "🧥" },
      { name: "Shoes", quantity: 2, icon: "👟" },
    ],
    Toiletries: [
      { name: "Toothbrush", quantity: 1, icon: "🪥" },
      { name: "Toothpaste", quantity: 1, icon: "🪥" },
      { name: "Shampoo", quantity: 1, icon: "🧴" },
      { name: "Deodorant", quantity: 1, icon: "🧴" },
      { name: "Sunscreen", quantity: 1, icon: "☀️" },
      { name: "Medications", quantity: 1, icon: "💊" },
      { name: "Razor", quantity: 1, icon: "🪒" },
    ],
    Electronics: [
      { name: "Phone", quantity: 1, icon: "📱" },
      { name: "Phone Charger", quantity: 1, icon: "🔌" },
      { name: "Headphones", quantity: 1, icon: "🎧" },
      { name: "Laptop", quantity: 1, icon: "💻" },
      { name: "Travel Adapter", quantity: 1, icon: "🔌" },
    ],
    Documents: [
      { name: "Passport", quantity: 1, icon: "📘" },
      { name: "Boarding Passes", quantity: 1, icon: "🎫" },
      { name: "Hotel Confirmations", quantity: 1, icon: "🏨" },
    ],
    Money: [
      { name: "Local Currency", quantity: 1, icon: "💵" },
      { name: "Credit Card", quantity: 1, icon: "💳" },
    ],
    Miscellaneous: [{ name: "Umbrella", quantity: 1, icon: "☂️" }],
  };

  const categories: Category[] = defaultCategories.map((c, i) => ({
    id: generateId(),
    tripId: trip.id,
    name: c.name,
    icon: c.icon,
    order: i,
  }));

  const items: PackingItem[] = [];
  for (const cat of categories) {
    const defs = defaultItems[cat.name] ?? [];
    defs.forEach((d, i) => {
      items.push({
        id: generateId(),
        tripId: trip.id,
        categoryId: cat.id,
        name: d.name,
        quantity: d.quantity,
        checked: false,
        icon: d.icon,
        order: i,
      });
    });
  }

  // The whole tree goes in as one state.replace so a new trip can never be
  // persisted half-built (trip without its categories, or vice versa).
  const current = await fetchState();
  const base: AppState = current ?? {
    users: [],
    activeUserId: userId,
    trips: [],
    categories: [],
    items: [],
    tasks: [],
    reservations: [],
  };

  const state = await mutate({
    op: "state.replace",
    state: {
      ...base,
      trips: [...base.trips, trip],
      categories: [...base.categories, ...categories],
      items: [...base.items, ...items],
    },
  });

  return { state, trip, categories, items };
}

export async function updateTrip(id: string, data: Partial<Trip>): Promise<AppState> {
  return mutate({ op: "trip.update", id, updates: data });
}

export async function archiveTrip(id: string, archived: boolean): Promise<AppState> {
  return mutate({ op: "trip.update", id, updates: { archived } });
}

export async function deleteTrip(id: string): Promise<AppState> {
  return mutate({ op: "trip.delete", id });
}

export async function createCategory(
  tripId: string,
  name: string,
  icon: string
): Promise<{ state: AppState; category: Category }> {
  const current = await fetchState();
  const order =
    current?.categories.filter((c) => c.tripId === tripId).length ?? 0;
  const category: Category = { id: generateId(), tripId, name, icon, order };
  const state = await mutate({ op: "category.create", category });
  return { state, category };
}

export async function updateCategory(
  id: string,
  data: { name?: string; icon?: string }
): Promise<AppState> {
  return mutate({ op: "category.update", id, updates: data });
}

export async function deleteCategory(id: string): Promise<AppState> {
  return mutate({ op: "category.delete", id });
}

export async function createItem(
  tripId: string,
  categoryId: string,
  name: string,
  icon: string,
  quantity: number
): Promise<{ state: AppState; item: PackingItem }> {
  const current = await fetchState();
  const order = current?.items.filter((i) => i.categoryId === categoryId).length ?? 0;
  const item: PackingItem = {
    id: generateId(),
    tripId,
    categoryId,
    name,
    quantity,
    checked: false,
    icon,
    order,
  };
  const state = await mutate({ op: "item.create", item });
  return { state, item };
}

export async function updateItem(
  id: string,
  data: { name?: string; quantity?: number; checked?: boolean; icon?: string }
): Promise<AppState> {
  return mutate({ op: "item.update", id, updates: data });
}

export async function deleteItem(id: string): Promise<AppState> {
  return mutate({ op: "item.delete", id });
}

/* ----------------------------------------------------------------- tasks */

export async function createTask(
  tripId: string,
  title: string,
  dueDate: string
): Promise<{ state: AppState; task: Task }> {
  const current = await fetchState();
  const order = current?.tasks.filter((t) => t.tripId === tripId).length ?? 0;
  const task: Task = {
    id: generateId(),
    tripId,
    title,
    done: false,
    // Optional deadline. Empty string, never a defaulted "today" — a task
    // with no real deadline must not appear overdue the moment it is created.
    dueDate,
    notes: "",
    order,
    createdAt: new Date().toISOString(),
  };
  const state = await mutate({ op: "task.create", task });
  return { state, task };
}

export async function updateTask(
  id: string,
  data: { title?: string; done?: boolean; dueDate?: string; notes?: string }
): Promise<AppState> {
  return mutate({ op: "task.update", id, updates: data });
}

export async function deleteTask(id: string): Promise<AppState> {
  return mutate({ op: "task.delete", id });
}

/* ----------------------------------------------------------- reservations */

export type ReservationDraft = {
  type: ReservationType;
  title: string;
  confirmation?: string;
  location?: string;
  locationTo?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  cost?: string;
  notes?: string;
  /** Defaults to true: a booking you are adding by hand is one you have made. */
  confirmed?: boolean;
};

/**
 * Every detail field defaults to "" rather than being omitted, so a partially
 * filled booking still round-trips as a complete row. `type` and `title` are
 * the only required inputs — you can always add the confirmation number later.
 */
export async function createReservation(
  tripId: string,
  draft: ReservationDraft
): Promise<{ state: AppState; reservation: Reservation }> {
  const current = await fetchState();
  /*
   * Append past the current maximum rather than using the booking count.
   *
   * The count is wrong whenever the stored orders are not already a dense
   * 0..n-1 run, which happens as soon as a row is deleted: three bookings
   * ordered [0,1,2] become a count of 2 after one is removed, colliding with
   * the booking already holding 2. Two rows sharing an order makes the sequence
   * ambiguous, and the tie then resolves by id rather than by anything the user
   * chose. Taking max+1 keeps each new booking strictly after the existing ones.
   */
  const existing = current?.reservations.filter((r) => r.tripId === tripId) ?? [];
  const order =
    existing.reduce(
      (max, r) => (Number.isFinite(r.order) ? Math.max(max, r.order) : max),
      -1
    ) + 1;
  const reservation: Reservation = {
    id: generateId(),
    tripId,
    type: draft.type,
    title: draft.title.trim(),
    confirmation: draft.confirmation?.trim() ?? "",
    location: draft.location?.trim() ?? "",
    locationTo: draft.locationTo?.trim() ?? "",
    startDate: draft.startDate ?? "",
    startTime: draft.startTime ?? "",
    endDate: draft.endDate ?? "",
    endTime: draft.endTime ?? "",
    cost: draft.cost?.trim() ?? "",
    notes: draft.notes?.trim() ?? "",
    order,
    createdAt: new Date().toISOString(),
    confirmed: draft.confirmed ?? true,
  };
  const state = await mutate({ op: "reservation.create", reservation });
  return { state, reservation };
}

export async function updateReservation(
  id: string,
  data: Partial<Omit<Reservation, "id" | "tripId" | "type" | "createdAt">>
): Promise<AppState> {
  return mutate({ op: "reservation.update", id, updates: data });
}

export async function deleteReservation(id: string): Promise<AppState> {
  return mutate({ op: "reservation.delete", id });
}

/**
 * Persist a manual itinerary order for a trip.
 *
 * Takes the reservation ids in their new order; the server assigns positions
 * by array index within a single transaction.
 */
export async function reorderReservations(
  tripId: string,
  orderedIds: string[]
): Promise<AppState> {
  return mutate({ op: "reservation.reorder", tripId, orderedIds });
}

/* -------------------------------------------------------------- selectors */

export function getItemProgress(tripId: string, items: PackingItem[]) {
  const tripItems = items.filter((i) => i.tripId === tripId);
  const checked = tripItems.filter((i) => i.checked).length;
  const total = tripItems.length;
  return {
    checked,
    total,
    percent: total === 0 ? 0 : Math.round((checked / total) * 100),
  };
}

export function getCategoriesForTrip(tripId: string, categories: Category[]): Category[] {
  return categories
    .filter((c) => c.tripId === tripId)
    .sort((a, b) => a.order - b.order);
}

export function getItemsForCategory(categoryId: string, items: PackingItem[]): PackingItem[] {
  return items
    .filter((i) => i.categoryId === categoryId)
    .sort((a, b) => a.order - b.order);
}

/* ------------------------------------------------------------ tasks */

export type TaskStatus = "overdue" | "due-soon" | "upcoming" | "no-date";

/** Within this many days of the deadline, a task counts as "due soon". */
const DUE_SOON_DAYS = 7;

/**
 * Classify a task's deadline relative to today.
 *
 * Delegates the arithmetic to `daysUntilDate` so the date-only string is parsed
 * as a local date. `new Date("2026-09-17")` is UTC midnight and would report an
 * overdue task a day early for anyone west of UTC.
 */
export function getTaskStatus(dueDate: string, done: boolean): TaskStatus {
  if (done) return "upcoming";

  const days = daysUntilDate(dueDate);
  if (days === null) return "no-date";

  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "upcoming";
}

/** Whole days until a deadline; null when there is no valid deadline. */
export { daysUntilDate as daysUntilDue };

/**
 * Tasks for a trip in display order: open tasks first, and within those the
 * soonest deadline first (undated last). Done tasks sink to the bottom so the
 * list reads as a checklist of what is still outstanding.
 */
export function getTasksForTrip(tripId: string, tasks: Task[]): Task[] {
  // Rank by urgency, with completion as the LAST tiebreak rather than the
  // first sort key. Sorting done-first would sink a completed-but-late task
  // below tasks that are not yet due, hiding exactly the deadlines this
  // feature exists to surface. Within the active buckets, a whole bucket of
  // finished work still clusters below unfinished work because `done` breaks
  // ties before the date comparison.
  const rank: Record<TaskStatus, number> = {
    overdue: 0,
    "due-soon": 1,
    upcoming: 2,
    "no-date": 3,
  };

  return tasks
    .filter((t) => t.tripId === tripId)
    .sort((a, b) => {
      const ra = rank[getTaskStatus(a.dueDate, a.done)];
      const rb = rank[getTaskStatus(b.dueDate, b.done)];
      if (ra !== rb) return ra - rb;

      // Same urgency bucket: unfinished before finished.
      if (a.done !== b.done) return a.done ? 1 : -1;

      // Same bucket and both dated: earliest deadline first.
      if (isValidDate(a.dueDate) && isValidDate(b.dueDate)) {
        const cmp = compareByDate(a.dueDate, b.dueDate);
        if (cmp !== 0) return cmp;
      }
      // Stable fallback for undated or identical-date tasks.
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

/* ------------------------------------------------------ reservations */

/**
 * Reservations in itinerary order: earliest first, undated ones last.
 *
 * Unlike tasks, there is no "done" state and no urgency colouring — a booking
 * is either made or it isn't, and what matters is when it happens. Undated
 * entries sink to the bottom because a reservation's date is the whole point;
 * one missing a date is a record still being filled in, not something that
 * should push a confirmed flight down the list.
 */
export function getReservationsForTrip(tripId: string, reservations: Reservation[]): Reservation[] {
  return reservations
    .filter((r) => r.tripId === tripId)
    .sort((a, b) => {
      const aDated = isValidDate(a.startDate);
      const bDated = isValidDate(b.startDate);
      if (aDated && bDated) {
        const cmp = compareByDate(a.startDate, b.startDate);
        if (cmp !== 0) return cmp;
        // Same day: order by clock time so a 06:00 flight precedes a 14:00 one.
        if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      } else if (aDated !== bDated) {
        return aDated ? -1 : 1;
      }
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export function getTaskProgress(tripId: string, tasks: Task[]) {
  const tripTasks = tasks.filter((t) => t.tripId === tripId);
  const done = tripTasks.filter((t) => t.done).length;
  const total = tripTasks.length;
  const overdue = tripTasks.filter((t) => getTaskStatus(t.dueDate, t.done) === "overdue").length;
  return {
    done,
    total,
    overdue,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
