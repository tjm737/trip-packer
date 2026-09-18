import { AppState, User, Trip, Category, PackingItem } from "./types";

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

const AVATAR_COLORS = [
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
 */
async function post<T>(body: unknown, attempt = 0): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/mutate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (attempt === 0) return post<T>(body, 1);
    throw new ApiError("Could not reach the server", 0);
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(detail.error ?? `Request failed (${res.status})`, res.status);
  }

  return (await res.json()) as T;
}

async function mutate(body: unknown): Promise<AppState> {
  const { state } = await post<{ state: AppState }>(body);
  return state;
}

/* ----------------------------------------------------------------- reads */

/** Returns null when the database has no users yet (fresh install). */
export async function fetchState(): Promise<AppState | null> {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new ApiError("Could not load your data", res.status);
  const { state } = (await res.json()) as { state: AppState | null };
  return state;
}

/**
 * Seeds the initial user. There is no server-side "initialize" op because the
 * server cannot invent an id the client has not seen; the client creates the
 * default user and posts it.
 */
export async function initializeRemoteState(): Promise<AppState> {
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
