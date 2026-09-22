"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import { User, Trip } from "@/lib/types";
import { formatDateRange, isUpcoming as isUpcomingTrip, compareByDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { AVATAR_COLORS } from "@/lib/storage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AboutButton, AboutDialog } from "@/components/AboutDialog";
import { SignInButton, LoginDialog } from "@/components/LoginDialog";
import { toast } from "@/components/ui/toast";
import {
  Plus,
  Users,
  MapPin,
  Archive,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  Check,
  X,
  ArrowRight,
} from "lucide-react";

function UserAvatar({ user, size = "md" }: { user: User; size?: "sm" | "md" | "lg" }) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sizeClasses = {
    sm: "w-7 h-7 text-xs",
    md: "w-9 h-9 text-sm",
    lg: "w-12 h-12 text-base",
  };

  return (
    <div
      className={`${sizeClasses[size]} ${user.avatarColor} flex flex-shrink-0 select-none items-center justify-center rounded-full font-semibold text-white`}
    >
      {initials}
    </div>
  );
}

/**
 * User switcher.
 *
 * Sits in the sidebar header. The active user's name is rendered inline next to
 * their avatar rather than underneath it — an absolutely-positioned label
 * (`-bottom-4`) previously overflowed the section, whose padding-bottom is 0,
 * and landed on top of the "Upcoming" control below.
 *
 * Avatars are one control each: the active one is highlighted with a ring and
 * carries the name, inactive ones are dimmed and show their name on hover.
 * Rename and delete live in a per-user overflow affordance so the row stays a
 * single visual line.
 */
function UserSwitcher() {
  const { state, user, activeUser } = useApp();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (!activeUser) return null;

  return (
    <div className="px-4 py-3 border-b border-white/8">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Travelers
          </span>
        </div>
        <span className="text-[10px] text-zinc-600 tnum">
          {state.users.length}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {state.users.map((u) => {
          const active = u.id === state.activeUserId;
          return (
            <div
              key={u.id}
              className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors ${
                active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <button
                onClick={() => user.switch(u.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-ring rounded-md"
                title={active ? `${u.name} (current)` : `Switch to ${u.name}`}
              >
                <span className="relative flex-shrink-0">
                  <UserAvatar user={u} size="sm" />
                  {active && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-1)] bg-emerald-400" />
                  )}
                </span>
                <span
                  className={`truncate text-xs ${
                    active ? "font-medium text-zinc-100" : "text-zinc-400"
                  }`}
                >
                  {u.name}
                </span>
              </button>

              {/*
                * The edit (pencil) button is always rendered, including for the
                * sole traveler - the profile editor is the only way to change
                * your own name and avatar colour, so hiding it behind
                * `users.length > 1` made a single-traveler setup uneditable.
                * Delete stays guarded: removing the last traveler is refused by
                * the API anyway (there is no user-less state), so offering the
                * button would only ever produce an error.
                * `data-keep-drawer-open` is required on both controls for the
                * same reason AboutButton needs it: MobileSidebar closes on any
                * button tap, which unmounts SidebarBody and takes the dialog
                * with it. Without this the editor flashed open and vanished on
                * a phone.
                */}
              <div className="flex flex-shrink-0 items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100">
                <button
                  data-keep-drawer-open
                  onClick={() => {
                    setEditingId(u.id);
                    setEditName(u.name);
                    setEditColor(u.avatarColor);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-ring"
                  aria-label={`Edit ${u.name} profile`}
                  title={`Edit ${u.name} profile`}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {state.users.length > 1 && (
                  <button
                    data-keep-drawer-open
                    onClick={() => setConfirmDeleteId(u.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-ring"
                    aria-label={`Remove ${u.name}`}
                    title={`Remove ${u.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Edit profile */}
              <Dialog
                open={editingId === u.id}
                onOpenChange={(o) =>
                  o
                    ? (setEditingId(u.id), setEditName(u.name), setEditColor(u.avatarColor))
                    : setEditingId(null)
                }
              >
                <DialogContent className="sm:max-w-[360px] bg-[var(--surface-2)] border-zinc-700">
                  <DialogHeader>
                    <DialogTitle className="text-zinc-100">Edit traveler</DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500">
                      Your name and avatar colour appear throughout the app.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    {/* Live preview so the colour choice is made against the
                        real avatar rather than a bare swatch. */}
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        user={{ ...u, name: editName || u.name, avatarColor: editColor || u.avatarColor }}
                        size="lg"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {editName.trim() || u.name}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {state.users.length > 1
                            ? "Traveler"
                            : "You · only traveler"}
                        </p>
                      </div>
                    </div>

                    <div>
                      <Label
                        htmlFor={`name-${u.id}`}
                        className="text-xs text-zinc-400"
                      >
                        Name
                      </Label>
                      <Input
                        id={`name-${u.id}`}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editName.trim()) {
                            user.update(u.id, {
                              name: editName.trim(),
                              avatarColor: editColor || u.avatarColor,
                            });
                            setEditingId(null);
                          }
                        }}
                        className="mt-1.5 bg-zinc-800 border-zinc-600 text-zinc-100"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-zinc-400">Avatar color</Label>
                      {/*
                        * `role="radiogroup"` + `aria-checked` so the selection is
                        * announced, not just coloured - the previous version of
                        * this dialog had no colour control at all, and a row of
                        * plain buttons with a ring would be invisible to a
                        * screen reader.
                        */}
                      <div
                        role="radiogroup"
                        aria-label="Avatar color"
                        className="mt-2 flex flex-wrap gap-2"
                      >
                        {AVATAR_COLORS.map((c) => {
                          const selected = (editColor || u.avatarColor) === c;
                          return (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              aria-label={c.replace(/^bg-|-\d+$/g, "")}
                              title={c.replace(/^bg-|-\d+$/g, "")}
                              onClick={() => setEditColor(c)}
                              className={`flex h-7 w-7 items-center justify-center rounded-full ${c} transition-transform hover:scale-110 focus-ring ${
                                selected
                                  ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--surface-2)]"
                                  : "ring-1 ring-white/15"
                              }`}
                            >
                              {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} className="text-zinc-400">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!editName.trim()}
                      onClick={() => {
                        if (editName.trim()) {
                          user.update(u.id, {
                            name: editName.trim(),
                            avatarColor: editColor || u.avatarColor,
                          });
                        }
                        setEditingId(null);
                      }}
                      className="bg-primary hover:bg-emerald-700"
                    >
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Remove */}
              <Dialog
                open={confirmDeleteId === u.id}
                onOpenChange={(o) => !o && setConfirmDeleteId(null)}
              >
                <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
                  <DialogHeader>
                    <DialogTitle className="text-zinc-100">Remove traveler</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-zinc-400">
                    Remove {u.name} and all of their trips? This cannot be undone.
                  </p>
                  <DialogFooter>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} className="text-zinc-400">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        user.delete(u.id);
                        setConfirmDeleteId(null);
                      }}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Remove
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          );
        })}

        {/* Add traveler */}
        <button
          data-keep-drawer-open
          onClick={() => setOpen(true)}
          className="mt-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-300 focus-ring"
          title="Add a traveler"
        >
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-600">
            <Plus className="h-3.5 w-3.5" />
          </span>
          <span>Add traveler</span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">New traveler</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Each traveler keeps their own trips and packing lists.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs text-zinc-400">Name</Label>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  user.add(newName.trim());
                  setNewName("");
                  setOpen(false);
                }
              }}
              placeholder="Enter name"
              className="mt-1.5 bg-zinc-800 border-zinc-600 text-zinc-100"
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                if (newName.trim()) {
                  user.add(newName.trim());
                  setNewName("");
                  setOpen(false);
                }
              }}
              className="bg-primary hover:bg-emerald-700"
              disabled={!newName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One trip in the sidebar list.
 *
 * Laid out as a single column so the name, destination and meta line share a
 * left edge across every card — the previous version put the emoji in a
 * separate flex column, so long names wrapped against an offset edge.
 */
function TripCard({
  trip,
  progress,
  onClick,
}: {
  trip: Trip;
  progress: number;
  onClick: () => void;
}) {
  const isUpcoming = isUpcomingTrip(trip.startDate, trip.endDate, trip.archived);

  return (
    <motion.button
      layout
      onClick={onClick}
      whileTap={{ scale: 0.99 }}
      className="group w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04] focus-ring"
      title={`Open ${trip.name}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 text-sm leading-none">{trip.icon}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">
          {trip.name}
        </span>
        {isUpcoming && (
          <span
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400"
            title="Upcoming"
          />
        )}
      </div>

      {(trip.destination || trip.startDate || trip.endDate) && (
        <div className="mt-1 flex items-center gap-1.5 pl-[1.375rem] text-[11px] text-zinc-500">
          {trip.destination && (
            <>
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{trip.destination}</span>
            </>
          )}
          {trip.destination && (trip.startDate || trip.endDate) && (
            <span className="text-zinc-700">·</span>
          )}
          {(trip.startDate || trip.endDate) && (
            <span className="flex-shrink-0 whitespace-nowrap">
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
          )}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2 pl-[1.375rem]">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="w-7 flex-shrink-0 text-right text-[10px] tabular-nums text-zinc-500">
          {progress}%
        </span>
      </div>
    </motion.button>
  );
}

function TripList() {
  const { state, trip, helpers, hydrated } = useApp();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ upcoming: true, archived: false });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Framer Motion writes inline styles during SSR (opacity:0;height:0px from
  // `initial`) that differ from the values it computes on the client
  // (opacity: 1; height: auto;), which trips React's hydration check.
  // Only enable the animation after mount, and suppress `initial` on the
  // first pass so server and client markup agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Until hydrated, render the same empty view the server produced. Persisted
  // trips live in localStorage, which SSR cannot see, so showing them on the
  // first client render would change the tree structure vs. the server HTML.
  const tripsAvailable = hydrated;
  const upcomingTrips = tripsAvailable
    ? state.trips
        .filter((t) => !t.archived)
        .sort((a, b) => compareByDate(a.startDate, b.startDate))
    : [];

  const archivedTrips = tripsAvailable
    ? state.trips
        .filter((t) => t.archived)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : [];

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
      {/* Upcoming */}
      <div>
        <button
          onClick={() => toggleSection("upcoming")}
          className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500 transition-colors hover:text-zinc-300 focus-ring"
          title={expanded.upcoming ? "Collapse" : "Expand"}
        >
          {expanded.upcoming ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span className="flex-1 text-left">Upcoming</span>
          <span className="tabular-nums text-zinc-600">{upcomingTrips.length}</span>
        </button>
        <AnimatePresence>
          {expanded.upcoming && (
            <motion.div
              initial={mounted ? { opacity: 0, height: 0 } : false}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-0.5 space-y-0.5 overflow-hidden"
            >
              {upcomingTrips.map((t) => (
                <TripCard
                  key={t.id}
                  trip={t}
                  progress={helpers.getProgress(t.id)}
                  onClick={() => {
                    // Navigation handled by parent
                    window.location.href = `/trips/${t.id}`;
                  }}
                />
              ))}
              {upcomingTrips.length === 0 && (
                <p className="px-2 py-3 text-[11px] text-zinc-600">
                  No trips yet — create one below.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Archived */}
      {archivedTrips.length > 0 && (
        <div className="mt-3 border-t border-white/8 pt-2">
          <button
            onClick={() => toggleSection("archived")}
            className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500 transition-colors hover:text-zinc-300 focus-ring"
            title={expanded.archived ? "Collapse" : "Expand"}
          >
            {expanded.archived ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Archive className="h-3 w-3" />
            <span className="flex-1 text-left">Archived</span>
            <span className="tabular-nums text-zinc-600">{archivedTrips.length}</span>
          </button>
          <AnimatePresence>
            {expanded.archived && (
              <motion.div
                initial={mounted ? { opacity: 0, height: 0 } : false}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-0.5 space-y-0.5 overflow-hidden"
              >
                {archivedTrips.map((t) => (
                  <div key={t.id} className="group/arch relative">
                    <TripCard
                      trip={t}
                      progress={helpers.getProgress(t.id)}
                      onClick={() => {
                        window.location.href = `/trips/${t.id}`;
                      }}
                    />
                    <div className="absolute right-1.5 top-1.5 flex gap-0.5 transition-opacity md:opacity-0 focus-within:opacity-100 md:group-hover/arch:opacity-100">
                      <button
                        className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          trip.archive(t.id, false);
                        }}
                        aria-label={`Unarchive ${t.name}`}
                        title="Unarchive"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                      <Dialog
                        open={deleteConfirm === t.id}
                        onOpenChange={(o) => !o && setDeleteConfirm(null)}
                      >
                        <button
                          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(t.id);
                          }}
                          aria-label={`Delete ${t.name}`}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
                          <DialogHeader>
                            <DialogTitle className="text-zinc-100">Delete trip</DialogTitle>
                          </DialogHeader>
                          <p className="text-sm text-zinc-400">
                            Delete “{t.name}”? This cannot be undone.
                          </p>
                          <DialogFooter>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(null)}
                              className="text-zinc-400"
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => {
                                trip.delete(t.id);
                                setDeleteConfirm(null);
                              }}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Delete
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function SidebarBody({ onNewTrip }: { onNewTrip?: () => void }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-white/8 px-4 py-3.5">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
          <span className="text-sm leading-none">✈️</span>
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold leading-tight tracking-tight text-white">
            TripPlanner
          </h1>
          <p className="truncate text-[10px] leading-tight text-zinc-500">
            Plan smarter, stress less
          </p>
        </div>
      </div>

      <UserSwitcher />

      <TripList />

      {/* New Trip, with sign-in and About alongside it */}
      <div className="flex items-center gap-2 border-t border-white/8 p-3">
        <Button
          onClick={onNewTrip}
          className="h-9 flex-1 bg-primary font-medium text-white hover:bg-emerald-700 focus-ring"
          title="Create a new trip"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New Trip
        </Button>
        <SignInButton onClick={() => setLoginOpen(true)} />
        <AboutButton onClick={() => setAboutOpen(true)} />
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={(user) => {
          toast.add({
            title: `Signed in as ${user.name}`,
            type: "success",
          });
          // A full reload is deliberate. Signing in changes which user every
          // client-side cache belongs to, and the simplest way to guarantee no
          // stale data from the previous session survives is to start the app
          // fresh rather than trying to invalidate each store by hand. Getting
          // that wrong would show one account's trips to another.
          window.location.reload();
        }}
      />
    </>
  );
}
