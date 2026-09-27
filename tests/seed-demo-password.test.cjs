/**
 * The demo-account password can now arrive three ways. Precedence matters:
 * an explicit --password must never be silently overridden by an ambient env
 * var, or a deploy script exporting a default would quietly reset a password
 * someone deliberately chose.
 *
 * These tests drive the real CLI against a throwaway DB, so they also assert
 * the thing that actually matters: the hash round-trips, i.e. the credential
 * the script prints is the credential that logs in.
 */

const h = require("./harness.cjs");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "seed-demo.cjs");

/** Run the seeder against a fresh temp DB and return { db, stdout }. */
function seed({ password, envPassword, extraArgs = [] } = {}) {
  const db = path.join(
    os.tmpdir(),
    `tp-seed-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  const args = [SCRIPT, ...extraArgs];
  if (password !== undefined) args.push("--password", password);

  const env = { ...process.env, TRIP_PACKER_DB: db };
  if (envPassword === undefined) delete env.TRIP_PACKER_DEMO_PASSWORD;
  else env.TRIP_PACKER_DEMO_PASSWORD = envPassword;

  const stdout = execFileSync(process.execPath, args, { env, encoding: "utf8" });
  return { db, stdout };
}

/** The credential block the script prints for pasting into App Store Connect. */
function printedPassword(stdout) {
  const lines = stdout.split("\n").map((l) => l.trim());
  const i = lines.findIndex((l) => l === "appreview@trips.planetracker.app");
  return i === -1 ? undefined : lines[i + 1];
}

/** Verify a password authenticates, using the app's OWN verifier. */
function hashRoundTrips(db, email, password) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(db, { readonly: true });
  try {
    const row = sqlite
      .prepare("SELECT passwordHash FROM users WHERE email = ?")
      .get(email);
    if (!row) return { ok: false, reason: "no such user" };

    // Reuse the real implementation rather than restating the algorithm here:
    // a hand-rolled copy of the hash format is exactly how a test drifts away
    // from the code it claims to check.
    const auth = h.loadModule("src/lib/auth.ts");
    return { ok: auth.verifyPassword(password, row.passwordHash) };
  } finally {
    sqlite.close();
  }
}

(async () => {
  // --- explicit flag ------------------------------------------------------
  await h.test("--password is used and printed", () => {
    const { db, stdout } = seed({ password: "FlagChosen123!" });
    h.assertEqual(printedPassword(stdout), "FlagChosen123!");
    h.assert(hashRoundTrips(db, "appreview@trips.planetracker.app", "FlagChosen123!").ok,
      "the printed password must be the one that logs in");
    fs.rmSync(db, { force: true });
  });

  // --- env var ------------------------------------------------------------
  await h.test("env var is used when no flag is given", () => {
    const { db, stdout } = seed({ envPassword: "EnvChosen123!" });
    h.assertEqual(printedPassword(stdout), "EnvChosen123!");
    h.assert(hashRoundTrips(db, "appreview@trips.planetracker.app", "EnvChosen123!").ok,
      "the printed password must be the one that logs in");
    fs.rmSync(db, { force: true });
  });

  // --- precedence: this is the regression that matters ---------------------
  await h.test("--password beats the env var (env must not override a deliberate choice)", () => {
    const { db, stdout } = seed({ password: "ArgWins123!", envPassword: "EnvLoses123!" });
    h.assertEqual(printedPassword(stdout), "ArgWins123!");
    h.assert(hashRoundTrips(db, "appreview@trips.planetracker.app", "ArgWins123!").ok);
    fs.rmSync(db, { force: true });
  });

  // --- generation still the fallback ---------------------------------------
  await h.test("omitting both generates a password (word-word-wordNN shape)", () => {
    const { db, stdout } = seed({});
    const pw = printedPassword(stdout);
    h.assert(pw, "a password should have been printed");
    h.assert(/^[a-z]+-[a-z]+-[a-z]+\d{2}$/.test(pw),
      `generated password should be word-word-wordNN, got: ${pw}`);
    h.assert(hashRoundTrips(db, "appreview@trips.planetracker.app", pw).ok);
    fs.rmSync(db, { force: true });
  });

  // --- the documented contract ---------------------------------------------
  await h.test("help documents the env var and does not crash render", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--help"], {
      encoding: "utf8",
    });
    h.assert(stdout.includes("TRIP_PACKER_DEMO_PASSWORD"),
      "help must document the env var");
    h.assert(/appreview@trips\.planetracker\.app/.test(
      fs.readFileSync(SCRIPT, "utf8")), "default email unchanged");
  });

  h.summary();
})();
