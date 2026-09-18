import "server-only";

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AppState, Category, PackingItem, Trip, User } from "../lib/types";

/*
 * SQLite persistence layer.
 *
 * The schema mirrors the in-memory shape one-to-one (users / trips / categories
 * / items) rather than inventing a different model, so the read path is a plain
 * SELECT per table and the write path is a single upsert. `order` is a real
 * column because category and item ordering is user-visible.
 *
 * Foreign keys cascade: deleting a trip removes its categories and items in the
 * database rather than relying on the old JS-side filtering that used to run in
 * `deleteUser`, which could drift and leave orphans behind.
 */

const DB_PATH =
  process.env.TRIP_PACKER_DB ?? path.join(process.cwd(), "data", "trip-packer.db");

type SqliteDb = Database.Database;

// Next.js dev mode re-evaluates modules on every HMR update. Without a cached
// handle we would open a new connection (and re-run migrations) on each edit,
// leaking file descriptors until SQLite starts refusing to open the file.
const globalForDb = globalThis as unknown as { __tripPackerDb?: SqliteDb };

function migrate(db: SqliteDb): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      avatarColor TEXT NOT NULL DEFAULT 'bg-blue-500',
      createdAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      destination TEXT NOT NULL DEFAULT '',
      startDate   TEXT NOT NULL DEFAULT '',
      endDate     TEXT NOT NULL DEFAULT '',
      notes       TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT '✈️',
      archived    INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id     TEXT PRIMARY KEY,
      tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      icon   TEXT NOT NULL DEFAULT '📦',
      "order" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id         TEXT PRIMARY KEY,
      tripId     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      categoryId TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 1,
      checked    INTEGER NOT NULL DEFAULT 0,
      icon       TEXT NOT NULL DEFAULT '📦',
      "order"    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trips_user      ON trips(userId);
    CREATE INDEX IF NOT EXISTS idx_categories_trip ON categories(tripId);
    CREATE INDEX IF NOT EXISTS idx_items_category  ON items(categoryId);
    CREATE INDEX IF NOT EXISTS idx_items_trip      ON items(tripId);
  `);
}

export function getDb(): SqliteDb {
  if (globalForDb.__tripPackerDb) return globalForDb.__tripPackerDb;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  migrate(db);

  globalForDb.__tripPackerDb = db;
  return db;
}

/* ---------------------------------------------------------------- mapping */

type UserRow = {
  id: string;
  name: string;
  avatarColor: string;
  createdAt: string;
};

type TripRow = {
  id: string;
  userId: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  notes: string;
  icon: string;
  archived: number;
  createdAt: string;
  updatedAt: string;
};

type CategoryRow = { id: string; tripId: string; name: string; icon: string; order: number };

type ItemRow = {
  id: string;
  tripId: string;
  categoryId: string;
  name: string;
  quantity: number;
  checked: number;
  icon: string;
  order: number;
};

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  avatarColor: r.avatarColor,
  createdAt: r.createdAt,
});

const toTrip = (r: TripRow): Trip => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  destination: r.destination,
  startDate: r.startDate,
  endDate: r.endDate,
  notes: r.notes,
  icon: r.icon,
  archived: r.archived === 1,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  tripId: r.tripId,
  name: r.name,
  icon: r.icon,
  order: r.order,
});

const toItem = (r: ItemRow): PackingItem => ({
  id: r.id,
  tripId: r.tripId,
  categoryId: r.categoryId,
  name: r.name,
  quantity: r.quantity,
  checked: r.checked === 1,
  icon: r.icon,
  order: r.order,
});

/* ------------------------------------------------------------------ reads */

const ACTIVE_USER_KEY = "activeUserId";

export function readState(): AppState | null {
  const db = getDb();

  // No users means the database has never been initialized, which is how the
  // API layer distinguishes "fresh install" from "user deleted everyone".
  const users = (db.prepare("SELECT * FROM users ORDER BY createdAt").all() as UserRow[]).map(toUser);
  if (users.length === 0) return null;

  const trips = (db.prepare("SELECT * FROM trips ORDER BY createdAt").all() as TripRow[]).map(toTrip);
  const categories = (
    db.prepare('SELECT * FROM categories ORDER BY "order", rowid').all() as CategoryRow[]
  ).map(toCategory);
  const items = (db.prepare('SELECT * FROM items ORDER BY "order", rowid').all() as ItemRow[]).map(
    toItem
  );

  const activeRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(ACTIVE_USER_KEY) as
    | { value: string }
    | undefined;

  // Fall back to the first user if the stored active user was deleted, rather
  // than surfacing an activeUserId that matches nothing.
  const activeUserId =
    activeRow && users.some((u) => u.id === activeRow.value) ? activeRow.value : users[0].id;

  return { users, activeUserId, trips, categories, items };
}

/* ----------------------------------------------------------------- writes */

export const tx = {
  setActiveUser(userId: string): void {
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(ACTIVE_USER_KEY, userId);
  },

  insertUser(u: User): void {
    getDb()
      .prepare("INSERT INTO users (id, name, avatarColor, createdAt) VALUES (@id, @name, @avatarColor, @createdAt)")
      .run(u);
  },

  updateUser(id: string, updates: Partial<User>): void {
    // Column names are allow-listed rather than interpolated from the payload,
    // so a crafted update cannot reach a column it was not meant to touch.
    const allowed = ["name", "avatarColor"] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = @${k}`).join(", ");
    getDb()
      .prepare(`UPDATE users SET ${set} WHERE id = @id`)
      .run({ ...updates, id });
  },

  deleteUser(id: string): void {
    // Cascades handle trips/categories/items.
    getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
  },

  insertTrip(t: Trip): void {
    getDb()
      .prepare(
        `INSERT INTO trips (id, userId, name, destination, startDate, endDate, notes, icon, archived, createdAt, updatedAt)
         VALUES (@id, @userId, @name, @destination, @startDate, @endDate, @notes, @icon, @archived, @createdAt, @updatedAt)`
      )
      .run({ ...t, archived: t.archived ? 1 : 0 });
  },

  updateTrip(id: string, updates: Partial<Trip>): void {
    const allowed = [
      "name",
      "destination",
      "startDate",
      "endDate",
      "notes",
      "icon",
      "archived",
      "userId",
    ] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = @${k}`).join(", ");
    const payload: Record<string, unknown> = { id, updatedAt: new Date().toISOString() };
    for (const k of keys) {
      payload[k] = k === "archived" ? (updates.archived ? 1 : 0) : updates[k];
    }
    getDb()
      .prepare(`UPDATE trips SET ${set}, updatedAt = @updatedAt WHERE id = @id`)
      .run(payload);
  },

  deleteTrip(id: string): void {
    getDb().prepare("DELETE FROM trips WHERE id = ?").run(id);
  },

  insertCategory(c: Category): void {
    getDb()
      .prepare('INSERT INTO categories (id, tripId, name, icon, "order") VALUES (@id, @tripId, @name, @icon, @order)')
      .run(c);
  },

  updateCategory(id: string, updates: Partial<Category>): void {
    const allowed = ["name", "icon", "order"] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => (k === "order" ? `"order" = @order` : `${k} = @${k}`)).join(", ");
    getDb()
      .prepare(`UPDATE categories SET ${set} WHERE id = @id`)
      .run({ ...updates, id });
  },

  deleteCategory(id: string): void {
    getDb().prepare("DELETE FROM categories WHERE id = ?").run(id);
  },

  insertItem(i: PackingItem): void {
    getDb()
      .prepare(
        `INSERT INTO items (id, tripId, categoryId, name, quantity, checked, icon, "order")
         VALUES (@id, @tripId, @categoryId, @name, @quantity, @checked, @icon, @order)`
      )
      .run({ ...i, checked: i.checked ? 1 : 0 });
  },

  updateItem(id: string, updates: Partial<PackingItem>): void {
    const allowed = ["name", "quantity", "checked", "icon", "order", "categoryId", "tripId"] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => (k === "order" ? `"order" = @order` : `${k} = @${k}`)).join(", ");
    const payload: Record<string, unknown> = { id };
    for (const k of keys) {
      payload[k] = k === "checked" ? (updates.checked ? 1 : 0) : updates[k];
    }
    getDb()
      .prepare(`UPDATE items SET ${set} WHERE id = @id`)
      .run(payload);
  },

  deleteItem(id: string): void {
    getDb().prepare("DELETE FROM items WHERE id = ?").run(id);
  },

  /** Replace the whole tree in one transaction — used for import/seed. */
  replaceAll(state: AppState): void {
    const db = getDb();
    const run = db.transaction((s: AppState) => {
      db.exec("DELETE FROM items; DELETE FROM categories; DELETE FROM trips; DELETE FROM users;");
      for (const u of s.users) tx.insertUser(u);
      for (const t of s.trips) tx.insertTrip(t);
      for (const c of s.categories) tx.insertCategory(c);
      for (const i of s.items) tx.insertItem(i);
      tx.setActiveUser(s.activeUserId);
    });
    run(state);
  },
};
