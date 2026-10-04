"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ListTodo,
  Plus,
  Trash2,
  CalendarDays,
  AlertCircle,
  Clock,
  X,
  Check,
  Pencil,
  Bell,
  BellOff,
} from "lucide-react";

import { useApp } from "@/lib/AppContext";
import { NO_REMINDER, type Task } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";

/*
 * Trip actions — the "things to sort out before you go" list.
 *
 * Renamed from Tasks when reminders were added. "Actions" covers both a chore
 * with a deadline and one without, and it no longer reads as a second kind of
 * to-do list next to the packing list.
 *
 * Two fields drive everything here and both are optional, independently:
 *
 *   dueDate   "YYYY-MM-DD", "" when there is no deadline
 *   dueTime   "HH:MM",      "" when the deadline is "sometime that day"
 *   remind    minutes before the deadline; NO_REMINDER (-1) means none
 *
 * The one rule that keeps this honest: a reminder needs a *moment* to count
 * back from, so a reminder without a due date is not "a reminder for later" —
 * it is meaningless, and the picker is disabled rather than silently storing a
 * lead time that can never fire.
 *
 * Nothing here schedules a timer. Whether a reminder is currently asking for
 * attention is derived from the clock on every render (see getReminderState),
 * so it is still correct after a reload or a closed tab.
 */

/** Suggested chores, offered as one-tap chips rather than a blank box. */
const SUGGESTIONS = [
  "Renew passport",
  "Check passport validity",
  "Book flights",
  "Book accommodation",
  "Reserve rental car",
  "Get travel insurance",
  "Check visa requirements",
  "Notify bank of travel",
  "Arrange pet sitter",
  "Book airport parking",
  "Schedule vaccinations",
  "Download offline maps",
];

type StatusStyle = {
  label: string;
  className: string;
  Icon: typeof AlertCircle;
};

function statusStyle(
  status: ReturnType<ReturnType<typeof useApp>["helpers"]["getTaskStatus"]>,
  dueDate: string,
  dueTime: string,
  done: boolean
): StatusStyle | null {
  if (done) return null;
  const when = `${formatDate(dueDate) ?? ""}${dueTime ? ` · ${dueTime}` : ""}`;
  switch (status) {
    case "overdue":
      return {
        label: `Overdue · ${when}`,
        className: "text-rose-400 bg-rose-500/10 border-rose-500/20",
        Icon: AlertCircle,
      };
    case "due-soon":
      return {
        label: `Due ${when}`,
        className: "text-amber-400 bg-amber-500/10 border-amber-500/20",
        Icon: Clock,
      };
    case "upcoming":
      return {
        label: when,
        className: "text-zinc-400 bg-zinc-800/50 border-zinc-700/60",
        Icon: CalendarDays,
      };
    default:
      return null;
  }
}

/**
 * The reminder select.
 *
 * Shared between the add form and the edit form so the two cannot drift — they
 * used to be separate copies of the date input, and the edit path silently
 * stopped offering a field the add path had.
 *
 * `disabled` when there is no due date, with the reason given as a hint rather
 * than leaving the user to wonder why it does nothing.
 */
function ReminderSelect({
  value,
  onChange,
  hasDueDate,
}: {
  value: number;
  onChange: (minutes: number) => void;
  hasDueDate: boolean;
}) {
  const { helpers } = useApp();

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={String(value)}
        onValueChange={(v) => onChange(Number(v))}
        disabled={!hasDueDate}
      >
        <SelectTrigger
          aria-label={hasDueDate ? "Reminder" : "Reminder (needs a due date)"}
          className="h-8 text-sm surface-inset border-zinc-800 w-[8.5rem]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-zinc-900 border-zinc-700">
          {helpers.reminderOptions.map((o) => (
            <SelectItem key={o.minutes} value={String(o.minutes)} className="text-zinc-200">
              <span className="flex items-center gap-2">
                {o.minutes === NO_REMINDER ? (
                  <BellOff className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <Bell className="w-3.5 h-3.5 text-amber-400" />
                )}
                {o.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!hasDueDate && (
        <span className="text-[11px] text-zinc-600 whitespace-nowrap">needs a date</span>
      )}
    </div>
  );
}

function ActionRow({ task }: { task: Task }) {
  const { task: taskActions, helpers } = useApp();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDue, setDraftDue] = useState(task.dueDate);
  const [draftTime, setDraftTime] = useState(task.dueTime);
  const [draftRemind, setDraftRemind] = useState(task.remindMinutes);

  const status = helpers.getTaskStatus(task.dueDate, task.done);
  const badge = statusStyle(status, task.dueDate, task.dueTime, task.done);
  const reminderState = helpers.getReminderState(task);
  const wantsAttention = helpers.needsAttention(task);

  // A reminder is only meaningful against a deadline, so clearing the date
  // clears the reminder in the same write. Leaving remindMinutes set would
  // strand a value that can never fire and would spring back to life if a date
  // were re-added later.
  const save = () => {
    const title = draftTitle.trim();
    if (!title) {
      // Refuse to persist an empty action rather than creating a blank row.
      setDraftTitle(task.title);
      setEditing(false);
      return;
    }
    taskActions.update(task.id, {
      title,
      dueDate: draftDue,
      dueTime: draftDue ? draftTime : "",
      remindMinutes: draftDue ? draftRemind : NO_REMINDER,
    });
    setEditing(false);
  };

  const cancel = () => {
    setDraftTitle(task.title);
    setDraftDue(task.dueDate);
    setDraftTime(task.dueTime);
    setDraftRemind(task.remindMinutes);
    setEditing(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "group flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors",
        task.done ? "bg-emerald-500/5" : wantsAttention ? "bg-amber-500/5" : "hover:bg-zinc-800/50"
      )}
    >
      <Checkbox
        checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onCheckedChange={(checked) => taskActions.update(task.id, { done: !!checked })}
        className="border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
      />

      {editing ? (
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
          <Input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            autoFocus
            aria-label="Action title"
            className="h-8 text-sm surface-inset border-zinc-800 flex-1"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              type="date"
              value={draftDue}
              onChange={(e) => setDraftDue(e.target.value)}
              aria-label="Action due date (optional)"
              className="h-8 text-sm surface-inset border-zinc-800 w-[9.5rem]"
            />
            <Input
              type="time"
              value={draftTime}
              onChange={(e) => setDraftTime(e.target.value)}
              disabled={!draftDue}
              aria-label="Action due time (optional)"
              className="h-8 text-sm surface-inset border-zinc-800 w-[7rem] disabled:opacity-50"
            />
            <ReminderSelect
              value={draftRemind}
              onChange={setDraftRemind}
              hasDueDate={!!draftDue}
            />
            <Tooltip label="Save action" side="top">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Save action"
                className="w-7 h-7 text-emerald-400 hover:text-emerald-300 focus-ring"
                onClick={save}
              >
                <Check className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip label="Cancel editing" side="top">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cancel editing"
                className="w-7 h-7 text-zinc-500 hover:text-zinc-300 focus-ring"
                onClick={cancel}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-sm transition-all",
                task.done ? "text-zinc-500 line-through" : "text-zinc-200"
              )}
            >
              {task.title}
            </span>
            {badge && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border tnum",
                  badge.className
                )}
              >
                <badge.Icon className="w-3 h-3" />
                {badge.label}
              </span>
            )}
            {/*
              The lead time is shown only when a reminder exists, and is styled
              by whether it is currently asking for attention — so "1 day
              before" reads as information when scheduled and as a prompt once
              it fires.
            */}
            {task.remindMinutes !== NO_REMINDER && !task.done && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border",
                  reminderState === "due" || reminderState === "active"
                    ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                    : reminderState === "acknowledged"
                      ? "text-zinc-500 bg-zinc-800/40 border-zinc-700/50"
                      : "text-zinc-500 bg-zinc-800/40 border-zinc-700/50"
                )}
              >
                <Bell className="w-3 h-3" />
                {helpers.formatReminderLead(task.remindMinutes)}
              </span>
            )}
            {task.notes && (
              <span className="text-xs text-zinc-500 truncate w-full sm:w-auto">{task.notes}</span>
            )}
          </div>

          <div className="flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100">
            {/* Only offered while the reminder is actually nagging. */}
            {wantsAttention && (
              <Tooltip label="Dismiss this reminder" side="top">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Dismiss reminder for "${task.title}"`}
                  className="w-6 h-6 text-amber-400 hover:text-amber-300 focus-ring"
                  onClick={() => taskActions.acknowledge(task.id)}
                >
                  <BellOff className="w-3 h-3" />
                </Button>
              </Tooltip>
            )}
            <Tooltip label="Edit action, due time or reminder" side="top">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit "${task.title}"`}
                className="w-6 h-6 text-zinc-500 hover:text-zinc-300 focus-ring"
                onClick={() => setEditing(true)}
              >
                <Pencil className="w-3 h-3" />
              </Button>
            </Tooltip>
            <Tooltip label="Delete action" side="top">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete "${task.title}"`}
                className="w-6 h-6 text-zinc-500 hover:text-rose-400 focus-ring"
                onClick={() => taskActions.delete(task.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </Tooltip>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function TripActions({ tripId }: { tripId: string }) {
  const { task: taskActions, helpers, hydrated } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [remindMinutes, setRemindMinutes] = useState<number>(NO_REMINDER);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const tasks = helpers.getTasks(tripId);
  const progress = helpers.getTaskProgress(tripId);
  const open = tasks.filter((t) => !t.done);
  const actionable = helpers.getActionableReminders(tasks);

  const reset = () => {
    setTitle("");
    setDueDate("");
    setDueTime("");
    setRemindMinutes(NO_REMINDER);
    setAdding(false);
    setShowSuggestions(false);
  };

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    // Time and reminder are dropped when there is no date, for the same reason
    // the picker is disabled: neither can mean anything without a deadline.
    taskActions.create(
      tripId,
      value,
      dueDate,
      dueDate ? dueTime : "",
      dueDate ? remindMinutes : NO_REMINDER
    );
    setTitle("");
    setDueDate("");
    setDueTime("");
    setRemindMinutes(NO_REMINDER);
    setShowSuggestions(false);
  };

  const usedTitles = new Set(tasks.map((t) => t.title.toLowerCase()));
  const remaining = SUGGESTIONS.filter((s) => !usedTitles.has(s.toLowerCase()));

  return (
    <div className="p-4 rounded-xl border border-zinc-800 surface-raised">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
          <ListTodo className="w-3.5 h-3.5 text-zinc-500" />
          Actions
          {hydrated && progress.total > 0 && (
            <span className="text-xs text-zinc-500 font-normal tnum">
              {progress.done}/{progress.total}
            </span>
          )}
          {hydrated && progress.overdue > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border text-rose-400 bg-rose-500/10 border-rose-500/20 tnum">
              <AlertCircle className="w-3 h-3" />
              {progress.overdue} overdue
            </span>
          )}
        </span>

        {!adding && (
          <Tooltip label="Add an action" side="left">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Add an action"
              className="w-6 h-6 text-zinc-500 hover:text-zinc-200 focus-ring"
              onClick={() => setAdding(true)}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        )}
      </div>

      {/*
        Reminders asking for attention, surfaced above the list.
        Derived from the clock on every render, so this is correct after a
        reload — it is not a notification that had to be delivered live.
      */}
      {hydrated && actionable.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300 mb-1.5">
            <Bell className="w-3.5 h-3.5" />
            {actionable.length === 1 ? "1 reminder needs attention" : `${actionable.length} reminders need attention`}
          </div>
          <ul className="space-y-1">
            {actionable.slice(0, 4).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs text-amber-200/90">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    helpers.getReminderState(t) === "due" ? "bg-rose-400" : "bg-amber-400"
                  )}
                />
                <span className="truncate">{t.title}</span>
                <span className="text-amber-300/60 tnum shrink-0">
                  {helpers.getReminderState(t) === "due" ? "overdue" : "due soon"}
                </span>
              </li>
            ))}
          </ul>
          {actionable.length > 4 && (
            <p className="text-[11px] text-amber-300/60 mt-1.5">
              and {actionable.length - 4} more
            </p>
          )}
        </div>
      )}

      {hydrated && tasks.length === 0 && !adding && (
        <p className="text-sm text-zinc-500 mb-1">
          No actions yet — add the things that need doing before you leave.
        </p>
      )}

      {tasks.length > 0 && (
        <div className="space-y-0.5 mb-1">
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <ActionRow key={t.id} task={t} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {adding ? (
        <div className="pt-2 mt-1 border-t border-zinc-800/60 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") reset();
              }}
              placeholder="e.g. Renew passport"
              autoFocus
              aria-label="New action title"
              className="h-8 text-sm surface-inset border-zinc-800 flex-1"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="New action due date (optional)"
              className="h-8 text-sm surface-inset border-zinc-800 w-[9.5rem]"
            />
            <Input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              disabled={!dueDate}
              aria-label="New action due time (optional)"
              className="h-8 text-sm surface-inset border-zinc-800 w-[7rem] disabled:opacity-50"
            />
            <ReminderSelect
              value={remindMinutes}
              onChange={setRemindMinutes}
              hasDueDate={!!dueDate}
            />
            <Tooltip label="Add action" side="top">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Add action"
                className="h-8 text-emerald-400 hover:text-emerald-300"
                onClick={submit}
              >
                Add
              </Button>
            </Tooltip>
            <Tooltip label="Cancel" side="top">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Cancel adding action"
                className="h-8 text-zinc-500 hover:text-zinc-300"
                onClick={reset}
              >
                Cancel
              </Button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Date, time and reminder are optional.</span>
            {remaining.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSuggestions((v) => !v)}
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 focus-ring rounded"
              >
                {showSuggestions ? "Hide ideas" : "Suggestions"}
              </button>
            )}
          </div>

          {showSuggestions && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {remaining.slice(0, 10).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTitle(s)}
                  className="text-xs px-2 py-1 rounded-md border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/50 transition-colors focus-ring"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        tasks.length > 0 && (
          <div className="pt-1">
            <Tooltip label="Add an action" side="top">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 focus-ring"
                onClick={() => setAdding(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add Action
              </Button>
            </Tooltip>
          </div>
        )
      )}

      {hydrated && tasks.length > 0 && open.length === 0 && (
        <p className="text-xs text-emerald-400/90 pt-2">Everything's done. 🎉</p>
      )}
    </div>
  );
}
