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
      createdAt    TEXT NOT NULL,
      confirmed    INTEGER NOT NULL DEFAULT 1
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

    /*
     * Read-only share links.
     *
     * The token is the primary key because lookups are always by token — a
     * shared URL only ever carries the token, never a trip id, so there is no
     * query pattern that starts from the trip.
     *
     * Kept as a separate table rather than a shareToken column on trips so a
     * trip can have several links (one per companion) and so revoking one does
     * not disturb the others or the trip row itself.
     *
     * ON DELETE CASCADE: deleting the trip must not leave a live link serving a
     * dangling id.
     */
    CREATE TABLE IF NOT EXISTS share_tokens (
      token     TEXT PRIMARY KEY,
      tripId    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_share_tokens_trip ON share_tokens(tripId);
  `);

  /*
   * Additive column migrations.
   *
   * `CREATE TABLE IF NOT EXISTS` above is a no-op on a database that already
   * has the table, so adding a column to that statement only ever affects a
   * fresh install. An existing database keeps the old shape and every query
   * naming the new column fails with "no such column" — which surfaces as a
   * broken page rather than a migration error, since nothing here throws at
   * startup.
   *
   * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the column list is checked
   * first. This is safe to run on every getDb() (see the note there): the
   * PRAGMA is cheap and the ALTER only fires once, the first time a given
   * database is opened after the column was introduced.
   *
   * The DEFAULT matters as much as the column. Existing rows are real
   * bookings the user already made, so `confirmed` defaults to 1 — adding the
   * field must not retroactively relabel everybody's itinerary as tentative.
   */
  addColumnIfMissing(db, "reservations", "confirmed", "INTEGER NOT NULL DEFAULT 1");

  /*
   * Accounts.
   *
   * `users` predates authentication: it was a profile list living inside one
   * shared dataset, and `activeUserId` was a setting the client could point at
   * anyone. Under real auth the same rows become accounts, so we add the
   * credential columns rather than creating a parallel table — that would
   * orphan the existing userId foreign keys on trips.
   *
   * NULLs are deliberate and load-bearing:
   *
   *   email        NULL for a pre-auth profile that has not been claimed yet.
   *                UNIQUE in SQLite permits multiple NULLs, so several
   *                unclaimed profiles can coexist without colliding.
   *   passwordHash NULL means "cannot log in". A profile created from the old
   *                switchable list has no password and therefore no access
   *                until an admin sets one. This is why the column is nullable
   *                rather than NOT NULL with an empty-string default: an empty
   *                hash must never be mistaken for a valid credential.
   *
   * There is no `isAdmin` flag. Admin is "this account has a password and
   * therefore can log in and create others" — see lib/auth. A boolean would
   * need a migration and could drift out of sync with the credential it
   * describes.
   */
  addColumnIfMissing(db, "users", "email", "TEXT");
  addColumnIfMissing(db, "users", "passwordHash", "TEXT");
  addColumnIfMissing(db, "users", "isOwner", "INTEGER NOT NULL DEFAULT 0");

  /*
   * Partial unique index on email.
   *
   * A plain `UNIQUE` column would also work, but uniqueness is only wanted for
   * rows that HAVE an email. The `WHERE email IS NOT NULL` predicate scopes the
   * constraint to claimed accounts, so any number of pre-auth profiles can keep
   * a NULL email without colliding with each other — which a bare UNIQUE index
   * would also allow in SQLite, but only by accident of NULL comparison
   * semantics. Stating it explicitly keeps the intent visible.
   */
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
      ON users(email)
      WHERE email IS NOT NULL;
  `);

  /*
   * Sessions.
   *
   * The cookie carries a random opaque token; this table is the only thing that
   * can turn it into a user id. Nothing about the user is encoded in the cookie,
   * so a client cannot forge or edit an identity — it can only present a token
   * that either exists here or does not.
   *
   * `tokenHash` rather than the raw token: a leaked database dump (or a backup
   * left in /tmp) must not hand an attacker live sessions. The raw token is
   * shown to the browser once and never stored.
   *
   * ON DELETE CASCADE means deleting an account immediately invalidates its
   * sessions instead of leaving orphaned tokens that still authenticate to a
   * user row that no longer exists.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      tokenHash TEXT PRIMARY KEY,
      userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      userAgent TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
  `);

  /*
   * Trip membership — the sharing model.
   *
   * The owner of a trip is `trips.userId` and is deliberately NOT represented
   * here. Storing the owner as a row would create two sources of truth that can
   * disagree (an owner row deleted, or a membership row claiming ownership of
   * someone else's trip), and the resolution order in lib/access.ts depends on
   * ownership being unambiguous.
   *
   * So this table holds only *non-owner* grants. The role check constraint
   * enforces that at the schema level: 'owner' cannot be inserted here at all,
   * which means a bug in application code cannot create a second owner.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS trip_members (
      tripId    TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role      TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('editor', 'viewer')),
      createdAt TEXT NOT NULL,
      PRIMARY KEY (tripId, userId)
    );

    CREATE INDEX IF NOT EXISTS idx_trip_members_user ON trip_members(userId);
  `);

  /*
   * Login attempts, for rate limiting.
   *
   * Only FAILED attempts are recorded. A successful login clears the counter,
   * so a working user is never locked out no matter how many times they log in.
   * Rate limiting on totals is the classic way to lock a legitimate user out of
   * their own account after a handful of normal uses.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      key         TEXT PRIMARY KEY,
      failures    INTEGER NOT NULL DEFAULT 0,
      firstFailedAt TEXT NOT NULL,
      lastFailedAt  TEXT NOT NULL
    );
  `);
}

function addColumnIfMissing(
  db: SqliteDb,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
  email: string | null;
  passwordHash: string | null;
  isOwner: number;
};

/**
 * A user row with its credential columns included.
 *
 * Separate from `User` on purpose. `User` is the shape that travels to the
 * client, and it must never carry a password hash. Login needs one, so it asks
 * for this type instead — which makes "did I accidentally serialise the hash"
 * a type error rather than a thing to remember.
 */
export type UserWithSecret = Omit<User, "passwordHash"> & {
  passwordHash?: string | null;
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
  confirmed: number;
};

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  avatarColor: r.avatarColor,
  createdAt: r.createdAt,
  // Credentials are intentionally omitted. `email` is not secret but is not
  // needed by the client either; `passwordHash` must never leave the server.
  ...(r.email ? { email: r.email } : {}),
  ...(r.isOwner ? { isOwner: true } : {}),
});

/** Like toUser, but carries the password hash. Only for login. */
const toUserWithSecret = (r: UserRow): UserWithSecret => ({
  ...toUser(r),
  // The hash is nullable on purpose: a companion profile has no credentials
  // and must never be able to authenticate. verifyPassword rejects a null
  // hash, so the login path fails closed rather than throwing.
  passwordHash: r.passwordHash ?? undefined,
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
  // SQLite hands back 0/1; the domain type is a boolean.
  confirmed: r.confirmed !== 0,
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

/**
 * All session rows, for token verification.
 *
 * Exposed as a standalone function rather than only as a `tx` method, because
 * callers outside the write layer (session.ts) read it. `tx` is the write
 * surface; reads that other modules need live here alongside readState.
 *
 * Returns hashes, never raw tokens — the raw token exists only in the client's
 * cookie and briefly in memory at creation. There is deliberately no way to read
 * a usable token back out of this table.
 */
export function getSessionRecords(): {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}[] {
  return getDb()
    .prepare("SELECT tokenHash, userId, expiresAt FROM sessions")
    .all() as { tokenHash: string; userId: string; expiresAt: string }[];
}

/* ----------------------------------------------------------------- writes */

export const tx = {
  setActiveUser(userId: string): void {
    getDb()
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(ACTIVE_USER_KEY, userId);
  },

  /**
   * Insert a PROFILE row: no credentials, never an owner.
   *
   * The credential columns are hard-coded to NULL rather than taken from the
   * argument, and this is deliberate rather than defensive tidiness. The only
   * caller that reaches this from a request is the `user.add` op, whose payload
   * is fully client-controlled. Honouring `passwordHash` or `isOwner` from that
   * payload would let any client (a) mint itself a login on an account it then
   * controls, or (b) promote itself to owner — both verified as exploitable
   * against the previous version of this function, which wrote both fields
   * straight through from the argument.
   *
   * Accounts with credentials are created by `insertAccount` instead, which is
   * only reachable from the create-account CLI.
   */
  insertUser(u: User): void {
    getDb()
      .prepare(
        `INSERT INTO users (id, name, avatarColor, createdAt, email, passwordHash, isOwner)
         VALUES (@id, @name, @avatarColor, @createdAt, NULL, NULL, 0)`
      )
      .run({
        id: u.id,
        name: u.name,
        avatarColor: u.avatarColor,
        createdAt: u.createdAt,
      });
  },

  /**
   * Insert an ACCOUNT: credentials and ownership included.
   *
   * Separate from insertUser on purpose. `user.add` must not be able to reach
   * this, and keeping the two apart makes that a property of which function is
   * called rather than a condition someone has to remember to check.
   *
   * Only the create-account CLI and the bootstrap path call this.
   */
  insertAccount(u: User & { email: string; passwordHash: string }): void {
    getDb()
      .prepare(
        `INSERT INTO users (id, name, avatarColor, createdAt, email, passwordHash, isOwner)
         VALUES (@id, @name, @avatarColor, @createdAt, @email, @passwordHash, @isOwner)`
      )
      .run({
        id: u.id,
        name: u.name,
        avatarColor: u.avatarColor,
        createdAt: u.createdAt,
        email: u.email,
        passwordHash: u.passwordHash,
        isOwner: u.isOwner ? 1 : 0,
      });
  },

  /** Look up a profile by id, including credential columns. */
  getUserById(userId: string): UserWithSecret | null {
    const row = getDb()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as UserRow | undefined;
    return row ? toUserWithSecret(row) : null;
  },

  /**
   * Look up an account by email, for login.
   *
   * Emails are stored lowercased by the caller and compared with a plain
   * equality here. Deliberately NOT a case-insensitive SQL comparison: if the
   * column ever contains mixed-case rows from an import, a COLLATE NOCASE
   * match would silently make two distinct rows ambiguous.
   */
  getUserByEmail(email: string): UserWithSecret | null {
    const row = getDb()
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as UserRow | undefined;
    return row ? toUserWithSecret(row) : null;
  },

  /** Set (or replace) an account's password hash. */
  setPasswordHash(userId: string, passwordHash: string): void {
    getDb()
      .prepare("UPDATE users SET passwordHash = ? WHERE id = ?")
      .run(passwordHash, userId);
  },

  /**
   * Promote the first account to owner.
   *
   * Called once at bootstrap. Guarded by a WHERE that only matches when no
   * owner exists, so calling it twice cannot demote or create a second owner.
   */
  promoteToOwnerIfNone(userId: string): boolean {
    const existing = getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE isOwner = 1")
      .get() as { n: number };
    if (existing.n > 0) return false;
    getDb().prepare("UPDATE users SET isOwner = 1 WHERE id = ?").run(userId);
    return true;
  },

  /* ------------------------------------------------- login rate limiting */

  /** Current failure state for a key, or null when there is no record. */
  getLoginAttempts(key: string): {
    failures: number;
    firstFailedAt: string;
    lastFailedAt: string;
  } | null {
    const row = getDb()
      .prepare(
        "SELECT failures, firstFailedAt, lastFailedAt FROM login_attempts WHERE key = ?"
      )
      .get(key) as
      | { failures: number; firstFailedAt: string; lastFailedAt: string }
      | undefined;
    return row ?? null;
  },

  /** Record a failed attempt, replacing any prior record for this key. */
  recordLoginFailure(
    key: string,
    failures: number,
    firstFailedAt: string,
    lastFailedAt: string
  ): void {
    getDb()
      .prepare(
        `INSERT INTO login_attempts (key, failures, firstFailedAt, lastFailedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           failures = excluded.failures,
           firstFailedAt = excluded.firstFailedAt,
           lastFailedAt = excluded.lastFailedAt`
      )
      .run(key, failures, firstFailedAt, lastFailedAt);
  },

  /** Clear the failure record for a key — called on successful login. */
  clearLoginAttempts(key: string): void {
    getDb().prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
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

  /**
   * Attach credentials to an existing profile, turning it into a login.
   *
   * Separate from updateUser(), which is allow-listed to name and avatarColor
   * precisely so a client payload cannot reach credential columns. Rather than
   * widening that list — which would reopen the user.add escalation hole — this
   * is a distinct, explicitly-named operation that only the CLI calls.
   *
   * The id is preserved so anything already owned by this profile (trips, and
   * rows in trip_members) keeps pointing at it.
   */
  setCredentials(userId: string, email: string, passwordHash: string): void {
    const result = getDb()
      .prepare("UPDATE users SET email = ?, passwordHash = ? WHERE id = ?")
      .run(email, passwordHash, userId);
    if (result.changes === 0) {
      throw new Error(`No user with id ${userId}; credentials not set.`);
    }
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
            startDate, startTime, endDate, endTime, cost, notes, "order", createdAt,
            confirmed)
         VALUES
           (@id, @tripId, @type, @title, @confirmation, @location, @locationTo,
            @startDate, @startTime, @endDate, @endTime, @cost, @notes, @order, @createdAt,
            @confirmed)`)
      .run({ ...r, confirmed: r.confirmed ? 1 : 0 });
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
      "confirmed",
    ] as const;
    const keys = allowed.filter((k) => updates[k] !== undefined);
    if (keys.length === 0) return;
    const set = keys.map((k) => (k === "order" ? `"order" = @order` : `${k} = @${k}`)).join(", ");
    const payload: Record<string, unknown> = { id };
    for (const k of keys) {
      // Booleans are stored as 0/1, matching how Task.done is handled.
      payload[k] = k === "confirmed" ? (updates.confirmed ? 1 : 0) : updates[k];
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

  /**
   * Replace ONLY the rows belonging to one user's own trips.
   *
   * This is the multi-user-safe counterpart to replaceAll above. It exists
   * because the offline sync path pushes a full local snapshot, and during the
   * transition to accounts that snapshot is a view of the pusher's own data —
   * not a claim about everyone else's. Running replaceAll for a snapshot push
   * would delete every other account, so the two cannot share an implementation.
   *
   * Deliberately does NOT touch the users table: account records outlive any
   * single snapshot, and a snapshot is trip data, not an account roster.
   *
   * Scope of the delete is derived from the user's OWN trips (trip.userId), and
   * child rows are removed by trip membership rather than by trusting the ids in
   * the incoming payload. An id in the payload that belongs to someone else is
   * therefore ignored rather than acted upon.
   */
  replaceOwnedRows(
    userId: string,
    /*
     * A projection, not a full AppState: the caller has already scoped this down
     * to the acting user's own trips, so `users`/`activeUserId` are absent. Only
     * the row collections are read here.
     */
    scoped: Pick<
      AppState,
      "trips" | "categories" | "items" | "tasks" | "reservations"
    >
  ): void {
    const db = getDb();

    const run = db.transaction(
      (
        uid: string,
        s: Pick<
          AppState,
          "trips" | "categories" | "items" | "tasks" | "reservations"
        >
      ) => {
      const ownedTripIds = (
        db.prepare("SELECT id FROM trips WHERE userId = ?").all(uid) as {
          id: string;
        }[]
      ).map((r) => r.id);

      if (ownedTripIds.length === 0) return;

      const placeholders = ownedTripIds.map(() => "?").join(",");

      /*
       * Order matters: children before parents, because the foreign keys point
       * upward. Items are deleted by their own tripId, with a fallback to the
       * parent category for legacy rows that predate the column.
       */
      db.prepare(
        `DELETE FROM items WHERE tripId IN (${placeholders})
           OR categoryId IN (SELECT id FROM categories WHERE tripId IN (${placeholders}))`
      ).run(...ownedTripIds, ...ownedTripIds);

      db.prepare(`DELETE FROM tasks WHERE tripId IN (${placeholders})`).run(
        ...ownedTripIds
      );
      db.prepare(`DELETE FROM reservations WHERE tripId IN (${placeholders})`).run(
        ...ownedTripIds
      );
      db.prepare(`DELETE FROM categories WHERE tripId IN (${placeholders})`).run(
        ...ownedTripIds
      );
      db.prepare(`DELETE FROM trip_members WHERE tripId IN (${placeholders})`).run(
        ...ownedTripIds
      );
      db.prepare(`DELETE FROM trips WHERE id IN (${placeholders})`).run(
        ...ownedTripIds
      );

      /*
       * Re-insert. Only rows whose owning trip is in ownedTripIds are written,
       * so a payload cannot smuggle in a row owned by someone else. Trips are
       * force-owned by uid for the same reason.
       */
      const ownedSet = new Set(ownedTripIds);
      for (const t of s.trips) {
        if (ownedSet.has(t.id)) tx.insertTrip({ ...t, userId: uid });
      }
      for (const c of s.categories ?? []) {
        if (ownedSet.has(c.tripId)) tx.insertCategory(c);
      }
      for (const i of s.items ?? []) {
        const owning = i.tripId ?? null;
        if (owning && ownedSet.has(owning)) tx.insertItem(i);
      }
      for (const t of s.tasks ?? []) {
        if (ownedSet.has(t.tripId)) tx.insertTask(t);
      }
      for (const r of s.reservations ?? []) {
        if (ownedSet.has(r.tripId)) tx.insertReservation(r);
      }
    });

    run(userId, scoped);
  },

  /**
   * Delete every session belonging to a user.
   *
   * Called when an account is deleted. Without this a removed account keeps a
   * working cookie until the token expires, which reads as "I deleted the user
   * but they can still log in".
   */
  deleteSessionsForUser(userId: string): void {
    getDb().prepare("DELETE FROM sessions WHERE userId = ?").run(userId);
  },

  /**
   * Record a new session.
   *
   * The caller supplies the hash, never the raw token, so the plaintext token
   * never reaches the database layer.
   */
  insertSession(tokenHash: string, userId: string, expiresAt: string): void {
    getDb()
      .prepare(
        "INSERT INTO sessions (tokenHash, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)"
      )
      .run(tokenHash, userId, expiresAt, new Date().toISOString());
  },

  /** Remove a single session by token hash — the logout path. */
  deleteSessionByTokenHash(tokenHash: string): void {
    getDb().prepare("DELETE FROM sessions WHERE tokenHash = ?").run(tokenHash);
  },

  /** Drop expired sessions. Called opportunistically; not required for safety. */
  pruneExpiredSessions(now: string = new Date().toISOString()): number {
    const res = getDb().prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(now);
    return Number(res.changes ?? 0);
  },

  /**
   * Create a read-only share link for a trip.
   *
   * The token is generated with crypto.randomUUID rather than a counter or a
   * hash of the trip id: it is the only thing guarding the trip, so it must not
   * be guessable from a trip id an outsider could already have seen.
   */
  createShareToken(token: string, tripId: string): void {
    getDb()
      .prepare(
        "INSERT INTO share_tokens (token, tripId, createdAt) VALUES (?, ?, ?)"
      )
      .run(token, tripId, new Date().toISOString());
  },

  /** All share links for a trip, newest first. */
  listShareTokens(tripId: string): { token: string; createdAt: string }[] {
    return getDb()
      .prepare(
        "SELECT token, createdAt FROM share_tokens WHERE tripId = ? ORDER BY createdAt DESC"
      )
      .all(tripId) as { token: string; createdAt: string }[];
  },

  /**
   * Resolve a token to its trip id.
   *
   * Returns undefined for an unknown token so the caller can 404 without
   * distinguishing "never existed" from "revoked" — both should look the same
   * to someone holding a dead link.
   */
  resolveShareToken(token: string): string | undefined {
    const row = getDb()
      .prepare("SELECT tripId FROM share_tokens WHERE token = ?")
      .get(token) as { tripId: string } | undefined;
    return row?.tripId;
  },

  /** Revoke a single link. Scoped to the trip so one trip cannot delete another's. */
  deleteShareToken(token: string, tripId: string): void {
    getDb()
      .prepare("DELETE FROM share_tokens WHERE token = ? AND tripId = ?")
      .run(token, tripId);
  },
};
