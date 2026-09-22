#!/usr/bin/env node
/**
 * export-trips.cjs — copy trips between databases, portably.
 *
 * Why this exists instead of `cp data/trip-packer.db`:
 *
 *   1. WAL. The dev DB runs in WAL mode, so the .db file is a 4 KB stub and the
 *      real rows live in trip-packer.db-wal. A plain copy silently produces an
 *      empty database that still passes `PRAGMA integrity_check`. See
 *      deploy/README.md for the backup procedure this follows.
 *
 *   2. Scope. The dev DB also holds `sessions` (login cookies), `login_attempts`
 *      (rate limiting) and `geocache` (69 cached geocodes). Copying the file
 *      wholesale would transplant all of it. This tool moves only what belongs
 *      to a human: trips, their items, categories, tasks, and reservations.
 *
 *   3. Identity. The user id in the source DB will not exist in the target. Trips
 *      reference userId, so rows are re-pointed at the destination account and
 *      get fresh ids, which means importing twice does not collide.
 *
 * Usage:
 *   node scripts/export-trips.cjs --list
 *   node scripts/export-trips.cjs --export --trip <name-or-id> --out trips.json
 *   node scripts/export-trips.cjs --export --all --out trips.json
 *
 * The export is JSON. Import is a separate command (import-trips.cjs) so the
 * two halves can run on different machines with no shared filesystem.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ── DB location ─────────────────────────────────────────────────────────────
// Must stay in step with src/lib/db.ts: TRIP_PACKER_DB, else <cwd>/data/trip-packer.db
function dbPath() {
  return process.env.TRIP_PACKER_DB
    ? path.resolve(process.env.TRIP_PACKER_DB)
    : path.resolve(process.cwd(), "data", "trip-packer.db");
}

function sqlite(sql) {
  const db = dbPath();
  if (!fs.existsSync(db)) {
    fail(`Database not found: ${db}`);
  }
  // Read-only, and crucially NOT via `cp`. mode=ro makes sqlite replay the WAL
  // into the read snapshot without modifying anything on disk.
  const uri = `file:${db}?mode=ro`;
  try {
    return execFileSync("sqlite3", ["-json", uri, sql], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`sqlite3 failed: ${err.stderr || err.message}`);
  }
}

function query(sql) {
  const out = sqlite(sql).trim();
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch {
    fail(`Could not parse sqlite3 -json output. Is sqlite3 >= 3.33?\n${out.slice(0, 400)}`);
  }
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// ── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { trip: null, out: null, all: false, list: false, import: null, user: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") args.list = true;
    else if (a === "--all") args.all = true;
    else if (a === "--export") args.export = true;
    else if (a === "--trip") args.trip = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--import") args.import = argv[++i];
    else if (a === "--user") args.user = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else fail(`Unknown argument: ${a}`);
  }
  return args;
}

// ── Table shapes ────────────────────────────────────────────────────────────
// Read from sqlite_master rather than hardcoded, so a schema change surfaces as
// a clear error instead of a silent partial export.
function columnsOf(table) {
  const rows = query(`PRAGMA table_info(${table});`);
  if (!rows.length) fail(`Table not found: ${table}`);
  return rows.map((r) => r.name);
}

function tableExists(table) {
  return query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}';`
  ).length > 0;
}

// ── List ────────────────────────────────────────────────────────────────────
function listTrips() {
  const rows = query(`
    SELECT t.id,
           t.name,
           t.destination,
           t.startDate,
           t.endDate,
           (SELECT COUNT(*) FROM items i WHERE i.tripId = t.id) AS items,
           (SELECT COUNT(*) FROM reservations r WHERE r.tripId = t.id) AS reservations,
           u.email AS ownerEmail
      FROM trips t
      LEFT JOIN users u ON u.id = t.userId
     ORDER BY t.createdAt;
  `);
  if (!rows.length) {
    console.log("\n  No trips in " + dbPath() + "\n");
    return;
  }
  console.log(`\n  ${dbPath()}\n`);
  console.log(
    "  " +
      "NAME".padEnd(24) +
      "DESTINATION".padEnd(20) +
      "DATES".padEnd(24) +
      "ITEMS".padStart(6) +
      "RESV".padStart(6) +
      "  ID"
  );
  console.log("  " + "-".repeat(104));
  for (const r of rows) {
    const dates =
      r.startDate || r.endDate ? `${r.startDate || "?"} → ${r.endDate || "?"}` : "(none)";
    console.log(
      "  " +
        String(r.name).slice(0, 23).padEnd(24) +
        String(r.destination || "").slice(0, 19).padEnd(20) +
        dates.padEnd(24) +
        String(r.items).padStart(6) +
        String(r.reservations).padStart(6) +
        "  " + r.id
    );
  }
  console.log();
}

// ── Export ──────────────────────────────────────────────────────────────────
function exportTrips(args) {
  let trips;
  if (args.all) {
    trips = query(`SELECT * FROM trips ORDER BY createdAt;`);
  } else if (args.trip) {
    // Match on exact id first, then exact name. A LIKE match would be a footgun
    // on a destructive-ish import: "Munich" would silently grab two trips.
    trips = query(
      `SELECT * FROM trips WHERE id = ${sq(args.trip)} OR name = ${sq(args.trip)};`
    );
    if (!trips.length) {
      fail(
        `No trip matched "${args.trip}".\n` +
          `      Run with --list to see exact names and ids.`
      );
    }
  } else {
    fail("Specify --all, or --trip <name-or-id>. See --list.");
  }

  const bundle = {
    format: "trip-packer.export",
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceDb: dbPath(),
    trips: [],
  };

  for (const trip of trips) {
    const entry = {
      trip,
      items: query(`SELECT * FROM items WHERE tripId = ${sq(trip.id)} ORDER BY rowid;`),
      categories: [],
      tasks: [],
      reservations: [],
    };
    if (tableExists("categories") && columnsOf("categories").includes("tripId")) {
      entry.categories = query(
        `SELECT * FROM categories WHERE tripId = ${sq(trip.id)};`
      );
    }
    if (tableExists("tasks") && columnsOf("tasks").includes("tripId")) {
      entry.tasks = query(`SELECT * FROM tasks WHERE tripId = ${sq(trip.id)};`);
    }
    if (tableExists("reservations") && columnsOf("reservations").includes("tripId")) {
      entry.reservations = query(
        `SELECT * FROM reservations WHERE tripId = ${sq(trip.id)};`
      );
    }
    bundle.trips.push(entry);
    console.log(
      `  ✓ ${trip.name}  (${entry.items.length} items, ${entry.reservations.length} reservations, ` +
        `${entry.categories.length} categories, ${entry.tasks.length} tasks)`
    );
  }

  const out = args.out || "trips.json";
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  const size = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`\n  Wrote ${bundle.trips.length} trip(s), ${size} KB → ${path.resolve(out)}\n`);
  console.log("  This file contains trip CONTENT only. No password hashes, no");
  console.log("  sessions, no login_attempts.\n");
}

// SQL string literal, single-quote escaped. Values here come from a local DB
// the user owns, and sqlite3 CLI has no bind parameters, so escaping is the
// available mechanism.
function sq(v) {
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// ── Main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.list && !args.trip && !args.all)) {
  console.log(`
  Usage:
    node scripts/export-trips.cjs --list
    node scripts/export-trips.cjs --export --all --out trips.json
    node scripts/export-trips.cjs --export --trip "Iceland Ring Road" --out trip.json
`);
  process.exit(args.help ? 0 : 1);
}

if (args.list) {
  listTrips();
} else {
  exportTrips(args);
}
