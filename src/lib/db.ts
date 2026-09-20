import "server-only";

import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  AppState,
  Category,
  PackingItem,
  Reservation,
  ReservationType,
  Task,
  Trip,
  User,
} from "../lib/types";

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

    CREATE TABLE IF NOT EXISTS tasks (
      id        TEXT PRIMARY KEY,
      tripId    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      title     TEXT NOT NULL,
      done      INTEGER NOT NULL DEFAULT 0,
      dueDate   TEXT NOT NULL DEFAULT '',
      notes     TEXT NOT NULL DEFAULT '',
      "order"   INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trips_user      ON trips(userId);
    CREATE INDEX IF NOT EXISTS idx_categories_trip ON categories(tripId);
    CREATE INDEX IF NOT EXISTS idx_items_category  ON items(categoryId);
    CREATE INDEX IF NOT EXISTS idx_items_trip      ON items(tripId);
    CREATE INDEX IF NOT EXISTS idx_tasks_trip      ON tasks(tripId);

    CREATE TABLE IF NOT EXISTS reservations (
      id           TEXT PRIMARY KEY,
      tripId       TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      type         TEXT NOT NULL DEFAULT 'other',
      title        TEXT NOT NULL,
      confirmation TEXT NOT NULL DEFAULT '',
      location     TEXT NOT NULL DEFAULT '',
      locationTo   TEXT NOT NULL DEFAULT '',
      startDate    TEXT NOT NULL DEFAULT '',
      startTime    TEXT NOT NULL DEFAULT '',
      endDate      TEXT NOT NULL DEFAULT '',
      endTime      TEXT NOT NULL DEFAULT '',
      cost         TEXT NOT NULL DEFAULT '',
      notes        TEXT NOT NULL DEFAULT '',
      "order"      INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reservations_trip ON reservations(tripId);

    /*
     * Geocode cache.
     *
     * Nominatim is rate-limited to about one request per second and needs a
     * network round trip, so coordinates are resolved once and kept.
     *
     * Keyed on the normalised query text rather than a reservation id: the
     * same place ("Keflavík Airport") recurs across trips and across the
     * from/to sides of a flight, and all of those should share one lookup.
     *
     * The "miss" flag marks a query Nominatim could not resolve, so a vague
     * or mistyped string is not retried on every single page load.
     */
    CREATE TABLE IF NOT EXISTS geocache (
      query     TEXT PRIMARY KEY,
      lat       REAL,
      lng       REAL,
      label     TEXT NOT NULL DEFAULT '',
      miss      INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
  `);
}

export function getDb(): SqliteDb {
  const cached = globalForDb.__tripPackerDb;
  if (cached) {
    // Re-run the migration on every access. It is written to be idempotent
    // (CREATE ... IF NOT EXISTS), and dev-mode HMR re-evaluates this module
    // while the cached connection — and therefore the previous schema — lives
    // on in globalThis. Without this, adding a table in code produces
    // "no such table" until the process is restarted, which looks like a
    // stale-cache bug but is really a skipped migration.
    migrate(cached);
    return cached;
  }

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

type TaskRow = {
  id: string;
  tripId: string;
  title: string;
  done: number;
  dueDate: string;
  notes: string;
  order: number;
  createdAt: string;
};

type ReservationRow = {
  id: string;
  tripId: string;
  type: string;
  title: string;
  confirmation: string;
  location: string;
  locationTo: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  cost: string;
  notes: string;
  order: number;
  createdAt: string;
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

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  tripId: r.tripId,
  title: r.title,
  done: r.done === 1,
  dueDate: r.dueDate,
  notes: r.notes,
  order: r.order,
  createdAt: r.createdAt,
});

const RESERVATION_TYPES: ReservationType[] = [
  "flight",
  "lodging",
  "car",
  "train",
  "ferry",
  "activity",
  "other",
];

/**
 * SQLite hands back `type` as an unconstrained string. Narrow it here so a
 * hand-edited database or a future row written by an older build cannot leak a
 * value the UI has no rendering branch for.
 */
const toReservationType = (v: string): ReservationType =>
  (RESERVATION_TYPES as string[]).includes(v) ? (v as ReservationType) : "other";

const toReservation = (r: ReservationRow): Reservation => ({
  id: r.id,
  tripId: r.tripId,
  type: toReservationType(r.type),
  title: r.title,
  confirmation: r.confirmation,
  location: r.location,
  locationTo: r.locationTo,
  startDate: r.startDate,
  startTime: r.startTime,
  endDate: r.endDate,
  endTime: r.endTime,
  cost: r.cost,
  notes: r.notes,
  order: r.order,
  createdAt: r.createdAt,
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
  const tasks = (db.prepare('SELECT * FROM tasks ORDER BY "order", rowid').all() as TaskRow[]).map(
    toTask
  );

  const reservations = (
    db.prepare('SELECT * FROM reservations ORDER BY "order", rowid').all() as ReservationRow[]
  ).map(toReservation);

  const activeRow = db.prepare("SELECT value FROM settings WHERE key = ?").get(ACTIVE_USER_KEY) as
    | { value: string }
    | undefined;

  // Fall back to the first user if the stored active user was deleted, rather
  // than surfacing an activeUserId that matches nothing.
  const activeUserId =
    activeRow && users.some((u) => u.id === activeRow.value) ? activeRow.value : users[0].id;

  return { users, activeUserId, trips, categories, items, tasks, reservations };
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

  insertTask(t: Task): void {
    getDb()
      .prepare(
        `INSERT INTO tasks (id, tripId, title, done, dueDate, notes, "order", createdAt)
         VALUES (@id, @tripId, @title, @done, @dueDate, @notes, @order, @createdAt)`
      )
      .run({ ...t, done: t.done ? 1 : 0 });
  },

  updateTask(id: string, updates: Partial<Task>): void {
    // `title` is included because tasks are renamed inline; `tripId` is not,
    // since a task belongs to the trip it was created under.
    const allowed = ["title", "done", "dueDate", "notes", "order"] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => (k === "order" ? `"order" = @order` : `${k} = @${k}`)).join(", ");
    const payload: Record<string, unknown> = { id };
    for (const k of keys) {
      payload[k] = k === "done" ? (updates.done ? 1 : 0) : updates[k];
    }
    getDb()
      .prepare(`UPDATE tasks SET ${set} WHERE id = @id`)
      .run(payload);
  },

  deleteTask(id: string): void {
    getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  },

  insertReservation(r: Reservation): void {
    getDb()
      .prepare(
        `INSERT INTO reservations
           (id, tripId, type, title, confirmation, location, locationTo,
            startDate, startTime, endDate, endTime, cost, notes, "order", createdAt)
         VALUES
           (@id, @tripId, @type, @title, @confirmation, @location, @locationTo,
            @startDate, @startTime, @endDate, @endTime, @cost, @notes, @order, @createdAt)`
      )
      .run(r);
  },

  updateReservation(id: string, updates: Partial<Reservation>): void {
    // `tripId` and `type` are excluded: a booking does not move between trips
    // or change category after it is created (delete and re-add instead).
    const allowed = [
      "title",
      "confirmation",
      "location",
      "locationTo",
      "startDate",
      "startTime",
      "endDate",
      "endTime",
      "cost",
      "notes",
      "order",
    ] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => (k === "order" ? `"order" = @order` : `${k} = @${k}`)).join(", ");
    const payload: Record<string, unknown> = { id };
    for (const k of keys) {
      payload[k] = updates[k];
    }
    getDb()
      .prepare(`UPDATE reservations SET ${set} WHERE id = @id`)
      .run(payload);
  },

  deleteReservation(id: string): void {
    getDb().prepare("DELETE FROM reservations WHERE id = ?").run(id);
  },

  /**
   * Persist a manual itinerary order for one trip.
   *
   * Applied as a single transaction over the whole ordering rather than one
   * write per moved row: a drag rewrites the positions of everything between
   * the old and new spot, and a half-applied reorder would leave the user with
   * a scrambled itinerary.
   *
   * Only rows belonging to `tripId` are touched, so a stale client cannot
   * reorder another trip's bookings.
   */
  setReservationOrder(tripId: string, orderedIds: string[]): void {
    const db = getDb();
    const stmt = db.prepare(
      'UPDATE reservations SET "order" = ? WHERE id = ? AND tripId = ?'
    );
    const run = db.transaction((ids: string[]) => {
      ids.forEach((id, i) => stmt.run(i, id, tripId));
    });
    run(orderedIds);
  },

  /** Replace the whole tree in one transaction — used for import/seed. */
  replaceAll(state: AppState): void {
    const db = getDb();
    const run = db.transaction((s: AppState) => {
      db.exec(
        "DELETE FROM items; DELETE FROM tasks; DELETE FROM reservations; DELETE FROM categories; DELETE FROM trips; DELETE FROM users;"
      );
      for (const u of s.users) tx.insertUser(u);
      for (const t of s.trips) tx.insertTrip(t);
      for (const c of s.categories) tx.insertCategory(c);
      for (const i of s.items) tx.insertItem(i);
      for (const t of s.tasks) tx.insertTask(t);
      for (const r of s.reservations) tx.insertReservation(r);
      tx.setActiveUser(s.activeUserId);
    });
    run(state);
  },
};
