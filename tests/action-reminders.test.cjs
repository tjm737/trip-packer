#!/usr/bin/env node
/*
 * Action reminders: the guarantees that must hold regardless of when the clock
 * is read.
 *
 * Why these tests look like this
 * ------------------------------
 * Reminder state is DERIVED from the current time rather than scheduled with a
 * timer, so every case here is a pure function of (task, now). That is what
 * makes it testable without fake timers -- and it is the design decision these
 * tests exist to protect. If someone later "optimises" this into a setTimeout
 * that pings a store, the reload, closed-tab and clock-change cases below stop
 * being expressible at all.
 *
 * Each normalisation test is written to fail if its guard is deleted. Passing
 * before and after a change would make it documentation, not a test.
 */

const assert = require("node:assert");
const path = require("node:path");
const h = require("./harness.cjs");
const { test, loadModule } = h;

const storage = loadModule(path.join(h.SRC, "lib", "storage.ts"));
const types = loadModule(path.join(h.SRC, "lib", "types.ts"));

const {
  getReminderState,
  needsAttention,
  getActionableReminders,
  getTaskStatus,
  formatReminderLead,
  REMINDER_OPTIONS,
} = storage;
const { NO_REMINDER } = types;

/** A minimal task. Only the fields the reminder logic reads. */
function task(over) {
  return Object.assign(
    {
      id: "t1",
      tripId: "trip1",
      title: "Renew passport",
      done: false,
      dueDate: "2026-10-14",
      dueTime: "",
      remindMinutes: NO_REMINDER,
      acknowledgedAt: "",
      notes: "",
      order: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    over
  );
}

// A fixed "now" so nothing here depends on the wall clock. 2026-10-14 09:00
// local, the same day as the default due date.
const now = new Date(2026, 9, 14, 9, 0, 0);

/* ------------------------------------------------------- the -1 sentinel */

test("NO_REMINDER is -1, not 0", () => {
  // Load-bearing: 0 means "at the deadline" and is a real setting. If the
  // sentinel drifted to 0, every action with no reminder would start reminding
  // at its deadline and "at the time" would become unexpressible.
  assert.strictEqual(NO_REMINDER, -1);
});

test("a task with no reminder is 'none', never 'active'", () => {
  const t = task({ remindMinutes: NO_REMINDER, dueDate: "2026-10-14" });
  assert.strictEqual(getReminderState(t, now), "none");
  assert.strictEqual(needsAttention(t, now), false);
});

test("'at the time' (0) is distinct from no reminder (-1)", () => {
  // Same due date, same clock: only the sentinel differs. At 09:00 with a
  // deadline at 00:00 today (already passed), 0 means the reminder is due and
  // -1 means there is nothing to remind about. If the two were conflated,
  // these two assertions could not both hold.
  const at = task({ remindMinutes: 0, dueTime: "00:00", dueDate: "2026-10-14" });
  const none = task({ remindMinutes: NO_REMINDER, dueTime: "00:00", dueDate: "2026-10-14" });
  assert.strictEqual(getReminderState(at, now), "due");
  assert.strictEqual(getReminderState(none, now), "none");
});

/* --------------------------------------------------- the no-date guarantee */

test("no due date is 'none', never 'due'", () => {
  // The core rule: an absent optional field must not classify as a failure.
  // A reminder needs a moment to count back from, so without a date there is
  // nothing to fire -- and an undated action must never read as overdue.
  const t = task({ dueDate: "", remindMinutes: 60 });
  assert.strictEqual(getReminderState(t, now), "none");
  assert.strictEqual(needsAttention(t, now), false);
});

test("an invalid due date is treated as no due date, not as overdue", () => {
  const t = task({ dueDate: "not-a-date", remindMinutes: 60 });
  assert.strictEqual(getReminderState(t, now), "none");
});

/* ---------------------------------------------------------- lead window */

test("a reminder before its lead window is 'scheduled', not 'active'", () => {
  // Due 2026-10-20 at 09:00, reminding 1 day before -> fires 2026-10-19 09:00.
  // Now is 2026-10-14 09:00, several days early.
  const t = task({ dueDate: "2026-10-20", dueTime: "09:00", remindMinutes: 24 * 60 });
  assert.strictEqual(getReminderState(t, now), "scheduled");
  assert.strictEqual(needsAttention(t, now), false);
});

test("a reminder inside its lead window is 'active'", () => {
  // Due today 12:00, reminding 1 hour before -> fires 11:00. Now is 09:00...
  // so this would be scheduled; move the deadline to 09:30 to be inside it.
  const t = task({ dueDate: "2026-10-14", dueTime: "09:30", remindMinutes: 60 });
  assert.strictEqual(getReminderState(t, now), "active");
  assert.strictEqual(needsAttention(t, now), true);
});

test("exactly at the fire moment is 'active' (boundary is inclusive)", () => {
  // Due 10:00, 1 hour before -> fire at 09:00 exactly, which is `now`. A strict
  // `<` comparison would leave this stuck as "scheduled" and the reminder would
  // never appear at the moment it was asked for.
  const t = task({ dueDate: "2026-10-14", dueTime: "10:00", remindMinutes: 60 });
  assert.strictEqual(getReminderState(t, now), "active");
});

test("past the deadline is 'due' regardless of lead time", () => {
  const t = task({ dueDate: "2026-10-14", dueTime: "08:00", remindMinutes: 24 * 60 });
  assert.strictEqual(getReminderState(t, now), "due");
  assert.strictEqual(needsAttention(t, now), true);
});

test("a date-only deadline is due from the start of that day", () => {
  // "" time means midnight, so a task due today with any reminder is already
  // due at 09:00. Stated explicitly because it is a real consequence of
  // treating a blank time as the start of the day.
  const t = task({ dueDate: "2026-10-14", dueTime: "", remindMinutes: 0 });
  assert.strictEqual(getReminderState(t, now), "due");
});

/* ------------------------------------------------- acknowledged behaviour */

test("acknowledging silences an active reminder", () => {
  const t = task({
    dueDate: "2026-10-14",
    dueTime: "09:30",
    remindMinutes: 60,
    acknowledgedAt: "2026-10-14T08:55:00.000Z",
  });
  assert.strictEqual(getReminderState(t, now), "acknowledged");
  assert.strictEqual(needsAttention(t, now), false);
});

test("acknowledging does NOT silence an overdue action", () => {
  // "I'll deal with it later" is not "I did it". Past the deadline the reminder
  // must resurface, or acknowledging once would hide a genuinely missed action
  // for good.
  const t = task({
    dueDate: "2026-10-14",
    dueTime: "08:00",
    remindMinutes: 60,
    acknowledgedAt: "2026-10-14T07:00:00.000Z",
  });
  assert.strictEqual(getReminderState(t, now), "due");
  assert.strictEqual(needsAttention(t, now), true);
});

/* ---------------------------------------------------- completed actions */

test("a completed action never reminds", () => {
  const t = task({ done: true, dueDate: "2026-10-14", dueTime: "08:00", remindMinutes: 60 });
  assert.strictEqual(getReminderState(t, now), "none");
  assert.strictEqual(needsAttention(t, now), false);
});

/* ------------------------------------------------------------- ordering */

test("actionable reminders sort overdue above due-soon, then by date", () => {
  const overdue = task({ id: "a", dueDate: "2026-10-13", dueTime: "08:00", remindMinutes: 60 });
  const soonEarly = task({ id: "b", dueDate: "2026-10-14", dueTime: "09:30", remindMinutes: 60 });
  const soonLater = task({ id: "c", dueDate: "2026-10-14", dueTime: "09:45", remindMinutes: 60 });
  // Fires at 10:00, still ahead of `now` (09:00) -> "scheduled", excluded.
  const scheduled = task({ id: "d", dueDate: "2026-10-14", dueTime: "11:00", remindMinutes: 60 });
  const later = task({ id: "e", dueDate: "2026-12-01", dueTime: "09:00", remindMinutes: 60 });

  const sorted = getActionableReminders([later, scheduled, soonLater, overdue, soonEarly], now);
  assert.deepStrictEqual(
    sorted.map((t) => t.id),
    ["a", "b", "c"],
    "overdue first, then same-day by clock time; scheduled excluded entirely"
  );
});

test("getActionableReminders excludes anything not asking for attention", () => {
  const noReminder = task({ id: "x", remindMinutes: NO_REMINDER });
  const noDate = task({ id: "y", dueDate: "", remindMinutes: 60 });
  const done = task({ id: "z", done: true, dueTime: "08:00", remindMinutes: 60 });
  const notYet = task({ id: "w", dueDate: "2026-12-01", dueTime: "09:00", remindMinutes: 60 });
  assert.deepStrictEqual(getActionableReminders([noReminder, noDate, done, notYet], now), []);
});

/* -------------------------------------------------- status vs reminder */

test("task status still treats no-date as its own state", () => {
  // Guards the sibling rule the reminder logic mirrors: an undated task is
  // "no-date", not "overdue".
  //
  // getTaskStatus() reads the real wall clock (it takes no `now`), so the
  // dated cases here are computed relative to today rather than hard-coded,
  // or the test would start failing the day after it was written.
  assert.strictEqual(getTaskStatus("", false), "no-date");

  const iso = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const inThreeDays = new Date();
  inThreeDays.setDate(inThreeDays.getDate() + 3);
  const inThirtyDays = new Date();
  inThirtyDays.setDate(inThirtyDays.getDate() + 30);

  assert.strictEqual(getTaskStatus(iso(yesterday), false), "overdue");
  assert.strictEqual(getTaskStatus(iso(inThreeDays), false), "due-soon");
  assert.strictEqual(getTaskStatus(iso(inThirtyDays), false), "upcoming");
});

/* ------------------------------------------------------- option sanity */

test("reminder options lead with 'No reminder' and include 'At the time'", () => {
  // The picker must offer the sentinel distinctly from 0, or the user cannot
  // express either intent.
  assert.strictEqual(REMINDER_OPTIONS[0].minutes, NO_REMINDER);
  assert.ok(
    REMINDER_OPTIONS.some((o) => o.minutes === 0),
    "'At the time' (0) must be a selectable option"
  );
  // Every option must round-trip its own label, or a saved value displays as
  // the raw minute count.
  for (const o of REMINDER_OPTIONS) {
    assert.strictEqual(formatReminderLead(o.minutes), o.label, `label for ${o.minutes}`);
  }
});

test("an unknown stored lead time still renders a label rather than blank", () => {
  assert.match(formatReminderLead(90), /90/);
});

module.exports = {};
