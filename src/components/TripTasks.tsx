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
} from "lucide-react";

import { useApp } from "@/lib/AppContext";
import { Task } from "@/lib/types";
import { formatDate, isValidDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "cn";

/*
 * Pre-trip to-do list.
 *
 * Kept out of trips/[id]/page.tsx deliberately: that file is already the
 * largest in the app, and this section owns its own add/edit state that has
 * nothing to do with packing.
 *
 * The deadline is optional. A task without one is a legitimate case ("look
 * into travel insurance") and must never inherit today's date, which would
 * render it overdue the instant it was created.
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

function statusStyle(status: ReturnType<ReturnType<typeof useApp>["helpers"]["getTaskStatus"]>, dueDate: string, done: boolean): StatusStyle | null {
  if (done) return null;
  switch (status) {
    case "overdue":
      return {
        label: `Overdue · ${formatDate(dueDate)}`,
        className: "text-rose-400 bg-rose-500/10 border-rose-500/20",
        Icon: AlertCircle,
      };
    case "due-soon":
      return {
        label: `Due ${formatDate(dueDate)}`,
        className: "text-amber-400 bg-amber-500/10 border-amber-500/20",
        Icon: Clock,
      };
    case "upcoming":
      return {
        label: formatDate(dueDate) ?? "",
        className: "text-zinc-400 bg-zinc-800/50 border-zinc-700/60",
        Icon: CalendarDays,
      };
    default:
      return null;
  }
}

function TaskRow({ task }: { task: Task }) {
  const { task: taskActions, helpers } = useApp();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDue, setDraftDue] = useState(task.dueDate);

  const status = helpers.getTaskStatus(task.dueDate, task.done);
  const badge = statusStyle(status, task.dueDate, task.done);

  const save = () => {
    const title = draftTitle.trim();
    if (!title) {
      // Refuse to persist an empty task rather than creating a blank row.
      setDraftTitle(task.title);
      setEditing(false);
      return;
    }
    taskActions.update(task.id, { title, dueDate: draftDue });
    setEditing(false);
  };

  const cancel = () => {
    setDraftTitle(task.title);
    setDraftDue(task.dueDate);
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
        task.done ? "bg-emerald-500/5" : "hover:bg-zinc-800/50"
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
            aria-label="Task title"
            className="h-8 text-sm surface-inset border-zinc-800 flex-1"
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={draftDue}
              onChange={(e) => setDraftDue(e.target.value)}
              aria-label="Task due date"
              className="h-8 text-sm surface-inset border-zinc-800 w-[9.5rem]"
            />
            <Tooltip label="Save task" side="top">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Save task"
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
            {task.notes && (
              <span className="text-xs text-zinc-500 truncate w-full sm:w-auto">{task.notes}</span>
            )}
          </div>

          <div className="flex items-center gap-1 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100">
            <Tooltip label="Edit task or due date" side="top">
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
            <Tooltip label="Delete task" side="top">
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

export function TripTasks({ tripId }: { tripId: string }) {
  const { task: taskActions, helpers, hydrated } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const tasks = helpers.getTasks(tripId);
  const progress = helpers.getTaskProgress(tripId);
  const open = tasks.filter((t) => !t.done);

  const reset = () => {
    setTitle("");
    setDueDate("");
    setAdding(false);
    setShowSuggestions(false);
  };

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    taskActions.create(tripId, value, dueDate);
    setTitle("");
    setDueDate("");
    setShowSuggestions(false);
  };

  const usedTitles = new Set(tasks.map((t) => t.title.toLowerCase()));
  const remaining = SUGGESTIONS.filter((s) => !usedTitles.has(s.toLowerCase()));

  return (
    <div className="p-4 rounded-xl border border-zinc-800 surface-raised">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
          <ListTodo className="w-3.5 h-3.5 text-zinc-500" />
          Tasks
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
          <Tooltip label="Add a task" side="left">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Add a task"
              className="w-6 h-6 text-zinc-500 hover:text-zinc-200 focus-ring"
              onClick={() => setAdding(true)}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        )}
      </div>

      {hydrated && tasks.length === 0 && !adding && (
        <p className="text-sm text-zinc-500 mb-1">
          No tasks yet — add the things that need doing before you leave.
        </p>
      )}

      {tasks.length > 0 && (
        <div className="space-y-0.5 mb-1">
          <AnimatePresence initial={false}>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
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
              aria-label="New task title"
              className="h-8 text-sm surface-inset border-zinc-800 flex-1"
            />
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="New task due date (optional)"
                className="h-8 text-sm surface-inset border-zinc-800 w-[9.5rem]"
              />
              <Tooltip label="Add task" side="top">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Add task"
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
                  aria-label="Cancel adding task"
                  className="h-8 text-zinc-500 hover:text-zinc-300"
                  onClick={reset}
                >
                  Cancel
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Due date is optional.</span>
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
            <Tooltip label="Add a task" side="top">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 focus-ring"
                onClick={() => setAdding(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add Task
              </Button>
            </Tooltip>
          </div>
        )
      )}

      {hydrated && tasks.length > 0 && open.length === 0 && (
        <p className="text-xs text-emerald-400/90 pt-2">
          All tasks done. 🎉
        </p>
      )}
    </div>
  );
}
