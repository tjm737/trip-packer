/*
 * Prove the user.add privilege-escalation hole, then prove the fix closes it.
 *
 * Run against the test DB copy. Exits non-zero if the escalation still works
 * after the guard is in place, so this can be wired into the suite later.
 */

const path = require("node:path");
const Module = require("node:module");

// Same server-only stub the CLI needs, for the same reason.
const STUB = path.join(__dirname, "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

const h = require("../tests/harness.cjs");
const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));

function tryEscalate(label, payload) {
  const before = db.readState();
  const ownersBefore = before.users.filter((u) => u.isOwner).length;

  db.tx.insertUser(payload);

  const after = db.readState();
  const ownersAfter = after.users.filter((u) => u.isOwner).length;
  const stored = db.tx.getUserByEmail(payload.email);

  const gainedOwner = ownersAfter > ownersBefore;
  const loginMinted = Boolean(stored && stored.passwordHash);

  console.log(`\n${label}`);
  console.log(`  payload isOwner=${payload.isOwner} passwordHash=${payload.passwordHash ? "SET" : "absent"}`);
  console.log(`  owners ${ownersBefore} -> ${ownersAfter}  (gained owner: ${gainedOwner})`);
  console.log(`  login minted: ${loginMinted}`);

  if (gainedOwner || loginMinted) {
    // Clean up so repeated runs stay honest.
    db.tx.deleteUser(payload.id);
    return true;
  }
  return false;
}

let escalated = false;

escalated = tryEscalate("A. client-supplied isOwner:true via user.add", {
  id: "aaaa1111-0000-0000-0000-000000000001",
  name: "Attacker Owner",
  avatarColor: "bg-red-500",
  createdAt: new Date().toISOString(),
  isOwner: true,
}) || escalated;

escalated = tryEscalate("B. client-supplied passwordHash via user.add", {
  id: "aaaa1111-0000-0000-0000-000000000002",
  name: "Attacker Login",
  avatarColor: "bg-red-500",
  createdAt: new Date().toISOString(),
  email: "attacker@example.com",
  passwordHash: "$pbkdf2$100000$deadbeef$cafe",
}) || escalated;

console.log(
  escalated
    ? "\nRESULT: ESCALATION STILL POSSIBLE — the guard is not effective."
    : "\nRESULT: both escalations blocked."
);
process.exit(escalated ? 1 : 0);
