"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import { User, Trip } from "@/lib/types";
import { formatDateRange, isUpcoming as isUpcomingTrip, compareByDate } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Users,
  MapPin,
  Archive,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
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
      className={`${sizeClasses[size]} ${user.avatarColor} rounded-full flex items-center justify-center text-white font-semibold select-none`}
      title={user.name}
    >
      {initials}
    </div>
  );
}

function UserSwitcher() {
  const { state, user, activeUser } = useApp();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  if (!activeUser) return null;

  return (
    <div className="px-3 pt-3 border-b border-white/5">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Users</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.users.map((u) => (
          <div key={u.id} className="relative group">
            <button
              onClick={() => user.switch(u.id)}
              className={`transition-all ${
                u.id === state.activeUserId
                  ? "ring-2 ring-white/40 scale-105"
                  : "opacity-60 hover:opacity-100 hover:scale-105"
              }`}
            >
              <UserAvatar user={u} size="sm" />
            </button>
            {u.id === state.activeUserId && (
              <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] text-white/60 whitespace-nowrap">
                {u.name}
              </span>
            )}
            {state.users.length > 1 && (
              <div className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Dialog
                  open={editingId === u.id}
                  onOpenChange={(o) => {
                    if (o) {
                      setEditingId(u.id);
                      setEditName(u.name);
                    } else {
                      setEditingId(null);
                    }
                  }}
                >
                  <DialogTrigger>
                    <div className="w-3 h-3 bg-red-500/80 rounded-full text-[8px] text-white flex items-center justify-center hover:bg-red-500 cursor-pointer">
                      <Pencil className="w-2 h-2" />
                    </div>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
                    <DialogHeader>
                      <DialogTitle className="text-zinc-100">Rename User</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-zinc-400 text-sm">Name</Label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="mt-1 bg-zinc-800 border-zinc-600 text-zinc-100"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                        className="text-zinc-400"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (editName.trim()) {
                            user.update(u.id, { name: editName.trim() });
                          }
                          setEditingId(null);
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        Save
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
        ))}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <div className="w-7 h-7 border border-dashed border-zinc-600 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:border-zinc-400 transition-colors cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
            </div>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">New User</DialogTitle>
              <DialogDescription className="text-zinc-400">
                Create a new user profile with separate trip data.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label className="text-zinc-400 text-sm">Name</Label>
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
                placeholder="Enter user name"
                className="mt-1 bg-zinc-800 border-zinc-600 text-zinc-100"
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
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!newName.trim()}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

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
      whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.06)" }}
      whileTap={{ scale: 0.98 }}
      className="w-full text-left p-3 rounded-xl transition-colors group"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg mt-0.5">{trip.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-zinc-200 truncate">{trip.name}</span>
            {isUpcoming && (
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full flex-shrink-0" />
            )}
          </div>
          {trip.destination && (
            <div className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
              <MapPin className="w-3 h-3" />
              <span className="truncate">{trip.destination}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-zinc-600">
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] text-zinc-500 w-5 text-right">{progress}%</span>
            </div>
          </div>
        </div>
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
    <div className="flex-1 overflow-y-auto px-2 pt-2 space-y-4">
      {/* Upcoming */}
      <div>
        <button
          onClick={() => toggleSection("upcoming")}
          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-zinc-300 transition-colors"
        >
          {expanded.upcoming ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span>Upcoming ({upcomingTrips.length})</span>
        </button>
        <AnimatePresence>
          {expanded.upcoming && (
            <motion.div
              initial={mounted ? { opacity: 0, height: 0 } : false}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-0.5"
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
                <div className="text-xs text-zinc-600 text-center py-4">No trips yet</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Archived */}
      {archivedTrips.length > 0 && (
        <div>
          <button
            onClick={() => toggleSection("archived")}
            className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-zinc-300 transition-colors"
          >
            {expanded.archived ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <Archive className="w-3 h-3" />
            <span>Archived ({archivedTrips.length})</span>
          </button>
          <AnimatePresence>
            {expanded.archived && (
              <motion.div
                initial={mounted ? { opacity: 0, height: 0 } : false}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-0.5"
              >
                {archivedTrips.map((t) => (
                  <div key={t.id} className="relative group">
                    <TripCard
                      trip={t}
                      progress={helpers.getProgress(t.id)}
                      onClick={() => {
                        window.location.href = `/trips/${t.id}`;
                      }}
                    />
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-5 h-5 text-zinc-500 hover:text-zinc-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          trip.archive(t.id, false);
                        }}
                        title="Unarchive"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </Button>
                      <Dialog
                        open={deleteConfirm === t.id}
                        onOpenChange={(o) => !o && setDeleteConfirm(null)}
                      >
                        <span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="w-5 h-5 text-zinc-500 hover:text-red-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(t.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </span>
                        <DialogContent className="sm:max-w-[320px] bg-[var(--surface-2)] border-zinc-700">
                          <DialogHeader>
                            <DialogTitle className="text-zinc-100">Delete Trip</DialogTitle>
                          </DialogHeader>
                          <p className="text-zinc-400 text-sm">
                            Delete "{t.name}"? This cannot be undone.
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
  return (
    <>
      {/* Logo */}
      <div className="px-4 pt-5 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-cyan-500 rounded-lg flex items-center justify-center">
            <span className="text-sm">✈️</span>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">TripPlanner</h1>
            <p className="text-[10px] text-zinc-500 -mt-0.5">Plan smarter, stress less</p>
          </div>
        </div>
      </div>

      <UserSwitcher />

      <TripList />

      {/* New Trip Button */}
      <div className="p-3 border-t border-white/5">
        <Button
          onClick={onNewTrip}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Trip
        </Button>
      </div>
    </>
  );
}
