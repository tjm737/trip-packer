#!/usr/bin/env node
/*
 * End-to-end check of the Actions/reminder persistence path against a scratch
 * copy of the real database, using the real db.ts module.
 *
 * Runs the actual migration + insert + read-back so a broken ALTER, a mapper
 * that drops a field, or a column that never gets written all show up here
 * rather than as a silently-empty reminder list in the UI.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const h = require("./harness.cjs");

const src = path.join(h.SRC, "..", "data", "trip-packer.db");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-db-"));
const copy = path.join(dir, "scratch.db");
fs.copyFileSync(src, copy);
process.env.TRIP_PACKER_DB = copy;

const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));
const tx = db.tx;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// Find a real trip to hang the action off.
const state = db.readState();
const trip = state.trips[0];
assert(trip, "scratch DB has no trips to attach an action to");
const tripId = trip.id;

console.log(`\nAction persistence (scratch copy: ${copy})\n`);

const before = state.tasks.filter((t) => t.tripId === tripId).length;

// 1. The new columns exist after migration.
check("tasks table has dueTime / remindMinutes / acknowledgedAt columns", () => {
  // readState() runs ensureSchema, so the columns must be present by now. If
  // the ALTER was missing, the read below would throw on the unknown column.
  const t = state.tasks[0];
  if (t) {
    assert("dueTime" in t, "read state task is missing dueTime");
    assert("remindMinutes" in t, "read state task is missing remindMinutes");
    assert("acknowledgedAt" in t, "read state task is missing acknowledgedAt");
  }
});

// 2. Insert with every new field set, then read it back.
check("a task keeps dueTime, remindMinutes and acknowledgedAt through a round-trip", () => {
  const id = "test-action-" + Date.now();
  tx.insertTask({
    id,
    tripId,
    title: "Renew passport",
    done: false,
    dueDate: "2027-01-15",
    dueTime: "14:30",
    remindMinutes: 1440,
    acknowledgedAt: "",
    notes: "",
    order: 999,
    createdAt: new Date().toISOString(),
  });

  const back = db.readState().tasks.find((t) => t.id === id);
  assert(back, "inserted task not found on read-back");
  assert(back.dueDate === "2027-01-15", `dueDate lost: ${back.dueDate}`);
  assert(back.dueTime === "14:30", `dueTime lost: ${back.dueTime}`);
  assert(back.remindMinutes === 1440, `remindMinutes lost: ${back.remindMinutes}`);
  assert(back.acknowledgedAt === "", `acknowledgedAt should default empty: ${back.acknowledgedAt}`);

  // 3. Update the reminder and acknowledge it.
  tx.updateTask(id, { remindMinutes: 60, acknowledgedAt: "2027-01-15T13:00:00.000Z" });
  const updated = db.readState().tasks.find((t) => t.id === id);
  assert(updated.remindMinutes === 60, `updateTask lost remindMinutes: ${updated.remindMinutes}`);
  assert(
    updated.acknowledgedAt === "2027-01-15T13:00:00.000Z",
    `updateTask lost acknowledgedAt: ${updated.acknowledgedAt}`
  );

  // 4. The -1 sentinel must survive as -1, not be coerced or dropped.
  tx.updateTask(id, { remindMinutes: -1 });
  const noRemind = db.readState().tasks.find((t) => t.id === id);
  assert(noRemind.remindMinutes === -1, `NO_REMINDER sentinel not preserved: ${noRemind.remindMinutes}`);

  // 5. Cleanup so reruns against a fresh copy stay identical.
  tx.deleteTask(id);
});

const after = db.readState().tasks.filter((t) => t.tripId === tripId).length;
check("cleanup left the task count unchanged", () => {
  assert(after === before, `count changed: ${before} -> ${after}`);
});

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "OK" : failures + " FAILING"}\n`);
process.exit(failures ? 1 : 0);
