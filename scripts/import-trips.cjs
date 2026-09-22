#!/usr/bin/env node
/**
 * import-trips.cjs — import a trip-packer export bundle into a database.
 *
 * The counterpart to export-trips.cjs. Runs on the target machine, so the two
 * halves need no shared filesystem: export on the laptop, scp the JSON, import
 * on the server.
 *
 * Design decisions that matter:
 *
 *   - Dry run by default. Importing touches live data, so nothing is written
 *     unless --apply is passed. The default run prints exactly what WOULD be
 *     inserted and makes no changes.
 *
 *   - New ids on every import. Trip ids are regenerated, so importing the same
 *     bundle twice yields two trips rather than an id collision or an
 *     overwrite. Re-pointing is also required because the source userId does
 *     not exist in the target.
 *
 *   - The userId is resolved explicitly. --user <email> names the destination
 *     account. Without it, the owner account is used, and if there is no owner
 *     the run stops rather than guessing.
 *
 *   - Everything is wrapped in one transaction. A failure part-way through
 *     leaves the database exactly as it was.
 *
 * Usage:
 *   node scripts/import-trips.cjs --file trips.json --list-users
 *   node scripts/import-trips.cjs --file trips.json                  # dry run
 *   node scripts/import-trips.cjs --file trips.json --user me@x.com --apply
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function dbPath() {
  return process.env.TRIP_PACKER_DB
    ? path.resolve(process.env.TRIP_PACKER_DB)
    : path.resolve(process.cwd(), "data", "trip-packer.db");
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// ── sqlite helpers ──────────────────────────────────────────────────────────
// Writes go through a temp SQL file and `.read`, because passing a multi-line
// script as a single argv element is fragile once it contains quotes.
function sqliteRead(sql) {
  const uri = `file:${dbPath()}?mode=ro`;
  try {
    return execFileSync("sqlite3", ["-json", uri, sql], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`sqlite3 read failed: ${err.stderr || err.message}`);
  }
}

function sqliteWrite(sql) {
  const tmp = path.join(
    require("os").tmpdir(),
    `tp-import-${crypto.randomBytes(6).toString("hex")}.sql`
  );
  fs.writeFileSync(tmp, sql);
  try {
    return execFileSync("sqlite3", [dbPath(), `.read ${tmp}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`sqlite3 write failed: ${err.stderr || err.message}`);
  } finally {
    fs.unlinkSync(tmp);
  }
}

function query(sql) {
  const out = sqliteRead(sql).trim();
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch {
    fail(`Could not parse sqlite3 output:\n${out.slice(0, 400)}`);
  }
}

function sq(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function uuid() {
  return crypto.randomUUID();
}

// ── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { file: null, user: null, apply: false, listUsers: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--file") a.file = argv[++i];
    else if (k === "--user") a.user = argv[++i];
    else if (k === "--apply") a.apply = true;
    else if (k === "--list-users") a.listUsers = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else fail(`Unknown argument: ${k}`);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
  Usage:
    node scripts/import-trips.cjs --file trips.json --list-users
    node scripts/import-trips.cjs --file trips.json [--user email]           # dry run
    node scripts/import-trips.cjs --file trips.json [--user email] --apply   # writes
`);
  process.exit(0);
}

// ── Users ───────────────────────────────────────────────────────────────────
function listUsers() {
  const rows = query(`SELECT id, name, email, isOwner FROM users ORDER BY isOwner DESC, name;`);
  if (!rows.length) {
    console.log(`\n  No users in ${dbPath()} — create one first:\n`);
    console.log(`    node scripts/create-account.cjs --email you@example.com --name "Your Name"\n`);
    return;
  }
  console.log(`\n  Users in ${dbPath()}:\n`);
  for (const u of rows) {
    console.log(
      `    ${(u.email || "(no email)").padEnd(34)} ${String(u.name).padEnd(16)}` +
        `${u.isOwner ? "OWNER" : ""}  ${u.id}`
    );
  }
  console.log();
}

if (args.listUsers) {
  listUsers();
  process.exit(0);
}

if (!args.file) fail("--file <bundle.json> is required. See --help.");

// ── Load bundle ─────────────────────────────────────────────────────────────
const bundlePath = path.resolve(args.file);
if (!fs.existsSync(bundlePath)) fail(`Bundle not found: ${bundlePath}`);

let bundle;
try {
  bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
} catch (err) {
  fail(`Could not parse ${bundlePath}: ${err.message}`);
}

if (bundle.format !== "trip-packer.export") {
  fail(`Not a trip-packer export (format='${bundle.format}'). Expected 'trip-packer.export'.`);
}
if (!Array.isArray(bundle.trips) || !bundle.trips.length) {
  fail("Bundle contains no trips.");
}

// ── Resolve destination user ────────────────────────────────────────────────
const users = query(`SELECT id, name, email, isOwner FROM users;`);
if (!users.length) {
  fail(
    `No users in ${dbPath()}.\n` +
      `      Create the account first:\n` +
      `        node scripts/create-account.cjs --email you@example.com --name "Your Name"`
  );
}

let targetUser;
if (args.user) {
  targetUser = users.find((u) => u.email === args.user || u.id === args.user);
  if (!targetUser) {
    fail(
      `No user matched "${args.user}".\n` +
        `      Run with --list-users to see valid emails and ids.`
    );
  }
} else {
  // The only unambiguous case is a single account. If more than one exists the
  // caller must say which, so a bulk import can never land in the wrong account.
  // An earlier revision accepted any single owner even when other accounts
  // existed, which silently imported into the owner -- the opposite of intent.
  if (users.length === 1) {
    targetUser = users[0];
  } else {
    fail(
      `${users.length} accounts exist, so the destination is ambiguous.\n` +
        `      Name it explicitly with --user <email>.\n` +
        `      Run with --list-users to see them.`
    );
  }
}

console.log(`\n  Bundle:  ${bundlePath}`);
console.log(`  Trips:   ${bundle.trips.length}`);
console.log(`  Target:  ${dbPath()}`);
console.log(`  Account: ${targetUser.email || targetUser.id} (${targetUser.name})`);
console.log();

// ── Build statements ────────────────────────────────────────────────────────
// Ids are regenerated and children are re-pointed via an old→new map. Column
// lists are taken from the DB itself, and unknown columns in the bundle are
// dropped so an older bundle still imports after a schema change.
function columnNames(table) {
  return query(`PRAGMA table_info(${table});`).map((r) => r.name);
}

const dbCols = {
  trips: columnNames("trips"),
  items: columnNames("items"),
  categories: columnNames("categories"),
  tasks: columnNames("tasks"),
  reservations: columnNames("reservations"),
};

function insert(table, row, overrides) {
  const cols = dbCols[table];
  const merged = { ...row, ...overrides };
  const present = cols.filter((c) => c in merged);
  const vals = present.map((c) => sq(merged[c]));
  return `INSERT INTO ${table} (${present.map((c) => `"${c}"`).join(", ")}) VALUES (${vals.join(", ")});`;
}

const statements = [];
const counts = { trips: 0, items: 0, categories: 0, tasks: 0, reservations: 0 };
const categoryIdMap = new Map();

for (const entry of bundle.trips) {
  const srcTrip = entry.trip;
  const newTripId = uuid();
  const now = new Date().toISOString();

  statements.push(
    insert("trips", srcTrip, {
      id: newTripId,
      userId: targetUser.id,
      updatedAt: now,
    })
  );
  counts.trips++;

  // Categories first: items reference categoryId.
  for (const cat of entry.categories || []) {
    const newCatId = uuid();
    categoryIdMap.set(cat.id, newCatId);
    statements.push(insert("categories", cat, { id: newCatId, tripId: newTripId }));
    counts.categories++;
  }

  for (const item of entry.items || []) {
    const mappedCat = categoryIdMap.get(item.categoryId);
    if (!mappedCat) {
      // A dangling categoryId would violate the FK. Drop the item rather than
      // writing broken data, and say so.
      console.log(
        `    ! skipping item "${item.name}" — its category was not in the bundle`
      );
      continue;
    }
    statements.push(
      insert("items", item, { id: uuid(), tripId: newTripId, categoryId: mappedCat })
    );
    counts.items++;
  }

  for (const task of entry.tasks || []) {
    statements.push(insert("tasks", task, { id: uuid(), tripId: newTripId }));
    counts.tasks++;
  }

  for (const res of entry.reservations || []) {
    statements.push(insert("reservations", res, { id: uuid(), tripId: newTripId }));
    counts.reservations++;
  }

  console.log(
    `    ${srcTrip.name}: ${(entry.items || []).length} items, ` +
      `${(entry.reservations || []).length} reservations, ` +
      `${(entry.categories || []).length} categories, ${(entry.tasks || []).length} tasks`
  );
}

console.log();

if (!args.apply) {
  console.log("  DRY RUN — nothing written.\n");
  console.log(`  Would insert: ${counts.trips} trips, ${counts.items} items, ` +
    `${counts.categories} categories, ${counts.tasks} tasks, ${counts.reservations} reservations\n`);
  console.log("  Re-run with --apply to write.\n");
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────
// One transaction: either every row lands or none does.
const script = ["PRAGMA foreign_keys = ON;", "BEGIN;", ...statements, "COMMIT;"].join("\n");

sqliteWrite(script);

console.log("  ✓ Imported\n");
console.log(`    ${counts.trips} trips, ${counts.items} items, ${counts.categories} categories, ` +
  `${counts.tasks} tasks, ${counts.reservations} reservations\n`);

// Verify by reading back, rather than trusting the write to have worked.
const verify = query(
  `SELECT t.name, (SELECT COUNT(*) FROM items i WHERE i.tripId = t.id) AS items
     FROM trips t WHERE t.userId = ${sq(targetUser.id)} ORDER BY t.createdAt DESC
     LIMIT ${counts.trips};`
);
console.log("  Read back from the database:");
for (const v of verify) {
  console.log(`    ${v.name} — ${v.items} items`);
}
console.log();
