/**
 * triplib.cjs — shared database access for the export/import scripts.
 *
 * Why this exists: the first version of these scripts shelled out to the
 * `sqlite3` command-line tool. That tool is NOT installed on the production
 * server, so the import died with `spawnSync sqlite3 ENOENT`. The app itself
 * was fine, because it uses better-sqlite3, an npm package that bundles its
 * own SQLite.
 *
 * So: prefer better-sqlite3 (guaranteed present wherever the app runs, since
 * it is a production dependency), and fall back to the sqlite3 CLI only if
 * that module cannot be loaded. The CLI fallback keeps the scripts usable in a
 * bare checkout with no npm install.
 *
 * Neither path copies the database file. The DB runs in WAL mode, where the
 * .db is a stub and the real rows live in -wal; a file copy produces an empty
 * database that still passes integrity_check. Both paths here open the DB
 * properly, so SQLite replays the WAL itself.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

// Must stay in step with src/lib/db.ts: TRIP_PACKER_DB, else <cwd>/data/trip-packer.db
function dbPath() {
  return process.env.TRIP_PACKER_DB
    ? path.resolve(process.env.TRIP_PACKER_DB)
    : path.resolve(process.cwd(), "data", "trip-packer.db");
}

// ── Backend detection ───────────────────────────────────────────────────────
let _Database = null;
let _backend = null;

function backend() {
  if (_backend) return _backend;
  try {
    _Database = require("better-sqlite3");
    _backend = "better-sqlite3";
  } catch {
    try {
      execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
      _backend = "sqlite3-cli";
    } catch {
      fail(
        "No SQLite backend available.\n" +
          "      Tried: better-sqlite3 (npm) and the sqlite3 CLI.\n" +
          "      Run `npm install` in the repo root, which provides better-sqlite3."
      );
    }
  }
  return _backend;
}

// ── Reads ───────────────────────────────────────────────────────────────────
/**
 * Read-only. Uses SQLite's own readonly mode so the WAL is replayed into the
 * snapshot without writing anything back to disk.
 */
function query(sql, params = []) {
  const db = dbPath();
  if (!fs.existsSync(db)) {
    fail(`Database not found: ${db}`);
  }

  if (backend() === "better-sqlite3") {
    let conn;
    try {
      conn = new _Database(db, { readonly: true, fileMustExist: true });
      return conn.prepare(sql).all(...params);
    } catch (err) {
      fail(`SQLite read failed: ${err.message}\n      SQL: ${sql.slice(0, 200)}`);
    } finally {
      if (conn) conn.close();
    }
  }

  // CLI fallback. -json needs sqlite3 >= 3.33 (2020); if that is missing we say
  // so explicitly rather than emitting a confusing parse error.
  const uri = `file:${db}?mode=ro`;
  let out;
  try {
    out = execFileSync("sqlite3", ["-json", uri, sql], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`sqlite3 read failed: ${err.stderr || err.message}`);
  }
  const trimmed = out.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    fail(
      `Could not parse sqlite3 -json output. The sqlite3 CLI needs to be >= 3.33.\n` +
        `      Either upgrade sqlite3 or run \`npm install\` so better-sqlite3 is used.\n` +
        `      Output began: ${trimmed.slice(0, 200)}`
    );
  }
}

/**
 * Writes inside a single transaction. Takes a function so the caller cannot
 * forget COMMIT, and so a throw midway rolls back cleanly.
 *
 * `fn` receives a `run(sql, params)` helper. Values go through bind parameters,
 * never string interpolation, which removes any quoting concerns.
 */
function transaction(fn) {
  const db = dbPath();

  if (backend() === "better-sqlite3") {
    let conn;
    try {
      conn = new _Database(db, { fileMustExist: true });
      conn.pragma("foreign_keys = ON");
      const run = (sql, params = []) => conn.prepare(sql).run(...params);
      const wrapped = conn.transaction(() => fn(run));
      wrapped();
      return;
    } catch (err) {
      fail(`SQLite write failed (rolled back): ${err.message}`);
    } finally {
      if (conn) conn.close();
    }
  }

  // CLI fallback: build one script and run it as a single transaction.
  const statements = [];
  const run = (sql, params = []) => statements.push(interpolate(sql, params));
  const tmp = path.join(os.tmpdir(), `tp-${crypto.randomBytes(6).toString("hex")}.sql`);
  try {
    fn(run);
    fs.writeFileSync(
      tmp,
      ["PRAGMA foreign_keys = ON;", "BEGIN;", ...statements, "COMMIT;"].join("\n")
    );
    execFileSync("sqlite3", [db, `.read ${tmp}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail(`sqlite3 write failed: ${err.stderr || err.message}`);
  } finally {
    fs.unlinkSync(tmp);
  }
}

// Only used on the CLI-fallback path, which has no bind parameters. Escaping is
// the available mechanism there; the better-sqlite3 path never reaches this.
function interpolate(sql, params) {
  let i = 0;
  return sql.replace(/\?/g, () => sqlLiteral(params[i++]));
}

function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function uuid() {
  return crypto.randomUUID();
}

module.exports = { query, transaction, dbPath, uuid, fail, backend };
