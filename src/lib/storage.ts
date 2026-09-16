import { AppState, User, Trip, Category, PackingItem } from "./types";

const STORAGE_KEY = "trip-packer-data";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
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

export function createDefaultUser(): User {
  return {
    id: generateId(),
    name: "You",
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: new Date().toISOString(),
  };
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function initializeState(): AppState {
  const existing = loadState();
  if (existing) return existing;

  const user = createDefaultUser();
  return {
    users: [user],
    activeUserId: user.id,
    trips: [],
    categories: [],
    items: [],
  };
}

export function addUser(name: string): User {
  const state = loadState() ?? initializeState();
  const user = createDefaultUser();
  user.name = name;
  state.users.push(user);
  state.activeUserId = user.id;
  saveState(state);
  return user;
}

export function updateUser(id: string, updates: Partial<User>): void {
  const state = loadState();
  if (!state) return;
  const user = state.users.find((u) => u.id === id);
  if (user) {
    Object.assign(user, updates);
    saveState(state);
  }
}

export function deleteUser(id: string): void {
  const state = loadState();
  if (!state || state.users.length <= 1) return;
  state.users = state.users.filter((u) => u.id !== id);
  if (state.activeUserId === id) {
    state.activeUserId = state.users[0]?.id ?? "";
  }
  state.trips = state.trips.filter((t) => t.userId !== id);
  state.categories = state.categories.filter((c) =>
    state.trips.some((t) => t.id === c.tripId)
  );
  state.items = state.items.filter((i) =>
    state.trips.some((t) => t.id === i.tripId)
  );
  saveState(state);
}

export function switchUser(userId: string): void {
  const state = loadState();
  if (!state) return;
  state.activeUserId = userId;
  saveState(state);
}

export function createTrip(userId: string, data: {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  notes: string;
  icon: string;
}): Trip {
  const state = loadState() ?? initializeState();
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
  state.trips.push(trip);

  const defaultCategories: { name: string; icon: string }[] = [
    { name: "Clothing", icon: "👕" },
    { name: "Toiletries", icon: "🧴" },
    { name: "Electronics", icon: "🔌" },
    { name: "Documents", icon: "📄" },
    { name: "Money", icon: "💳" },
    { name: "Miscellaneous", icon: "📦" },
  ];

  const defaultItems: Record<string, Array<{ name: string; quantity: number; icon: string }>> = {
    "Clothing": [
      { name: "T-shirts", quantity: 5, icon: "👕" },
      { name: "Underwear", quantity: 7, icon: "🩲" },
      { name: "Socks", quantity: 7, icon: "🧦" },
      { name: "Pants/Shorts", quantity: 3, icon: "👖" },
      { name: "Sleepwear", quantity: 2, icon: "👘" },
      { name: "Jacket/Outerwear", quantity: 1, icon: "🧥" },
      { name: "Shoes", quantity: 2, icon: "👟" },
    ],
    "Toiletries": [
      { name: "Toothbrush", quantity: 1, icon: "🪥" },
      { name: "Toothpaste", quantity: 1, icon: "🪥" },
      { name: "Shampoo", quantity: 1, icon: "🧴" },
      { name: "Deodorant", quantity: 1, icon: "🧴" },
      { name: "Sunscreen", quantity: 1, icon: "☀️" },
      { name: "Medications", quantity: 1, icon: "💊" },
      { name: "Razor", quantity: 1, icon: "🪒" },
    ],
    "Electronics": [
      { name: "Phone", quantity: 1, icon: "📱" },
      { name: "Phone Charger", quantity: 1, icon: "🔌" },
      { name: "Headphones", quantity: 1, icon: "🎧" },
      { name: "Laptop", quantity: 1, icon: "💻" },
      { name: "Travel Adapter", quantity: 1, icon: "🔌" },
    ],
    "Documents": [
      { name: "Passport", quantity: 1, icon: "📘" },
      { name: "ID/Driver's License", quantity: 1, icon: "🪪" },
      { name: "Boarding Passes", quantity: 1, icon: "✈️" },
      { name: "Hotel Confirmations", quantity: 1, icon: "🏨" },
      { name: "Travel Insurance", quantity: 1, icon: "📋" },
    ],
    "Money": [
      { name: "Cash", quantity: 1, icon: "💵" },
      { name: "Credit Cards", quantity: 2, icon: "💳" },
      { name: "Debit Card", quantity: 1, icon: "🏧" },
    ],
    "Miscellaneous": [
      { name: "Sunglasses", quantity: 1, icon: "🕶️" },
      { name: "Water Bottle", quantity: 1, icon: "🍶" },
      { name: "Snacks", quantity: 1, icon: "🍿" },
      { name: "Pen", quantity: 1, icon: "🖊️" },
      { name: "Travel Pillow", quantity: 1, icon: "🛋️" },
    ],
  };

  defaultCategories.forEach((cat, idx) => {
    const catId = generateId();
    state.categories.push({
      id: catId,
      tripId: trip.id,
      name: cat.name,
      icon: cat.icon,
      order: idx,
    });

    const items = defaultItems[cat.name] || [];
    items.forEach((item, itemIdx) => {
      state.items.push({
        id: generateId(),
        tripId: trip.id,
        categoryId: catId,
        name: item.name,
        quantity: item.quantity,
        checked: false,
        icon: item.icon,
        order: itemIdx,
      });
    });
  });

  saveState(state);
  return trip;
}

export function updateTrip(tripId: string, updates: Partial<Trip>): void {
  const state = loadState();
  if (!state) return;
  const trip = state.trips.find((t) => t.id === tripId);
  if (trip) {
    Object.assign(trip, { ...updates, updatedAt: new Date().toISOString() });
    saveState(state);
  }
}

export function archiveTrip(tripId: string, archived: boolean): void {
  const state = loadState();
  if (!state) return;
  const trip = state.trips.find((t) => t.id === tripId);
  if (trip) {
    trip.archived = archived;
    trip.updatedAt = new Date().toISOString();
    saveState(state);
  }
}

export function deleteTrip(tripId: string): void {
  const state = loadState();
  if (!state) return;
  state.trips = state.trips.filter((t) => t.id !== tripId);
  state.categories = state.categories.filter((c) => c.tripId !== tripId);
  state.items = state.items.filter((i) => i.tripId !== tripId);
  saveState(state);
}

export function createCategory(tripId: string, name: string, icon: string): Category {
  const state = loadState();
  if (!state) return { id: "", tripId, name, icon, order: 0 };
  const tripCats = state.categories.filter((c) => c.tripId === tripId);
  const cat: Category = {
    id: generateId(),
    tripId,
    name,
    icon,
    order: tripCats.length,
  };
  state.categories.push(cat);
  saveState(state);
  return cat;
}

export function updateCategory(catId: string, updates: { name?: string; icon?: string }): void {
  const state = loadState();
  if (!state) return;
  const cat = state.categories.find((c) => c.id === catId);
  if (cat) {
    if (updates.name !== undefined) cat.name = updates.name;
    if (updates.icon !== undefined) cat.icon = updates.icon;
    saveState(state);
  }
}

export function deleteCategory(catId: string): void {
  const state = loadState();
  if (!state) return;
  const cat = state.categories.find((c) => c.id === catId);
  if (!cat) return;
  state.categories = state.categories.filter((c) => c.id !== catId);
  state.items = state.items.filter((i) => i.categoryId !== catId);
  // Reorder remaining categories
  const tripCats = state.categories
    .filter((c) => c.tripId === cat.tripId)
    .sort((a, b) => a.order - b.order);
  tripCats.forEach((c, idx) => (c.order = idx));
  saveState(state);
}

export function createItem(tripId: string, categoryId: string, name: string, icon: string, quantity: number): PackingItem {
  const state = loadState();
  if (!state) return { id: "", tripId, categoryId, name, quantity, checked: false, icon, order: 0 };
  const catItems = state.items.filter((i) => i.categoryId === categoryId);
  const item: PackingItem = {
    id: generateId(),
    tripId,
    categoryId,
    name,
    quantity,
    checked: false,
    icon,
    order: catItems.length,
  };
  state.items.push(item);
  saveState(state);
  return item;
}

export function updateItem(itemId: string, updates: {
  name?: string;
  quantity?: number;
  checked?: boolean;
  icon?: string;
}): void {
  const state = loadState();
  if (!state) return;
  const item = state.items.find((i) => i.id === itemId);
  if (item) {
    if (updates.name !== undefined) item.name = updates.name;
    if (updates.quantity !== undefined) item.quantity = updates.quantity;
    if (updates.checked !== undefined) item.checked = updates.checked;
    if (updates.icon !== undefined) item.icon = updates.icon;
    saveState(state);
  }
}

export function deleteItem(itemId: string): void {
  const state = loadState();
  if (!state) return;
  state.items = state.items.filter((i) => i.id !== itemId);
  saveState(state);
}

export function getItemProgress(tripId: string, items: PackingItem[]): number {
  const tripItems = items.filter((i) => i.tripId === tripId);
  if (tripItems.length === 0) return 0;
  const checked = tripItems.filter((i) => i.checked).length;
  return Math.round((checked / tripItems.length) * 100);
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
