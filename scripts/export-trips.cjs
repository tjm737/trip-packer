#!/usr/bin/env node
/**
 * export-trips.cjs — copy trips out of a database into a portable JSON bundle.
 *
 * Why not `cp data/trip-packer.db`:
 *
 *   1. WAL. The DB runs in WAL mode, so the .db file is a 4 KB stub and the
 *      real rows live in trip-packer.db-wal. A plain copy silently produces an
 *      empty database that still passes `PRAGMA integrity_check`.
 *
 *   2. Scope. The DB also holds `sessions` (login cookies), `login_attempts`
 *      (rate limiting) and `geocache`. Copying the file wholesale transplants
 *      all of it. This moves only trip content.
 *
 *   3. Identity. The source userId will not exist in the target, so the import
 *      re-points trips at a named account anyway.
 *
 * Usage:
 *   node scripts/export-trips.cjs --list
 *   node scripts/export-trips.cjs --export --all --out trips.json
 *   node scripts/export-trips.cjs --export --trip "Iceland Ring Road" --out trip.json
 *
 * Database access goes through scripts/triplib.cjs, which prefers the
 * better-sqlite3 npm package and falls back to the sqlite3 CLI. See that file
 * for why the CLI alone is not sufficient.
 */

const fs = require("fs");
const path = require("path");
const { query, dbPath, fail } = require("./triplib.cjs");

// ── Args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { trip: null, out: null, all: false, list: false, export: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") args.list = true;
    else if (a === "--export") args.export = true;
    else if (a === "--all") args.all = true;
    else if (a === "--trip") args.trip = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else fail(`Unknown argument: ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function usage() {
  console.log(`
  Usage:
    node scripts/export-trips.cjs --list
    node scripts/export-trips.cjs --export --all --out trips.json
    node scripts/export-trips.cjs --export --trip "Iceland Ring Road" --out trip.json
`);
}

if (args.help || (!args.list && !args.all && !args.trip)) {
  usage();
  process.exit(args.help ? 0 : 1);
}

// ── Schema helpers ──────────────────────────────────────────────────────────
// Read from the DB rather than hardcoding, so a schema change shows up as a
// clear error instead of a silent partial export.
function columnsOf(table) {
  const rows = query(`PRAGMA table_info(${table});`);
  if (!rows.length) fail(`Table not found: ${table}`);
  return rows.map((r) => r.name);
}

function tableExists(table) {
  return (
    query(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?;`, [table])
      .length > 0
  );
}

// ── List ────────────────────────────────────────────────────────────────────
function listTrips() {
  const rows = query(`
    SELECT t.id, t.name, t.destination, t.startDate, t.endDate,
           (SELECT COUNT(*) FROM items i WHERE i.tripId = t.id) AS items,
           (SELECT COUNT(*) FROM reservations r WHERE r.tripId = t.id) AS reservations
      FROM trips t
     ORDER BY t.createdAt;
  `);
  if (!rows.length) {
    console.log(`\n  No trips in ${dbPath()}\n`);
    return;
  }
  console.log(`\n  ${dbPath()}\n`);
  console.log(
    "  " + "NAME".padEnd(24) + "DESTINATION".padEnd(20) + "DATES".padEnd(24) +
      "ITEMS".padStart(6) + "RESV".padStart(6) + "  ID"
  );
  console.log("  " + "-".repeat(104));
  for (const r of rows) {
    const dates = r.startDate || r.endDate
      ? `${r.startDate || "?"} → ${r.endDate || "?"}`
      : "(none)";
    console.log(
      "  " + String(r.name).slice(0, 23).padEnd(24) +
        String(r.destination || "").slice(0, 19).padEnd(20) +
        dates.padEnd(24) +
        String(r.items).padStart(6) + String(r.reservations).padStart(6) +
        "  " + r.id
    );
  }
  console.log();
}

// ── Export ──────────────────────────────────────────────────────────────────
function exportTrips() {
  let trips;
  if (args.all) {
    trips = query(`SELECT * FROM trips ORDER BY createdAt;`);
  } else {
    // Exact id or exact name only. A LIKE match would be a footgun: "--trip
    // Munich" silently grabbing two trips is not a mistake worth enabling.
    trips = query(`SELECT * FROM trips WHERE id = ? OR name = ?;`, [args.trip, args.trip]);
    if (!trips.length) {
      fail(
        `No trip matched "${args.trip}".\n` +
          `      Run with --list to see exact names and ids.`
      );
    }
  }

  const bundle = {
    format: "trip-packer.export",
    version: 1,
    exportedAt: new Date().toISOString(),
    trips: [],
  };

  for (const trip of trips) {
    const entry = {
      trip,
      items: query(`SELECT * FROM items WHERE tripId = ? ORDER BY rowid;`, [trip.id]),
      categories: [],
      tasks: [],
      reservations: [],
    };
    // Guarded by hasTable AND hasColumn: an older or newer schema should degrade
    // to an empty section, not throw.
    if (tableExists("categories") && columnsOf("categories").includes("tripId")) {
      entry.categories = query(`SELECT * FROM categories WHERE tripId = ?;`, [trip.id]);
    }
    if (tableExists("tasks") && columnsOf("tasks").includes("tripId")) {
      entry.tasks = query(`SELECT * FROM tasks WHERE tripId = ?;`, [trip.id]);
    }
    if (tableExists("reservations") && columnsOf("reservations").includes("tripId")) {
      entry.reservations = query(`SELECT * FROM reservations WHERE tripId = ?;`, [trip.id]);
    }
    bundle.trips.push(entry);
    console.log(
      `  ✓ ${trip.name}  (${entry.items.length} items, ${entry.reservations.length} reservations, ` +
        `${entry.categories.length} categories, ${entry.tasks.length} tasks)`
    );
  }

  const out = args.out || "trips.json";
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  const kb = (fs.statSync(out).size / 1024).toFixed(1);
  console.log(`\n  Wrote ${bundle.trips.length} trip(s), ${kb} KB → ${path.resolve(out)}\n`);
  console.log("  Trip content only. No password hashes, no sessions, no");
  console.log("  login_attempts — those stay on the source machine.\n");
}

if (args.list && !args.export) {
  listTrips();
} else {
  exportTrips();
}
