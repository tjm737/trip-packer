/**
 * update.sh must apply a STABLE review password on every deploy.
 *
 * Why this is a real failure mode and not a nicety: seed-demo.cjs calls
 * setCredentials unconditionally, so every run rewrites the credential. With
 * no password supplied it generates a random one and prints it to a deploy log
 * nobody reads -- leaving App Store Connect holding a password the server no
 * longer accepts. The symptom appears only when Apple's reviewer tries to sign
 * in, with no local signal pointing at the cause.
 *
 * These tests drive the same shell resolution update.sh performs, against a
 * throwaway DB, and assert the credential the deploy applies is the credential
 * that authenticates.
 */

const h = require("./harness.cjs");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "seed-demo.cjs");
const UPDATE_SH = path.join(ROOT, "deploy", "update.sh");

const EMAIL = "appreview@trips.planetracker.app";

function tmp(name) {
  return path.join(os.tmpdir(), `tp-upd-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}`);
}

/**
 * Mirror update.sh's password resolution exactly, then run the seeder.
 *
 * Kept as a shell snippet rather than reimplemented in JS so the thing under
 * test is the shell logic -- including the `tr -d '\r\n'` that strips a
 * trailing newline from the file, which a JS reimplementation would not
 * naturally reproduce and which is a genuine way to break this.
 */
function deployWith({ passwordFile, envPassword }) {
  const db = tmp("db");
  const sh = `
    set -euo pipefail
    DEMO_PASSWORD_FILE=${JSON.stringify(passwordFile ?? tmp("absent"))}
    DEMO_PASSWORD=""
    if [[ -r "\${DEMO_PASSWORD_FILE}" ]]; then
      DEMO_PASSWORD="$(tr -d '\\r\\n' < "\${DEMO_PASSWORD_FILE}")"
    elif [[ -n "\${REVIEW_PASSWORD:-}" ]]; then
      DEMO_PASSWORD="\${REVIEW_PASSWORD}"
    fi
    TRIP_PACKER_DB=${JSON.stringify(db)} \\
    TRIP_PACKER_DEMO_PASSWORD="\${DEMO_PASSWORD}" \\
    node ${JSON.stringify(SCRIPT)}
  `;
  const stdout = execFileSync("bash", ["-c", sh], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, REVIEW_PASSWORD: envPassword ?? "" },
  });
  return { db, stdout, configured: stdout.includes(EMAIL) };
}

/** Does this password authenticate against the stored hash? Uses the app's own verifier. */
function authenticates(db, password) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(db, { readonly: true });
  try {
    const row = sqlite
      .prepare("SELECT passwordHash FROM users WHERE email = ?")
      .get(EMAIL);
    if (!row) return false;
    return h.loadModule("src/lib/auth.ts").verifyPassword(password, row.passwordHash);
  } finally {
    sqlite.close();
  }
}

(async () => {
  await h.test("update.sh passes a password through the environment, never argv", () => {
    const src = fs.readFileSync(UPDATE_SH, "utf8");
    h.assert(/TRIP_PACKER_DEMO_PASSWORD="\$\{DEMO_PASSWORD\}"/.test(src),
      "update.sh should export TRIP_PACKER_DEMO_PASSWORD for the seeder");
    h.assert(!/seed-demo\.cjs.*--password/.test(src),
      "the password must not be passed as an argv flag (visible in the process table)");
  });

  await h.test("a password file is applied and authenticates", () => {
    const pwFile = tmp("pw");
    fs.writeFileSync(pwFile, "TestCapture123!\n"); // trailing newline is the realistic case
    const { db, stdout } = deployWith({ passwordFile: pwFile });
    h.assert(stdout.includes("TestCapture123!"),
      "the seeder should report the supplied password");
    h.assert(authenticates(db, "TestCapture123!"),
      "the applied password must authenticate");
    h.assert(!authenticates(db, "TestCapture123!\n"),
      "a trailing newline must be stripped, not hashed into the password");
    fs.rmSync(pwFile, { force: true });
    fs.rmSync(db, { force: true });
  });

  await h.test("re-deploying keeps the SAME password (the actual regression)", () => {
    const pwFile = tmp("pw");
    fs.writeFileSync(pwFile, "StablePass123!");

    const first = deployWith({ passwordFile: pwFile });
    const second = deployWith({ passwordFile: pwFile }); // a later deploy
    h.assert(authenticates(second.db, "StablePass123!"),
      "the password must still work after a second deploy");

    fs.rmSync(pwFile, { force: true });
    fs.rmSync(first.db, { force: true });
    fs.rmSync(second.db, { force: true });
  });

  await h.test("REVIEW_PASSWORD is the fallback when no file exists", () => {
    const { db, stdout } = deployWith({ passwordFile: tmp("absent"), envPassword: "EnvFallback123!" });
    h.assert(stdout.includes("EnvFallback123!"));
    h.assert(authenticates(db, "EnvFallback123!"));
    fs.rmSync(db, { force: true });
  });

  await h.test("with neither, a password is generated (and is therefore unstable)", () => {
    const a = deployWith({});
    const b = deployWith({});
    const pwA = a.stdout.split("\n").map((l) => l.trim());
    const i = pwA.findIndex((l) => l === EMAIL);
    const generated = pwA[i + 1];
    h.assert(/^[a-z]+-[a-z]+-[a-z]+\d{2}$/.test(generated),
      `expected a generated password, got: ${generated}`);
    h.assert(!authenticates(b.db, generated),
      "two deploys without a configured password produce DIFFERENT credentials -- this is why the file matters");
    fs.rmSync(a.db, { force: true });
    fs.rmSync(b.db, { force: true });
  });

  await h.test("update.sh warns when no password is configured", () => {
    const src = fs.readFileSync(UPDATE_SH, "utf8");
    h.assert(/no review password configured/.test(src),
      "a missing password file should produce a visible warning");
    h.assert(/DEMO_PASSWORD_FILE/.test(src), "the override point should be documented");
  });

  h.summary();
})();
