#!/usr/bin/env node
/**
 * import-trips.cjs — import a trip-packer export bundle into a database.
 *
 * Counterpart to export-trips.cjs. Runs on the target machine, so the two
 * halves need no shared filesystem: export on the laptop, copy the JSON,
 * import on the server.
 *
 * Design decisions that matter:
 *
 *   - Dry run by default. Nothing is written without --apply, because this
 *     touches live data.
 *
 *   - Fresh ids on every import. Trip ids are regenerated, so importing twice
 *     produces two trips rather than an id collision or an overwrite. It also
 *     has to happen, because the source userId does not exist in the target.
 *
 *   - The destination account is explicit. With more than one account in the
 *     DB the run refuses rather than guessing, so a bulk import can never land
 *     in the wrong account.
 *
 *   - One transaction. A failure part-way leaves the database untouched.
 *
 *   - Reads back afterwards, rather than trusting the write.
 *
 * Usage:
 *   node scripts/import-trips.cjs --file trips.json --list-users
 *   node scripts/import-trips.cjs --file trips.json                    # dry run
 *   node scripts/import-trips.cjs --file trips.json --user me@x.com --apply
 *
 * Database access goes through scripts/triplib.cjs, which prefers the
 * better-sqlite3 npm package and falls back to the sqlite3 CLI.
 */

const fs = require("fs");
const path = require("path");
const { query, transaction, dbPath, uuid, fail, backend } = require("./triplib.cjs");

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
  const rows = query(
    `SELECT id, name, email, isOwner FROM users ORDER BY isOwner DESC, name;`
  );
  if (!rows.length) {
    console.log(`\n  No accounts in ${dbPath()} — create one first:\n`);
    console.log(`    node scripts/create-account.cjs --email you@example.com --name "Your Name"\n`);
    return;
  }
  console.log(`\n  Accounts in ${dbPath()}:\n`);
  for (const u of rows) {
    console.log(
      `    ${(u.email || "(no email)").padEnd(34)}${String(u.name).padEnd(18)}` +
        `${u.isOwner ? "OWNER" : "     "}  ${u.id}`
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

// ── Resolve destination account ─────────────────────────────────────────────
const users = query(`SELECT id, name, email, isOwner FROM users;`);
if (!users.length) {
  fail(
    `No accounts in ${dbPath()}.\n` +
      `      Create one first:\n` +
      `        node scripts/create-account.cjs --email you@example.com --name "Your Name"`
  );
}

let targetUser;
if (args.user) {
  targetUser = users.find((u) => u.email === args.user || u.id === args.user);
  if (!targetUser) {
    fail(
      `No account matched "${args.user}".\n` +
        `      Run with --list-users to see valid emails and ids.`
    );
  }
} else {
  // The only unambiguous case is a single account. With more than one, the
  // caller must say which. An earlier revision accepted a single owner even
  // when other accounts existed, which silently imported into the owner -- the
  // opposite of the intent.
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

console.log(`\n  Database: ${dbPath()}  (via ${backend()})`);
console.log(`  Bundle:   ${bundlePath}`);
console.log(`  Trips:    ${bundle.trips.length}`);
console.log(`  Account:  ${targetUser.email || targetUser.id} (${targetUser.name})`);
console.log();

// ── Build the work ──────────────────────────────────────────────────────────
// Columns come from the DB, and bundle columns the DB does not have are
// dropped, so a bundle from a slightly different schema still imports.
const dbCols = {
  trips: query(`PRAGMA table_info(trips);`).map((r) => r.name),
  items: query(`PRAGMA table_info(items);`).map((r) => r.name),
  categories: query(`PRAGMA table_info(categories);`).map((r) => r.name),
  tasks: query(`PRAGMA table_info(tasks);`).map((r) => r.name),
  reservations: query(`PRAGMA table_info(reservations);`).map((r) => r.name),
};

const plan = []; // { table, row } in dependency order
const counts = { trips: 0, items: 0, categories: 0, tasks: 0, reservations: 0 };
let skipped = 0;

for (const entry of bundle.trips) {
  const srcTrip = entry.trip;
  const newTripId = uuid();
  const now = new Date().toISOString();

  plan.push({
    table: "trips",
    row: { ...srcTrip, id: newTripId, userId: targetUser.id, updatedAt: now },
  });
  counts.trips++;

  // Categories before items: items reference categoryId.
  const catMap = new Map();
  for (const cat of entry.categories || []) {
    const newCatId = uuid();
    catMap.set(cat.id, newCatId);
    plan.push({ table: "categories", row: { ...cat, id: newCatId, tripId: newTripId } });
    counts.categories++;
  }

  for (const item of entry.items || []) {
    const mappedCat = catMap.get(item.categoryId);
    if (!mappedCat) {
      // Writing a dangling categoryId would violate the FK. Drop the item and
      // say so rather than importing broken data.
      console.log(`    ! skipping item "${item.name}" — its category is not in the bundle`);
      skipped++;
      continue;
    }
    plan.push({
      table: "items",
      row: { ...item, id: uuid(), tripId: newTripId, categoryId: mappedCat },
    });
    counts.items++;
  }

  for (const task of entry.tasks || []) {
    plan.push({ table: "tasks", row: { ...task, id: uuid(), tripId: newTripId } });
    counts.tasks++;
  }

  for (const res of entry.reservations || []) {
    plan.push({ table: "reservations", row: { ...res, id: uuid(), tripId: newTripId } });
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
  console.log(
    `  Would insert: ${counts.trips} trips, ${counts.items} items, ${counts.categories} categories, ` +
      `${counts.tasks} tasks, ${counts.reservations} reservations\n`
  );
  if (skipped) console.log(`  Would skip ${skipped} orphaned item(s).\n`);
  console.log("  Re-run with --apply to write.\n");
  process.exit(0);
}

// ── Apply ───────────────────────────────────────────────────────────────────
transaction((run) => {
  for (const { table, row } of plan) {
    const cols = dbCols[table].filter((c) => c in row);
    const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) ` +
      `VALUES (${cols.map(() => "?").join(", ")});`;
    run(sql, cols.map((c) => row[c]));
  }
});

console.log("  ✓ Imported\n");
console.log(
  `    ${counts.trips} trips, ${counts.items} items, ${counts.categories} categories, ` +
    `${counts.tasks} tasks, ${counts.reservations} reservations\n`
);

// Read back from the database rather than trusting that the write landed.
const verify = query(
  `SELECT t.name, (SELECT COUNT(*) FROM items i WHERE i.tripId = t.id) AS items
     FROM trips t WHERE t.userId = ? ORDER BY t.createdAt DESC LIMIT ${counts.trips};`,
  [targetUser.id]
);
console.log("  Read back from the database:");
for (const v of verify) {
  console.log(`    ${v.name} — ${v.items} items`);
}
console.log();
