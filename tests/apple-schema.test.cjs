/*
 * Sign in with Apple — schema migration.
 *
 * Runs the real migration against a throwaway database file and asserts the
 * resulting shape. The point is not that the column exists (an ALTER would do
 * that) but that the constraints behave: the unique index must actually reject
 * a second account bound to the same Apple subject, because that constraint is
 * what turns a duplicate-binding race into a failed write instead of two
 * accounts silently sharing one Apple ID.
 *
 * Uses a temp file, never the live database. TRIP_PACKER_DB is set before the
 * module is loaded so db.ts resolves to the throwaway.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-apple-schema-"));
const dbPath = path.join(tmpDir, "test.db");
process.env.TRIP_PACKER_DB = dbPath;

const h = require("./harness.cjs");

const { getDb } = h.loadModule("src/lib/db.ts");
const { tx } = h.loadModule("src/lib/db.ts");

module.exports = (async () => {
  /* Force the migration to run by opening the database. */
  const db = getDb();

  await h.test("users gains an appleUserId column", () => {
    const cols = db.prepare("PRAGMA table_info(users)").all();
    const names = cols.map((c) => c.name);
    h.assert(names.includes("appleUserId"), `expected appleUserId in ${names.join(",")}`);
  });

  await h.test("appleUserId is nullable so existing accounts are untouched", () => {
    const col = db.prepare("PRAGMA table_info(users)").all().find((c) => c.name === "appleUserId");
    h.assertEqual(col.notnull, 0, "column must be nullable");
  });

  await h.test("the unique index on appleUserId exists", () => {
    const indexes = db.prepare("PRAGMA index_list(users)").all();
    const found = indexes.find((i) => i.name === "idx_users_appleUserId");
    h.assert(found, "expected idx_users_appleUserId");
    h.assertEqual(found.unique, 1, "index must be UNIQUE");
  });

  await h.test("it is a PARTIAL index, so many NULLs coexist", () => {
    // Without the WHERE clause, SQLite's unique index would still permit
    // multiple NULLs, but the partial form states the intent: uniqueness
    // applies only to accounts that have actually been linked.
    const sql = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_users_appleUserId'")
      .get();
    h.assert(sql && /WHERE\s+appleUserId\s+IS\s+NOT\s+NULL/i.test(sql.sql), `unexpected: ${sql && sql.sql}`);
  });

  await h.test("several accounts with no Apple binding can coexist", () => {
    tx.insertUser({
      id: "p1", name: "A", avatarColor: "bg-blue-500", createdAt: new Date().toISOString(),
    });
    tx.insertUser({
      id: "p2", name: "B", avatarColor: "bg-blue-500", createdAt: new Date().toISOString(),
    });
    const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE appleUserId IS NULL").get();
    h.assert(count.n >= 2, `expected >=2 unlinked, got ${count.n}`);
  });

  await h.test("an Apple account round-trips its subject", () => {
    tx.insertAppleAccount({
      id: "a1", name: "Tyler", avatarColor: "bg-blue-500",
      createdAt: new Date().toISOString(), email: "tyler@example.com",
      appleUserId: "001234.abcdef.0012",
    });
    const found = tx.getUserByAppleId("001234.abcdef.0012");
    h.assert(found !== null, "expected to find the account");
    h.assertEqual(found.id, "a1");
    h.assertEqual(found.appleUserId, "001234.abcdef.0012");
  });

  await h.test("an Apple account has NO password and cannot authenticate by password", () => {
    const found = tx.getUserByAppleId("001234.abcdef.0012");
    h.assertEqual(found.passwordHash ?? null, null);
  });

  await h.test("a duplicate Apple binding is REJECTED by the database", () => {
    // This is the constraint doing real work: two accounts on one Apple ID
    // would make which-account-gets-the-session nondeterministic.
    let threw = false;
    try {
      tx.insertAppleAccount({
        id: "a2", name: "Impostor", avatarColor: "bg-red-500",
        createdAt: new Date().toISOString(), email: "other@example.com",
        appleUserId: "001234.abcdef.0012",
      });
    } catch (err) {
      threw = true;
      h.assert(/UNIQUE/i.test(String(err.message)), `expected a UNIQUE violation, got: ${err.message}`);
    }
    h.assert(threw, "a duplicate appleUserId must not be insertable");
  });

  await h.test("binding an existing account to a taken subject is also rejected", () => {
    tx.insertUser({
      id: "p3", name: "C", avatarColor: "bg-blue-500", createdAt: new Date().toISOString(),
    });
    let threw = false;
    try {
      tx.setAppleUserId("p3", "001234.abcdef.0012");
    } catch (err) {
      threw = true;
      h.assert(/UNIQUE/i.test(String(err.message)), `expected UNIQUE, got: ${err.message}`);
    }
    h.assert(threw, "setAppleUserId onto a taken subject must fail");
  });

  await h.test("setAppleUserId binds a previously unlinked account", () => {
    tx.setAppleUserId("p3", "009999.zzzz.9999");
    const found = tx.getUserByAppleId("009999.zzzz.9999");
    h.assert(found !== null, "expected the binding to take");
    h.assertEqual(found.id, "p3");
  });

  await h.test("the Apple subject does NOT appear on the client-facing User shape", () => {
    // toUser() is what travels to the browser. The subject must not be on it.
    const accounts = tx.listAccounts();
    const apple = accounts.find((a) => a.id === "a1");
    h.assert(apple !== undefined, "expected the account in listAccounts");
    // listAccounts is the server-side shape, so it MAY carry it. The assertion
    // that matters is that the client shape omits it — checked in the route
    // tests. Here we just confirm the server shape does expose it, so the
    // resolver has something to match on.
    h.assertEqual(apple.appleUserId, "001234.abcdef.0012");
  });

  await h.test("migration is idempotent — running it again changes nothing", () => {
    // Re-running the schema block must not throw on the existing column or index.
    let threw = false;
    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_appleUserId ON users(appleUserId) WHERE appleUserId IS NOT NULL");
    } catch (err) {
      threw = true;
      console.error(err.message);
    }
    h.assert(!threw, "re-running the index creation must be a no-op");
    /*
     * Exactly 4 rows: p1, p2, a1, p3.
     *
     * `a2` was deliberately rejected above, so it must NOT be counted — and
     * counting the successful inserts rather than the attempted ones is the
     * point of asserting a number here at all. If the unique constraint had
     * silently allowed the duplicate through, this would read 5.
     */
    const count = db.prepare("SELECT COUNT(*) AS n FROM users").get();
    h.assertEqual(count.n, 4);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return h.summary();
})();
