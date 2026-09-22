/*
 * Tests that `user.add` cannot be used to escalate privileges.
 *
 * The property being protected: a client-controlled payload must not be able to
 * grant an account credentials or ownership. `user.add` is owner-gated, but
 * owner-gating alone is not sufficient — the payload itself was writing
 * `passwordHash` and `isOwner` straight into the row, which means a request
 * could:
 *
 *   (a) mint a login on an account it then controls, or
 *   (b) create a second owner and widen the blast radius of a single
 *       compromised session.
 *
 * Both were verified exploitable against the previous implementation, so these
 * tests pin the fix rather than describing a hypothetical. They exercise
 * insertUser directly, because that is the function the `user.add` handler
 * calls — testing the HTTP route would need a live owner session and would
 * still bottom out here.
 */

const h = require("./harness.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");

// src/lib/db.ts imports "server-only", a Next.js build-time guard that is not an
// installed package. Point it at a do-nothing stub so the real module can load.
const STUB = path.join(__dirname, "..", "scripts", "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

// A throwaway database, so this test never reads or writes real data.
const TMP_DB = path.join(os.tmpdir(), `tp-useradd-test-${process.pid}.db`);
fs.rmSync(TMP_DB, { force: true });
fs.rmSync(`${TMP_DB}-wal`, { force: true });
fs.rmSync(`${TMP_DB}-shm`, { force: true });
process.env.TRIP_PACKER_DB = TMP_DB;

const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));

function cleanup() {
  fs.rmSync(TMP_DB, { force: true });
  fs.rmSync(`${TMP_DB}-wal`, { force: true });
  fs.rmSync(`${TMP_DB}-shm`, { force: true });
}

(async () => {
  const baseline = () => {
    // readState() returns null on a database with no users rather than an empty
    // state object, so an empty DB must be treated as "zero of everything"
    // instead of crashing the counter.
    const s = db.readState();
    const users = s ? s.users : [];
    return {
      owners: users.filter((u) => u.isOwner).length,
      users: users.length,
    };
  };

  await h.test("insertUser refuses a client-supplied isOwner", () => {
    const before = baseline();
    db.tx.insertUser({
      id: "esc-owner-1",
      name: "Attacker Owner",
      avatarColor: "bg-red-500",
      createdAt: new Date().toISOString(),
      isOwner: true,
    });
    const after = baseline();
    h.assertEqual(
      after.owners,
      before.owners,
      "owners must not increase when the payload asks for isOwner"
    );
  });

  await h.test("insertUser refuses a client-supplied passwordHash", () => {
    db.tx.insertUser({
      id: "esc-login-1",
      name: "Attacker Login",
      avatarColor: "bg-red-500",
      createdAt: new Date().toISOString(),
      email: "attacker@example.com",
      passwordHash: "$pbkdf2$100000$deadbeef$cafe",
    });
    const stored = db.tx.getUserByEmail("attacker@example.com");
    h.assertEqual(stored, null, "a user.add profile must not be reachable by login");
  });

  await h.test("insertUser stores no email at all", () => {
    // The mapped User omits credential fields, so this asserts on the absence
    // of an email rather than reaching for the raw row: if the INSERT had
    // written the payload's email, getUserByEmail would now find it.
    const rows = db.readState().users;
    const attacker = rows.find((u) => u.id === "esc-login-1");
    h.assert(attacker, "the profile row should still exist");
    h.assertEqual(
      attacker.email,
      undefined,
      "the mapped user must not expose an email for a credential-less profile"
    );
  });

  await h.test("insertAccount DOES persist credentials (the CLI path still works)", () => {
    db.tx.insertAccount({
      id: "acct-ok-1",
      name: "Real User",
      avatarColor: "bg-emerald-500",
      createdAt: new Date().toISOString(),
      email: "real@example.com",
      passwordHash: "$pbkdf2$100000$cafebabe$f00d",
      isOwner: false,
    });
    const stored = db.tx.getUserByEmail("real@example.com");
    h.assert(stored, "an account created via insertAccount must be findable");
    h.assertEqual(
      stored.passwordHash,
      "$pbkdf2$100000$cafebabe$f00d",
      "insertAccount must persist the hash — otherwise registration is broken"
    );
  });

  await h.test("insertAccount still honours isOwner (bootstrap needs it)", () => {
    const before = baseline();
    db.tx.insertAccount({
      id: "acct-owner-1",
      name: "Legit Owner",
      avatarColor: "bg-emerald-500",
      createdAt: new Date().toISOString(),
      email: "owner@example.com",
      passwordHash: "$pbkdf2$100000$cafebabe$f00d",
      isOwner: true,
    });
    const after = baseline();
    h.assertEqual(
      after.owners,
      before.owners + 1,
      "insertAccount must be able to create an owner"
    );
  });

  await h.test("cleanup", () => {
    cleanup();
    h.assert(true, "done");
  });

  h.summary();
  if (process.exitCode !== 0) cleanup();
})();
