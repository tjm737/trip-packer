"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import {
  formatDate,
  formatDateRange,
  isUpcoming as isUpcomingTrip,
  compareByDate,
  daysUntil as daysUntilDate,
} from "@/lib/dates";
import {
  MapPin,
  Calendar,
  ArrowRight,
  Plus,
  Sparkles,
  Package,
  CheckCircle2,
  Upload,
} from "lucide-react";
import { ImportTripModal } from "@/components/ImportTripModal";
import { cn } from "cn";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const EMOJI_OPTIONS = [
  "✈️", "🏖️", "🏔️", "🌆", "🗼", "🏝️", "🎿", "🚢",
  "🏕️", "🌴", "🗺️", "🎡", "🏛️", "🌋", "🚂", "🛸",
];

/*
 * Stat-tile accents.
 *
 * These were emerald / cyan / violet — three unrelated hues sitting side by
 * side. Tailwind's cyan-400 resolves to #00d3f2 (H=188, S=100%, V=95%), which
 * is both off-palette and by far the brightest, most saturated colour on the
 * dashboard; it read as a stray teal against the sage system.
 *
 * The first two are now tints of the sage ramp itself, separated by *luminance*
 * rather than hue, so the row stays on-material. `violet` is kept as the single
 * deliberate contrast accent for the date tile.
 */
const STAT_ACCENTS = {
  emerald: {
    icon: "bg-emerald-500/15 text-emerald-400",
    ring: "group-hover:border-emerald-500/40",
  },
  sage: {
    icon: "bg-emerald-700/20 text-emerald-300",
    ring: "group-hover:border-emerald-700/45",
  },
  violet: {
    icon: "bg-violet-500/15 text-violet-400",
    ring: "group-hover:border-violet-500/40",
  },
} as const;

/**
 * A single dashboard metric.
 *
 * Sizing is deliberate: the value is larger than a trip-card title so the eye
 * lands here first, the label is small and muted, and the icon is tinted rather
 * than neutral so the three cards are distinguishable at a glance.
 */
function StatCard({
  icon,
  value,
  label,
  accent,
  hint,
  sub,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
  accent: keyof typeof STAT_ACCENTS;
  hint?: string;
  sub?: string;
}) {
  const a = STAT_ACCENTS[accent];
  return (
    <Tooltip label={hint} side="bottom">
      <div
        className={cn(
          "group flex items-center gap-3 px-4 py-3.5 rounded-xl border border-zinc-700/60",
          "surface-stat transition-colors focus-ring",
          a.ring
        )}
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", a.icon)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-semibold text-zinc-50 leading-tight tnum truncate">
            {value}
          </div>
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">
            {label}
          </div>
          {sub && <div className="text-[11px] text-zinc-400 mt-0.5 tnum">{sub}</div>}
        </div>
      </div>
    </Tooltip>
  );
}

function TripCard({ trip, progress }: { trip: any; progress: number }) {
  const isUpcoming = isUpcomingTrip(trip.startDate, trip.endDate, trip.archived);
  const daysUntil = isUpcoming ? daysUntilDate(trip.startDate) : null;
  const isDone = progress === 100;

  return (
    <motion.button
      layout
      onClick={() => (window.location.href = `/trips/${trip.id}`)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className="w-full text-left p-5 rounded-2xl border border-zinc-800/80 surface-raised hover:border-emerald-500/40 hover:bg-[var(--surface-2)] transition-colors group relative overflow-hidden focus-ring"
    >
      {/* Accent wash on hover — kept very low opacity so it tints without
          washing out the text sitting on top of it. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.07] to-emerald-700/[0.05] opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="text-2xl shrink-0 leading-none"
              aria-hidden="true"
              title={trip.icon ? "Trip icon" : undefined}
            >
              {trip.icon}
            </span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-zinc-50 group-hover:text-emerald-300 transition-colors truncate">
                {trip.name}
              </h3>
              {trip.destination && (
                <div className="flex items-center gap-1 text-[13px] text-zinc-400 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{trip.destination}</span>
                </div>
              )}
            </div>
          </div>
          {isUpcoming && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7 && (
            <Badge
              variant="secondary"
              className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 text-[11px] shrink-0 tnum"
            >
              {daysUntil === 0 ? "Today" : `${daysUntil}d`}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-3.5">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span className="tnum">{formatDateRange(trip.startDate, trip.endDate)}</span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">
              {isDone ? "All packed" : "Packing"}
            </span>
            <span className={cn("font-medium tnum", isDone ? "text-emerald-400" : "text-zinc-300")}>
              {progress}%
            </span>
          </div>
          <div
            className="w-full h-1.5 surface-inset rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${trip.name} packing progress`}
          >
            <motion.div
              /* initial={false} so a re-render (e.g. returning from the trip
                 page) doesn't replay the fill-from-zero animation. */
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={`h-full rounded-full ${
                isDone
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
                  : "bg-gradient-to-r from-emerald-500 to-emerald-700"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Affordance that the card opens a detail view. Always faintly visible
          so the card reads as interactive before hover, not after. */}
      <div className="absolute top-4 right-4 text-zinc-600 opacity-0 group-hover:opacity-100 transition-all -translate-x-1 group-hover:translate-x-0">
        <ArrowRight className="w-4 h-4" />
      </div>
    </motion.button>
  );
}

function CreateTripModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { trip, state } = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [icon, setIcon] = useState("✈️");
  const [step, setStep] = useState(1);

  const handleCreate = async () => {
    if (!name.trim()) return;
    // Dates are optional: store exactly what the user picked. If they chose a
    // start but no end, treat it as a single-day trip. Never silently default
    // to "today" — that turned blank-date trips into phantom trips (and used
    // UTC, which rolled to the wrong day in the evening).
    const start = startDate.trim();
    const end = endDate.trim() || start;
    // The trip is written to SQLite by the server, so wait for that to resolve
    // and navigate on the id it returns. The old localStorage poll-and-redirect
    // raced the write and had nothing to read once persistence moved server-side.
    const createdId = await trip.create({
      name: name.trim(),
      destination: destination.trim(),
      startDate: start,
      endDate: end,
      notes,
      icon,
    });
    if (createdId) router.push(`/trips/${createdId}`);
    setName("");
    setDestination("");
    setStartDate("");
    setEndDate("");
    setNotes("");
    setIcon("✈️");
    setStep(1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            Plan Your Next Adventure
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Step {step} of 2 — {step === 1 ? "Trip Details" : "Pick an Icon"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <Label className="text-zinc-300">Trip Name *</Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Summer Vacation"
                className="mt-1.5 bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
                onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
              />
            </div>
            <div>
              <Label className="text-zinc-300">Destination</Label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Bali, Indonesia"
                className="mt-1.5 bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
                onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-300">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1.5 bg-zinc-800 border-zinc-600 text-white"
                />
              </div>
              <div>
                <Label className="text-zinc-300">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1.5 bg-zinc-800 border-zinc-600 text-white"
                />
              </div>
            </div>
            <div>
              <Label className="text-zinc-300">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything to remember..."
                className="mt-1.5 bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500 resize-none"
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Label className="text-zinc-300">Choose an Icon</Label>
            <div className="grid grid-cols-8 gap-2">
              {EMOJI_OPTIONS.map((emoji) => (
                <Tooltip key={emoji} label={`Use ${emoji}`} side="top">
                  <button
                    type="button"
                    onClick={() => setIcon(emoji)}
                    aria-label={`Choose icon ${emoji}`}
                    aria-pressed={icon === emoji}
                    className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all focus-ring ${
                      icon === emoji
                        ? "bg-emerald-600 scale-110 ring-2 ring-emerald-400"
                        : "bg-zinc-800 hover:bg-zinc-700 hover:scale-105"
                    }`}
                  >
                    {emoji}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 2 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep(1)}
              className="text-zinc-400"
            >
              Back
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-zinc-400"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="bg-primary hover:bg-emerald-700 text-white"
            disabled={step === 1 && !name.trim()}
          >
            {step === 1 ? "Continue" : "Create Trip"}
            {step === 1 ? <ArrowRight className="w-4 h-4 ml-2" /> : <Sparkles className="w-4 h-4 ml-2" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DashboardClient() {
  const { state, helpers, hydrated } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Suppress entrance animations until after mount: Framer Motion's `initial`
  // styles are serialized into the SSR HTML and then differ on the client
  // (the animation has already resolved), which triggers a hydration warning.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Trips come from localStorage, which SSR cannot read — keep the first
  // client render identical to the server output by showing nothing until
  // hydration completes.
  const upcomingTrips = hydrated
    ? state.trips
        .filter((t) => !t.archived)
        .sort((a, b) => compareByDate(a.startDate, b.startDate))
    : [];

  const totalItems = hydrated
    ? state.items.filter((i) => upcomingTrips.some((t) => t.id === i.tripId)).length
    : 0;
  const checkedItems = hydrated
    ? state.items.filter((i) => upcomingTrips.some((t) => t.id === i.tripId) && i.checked).length
    : 0;

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="px-4 sm:px-8 pt-6 sm:pt-8 pb-8 sm:pb-10 max-w-6xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-3xl font-bold text-zinc-50 tracking-tight truncate">
              Hello, {state.users.find((u) => u.id === state.activeUserId)?.name || "Traveler"} 👋
            </h1>
            <p className="text-sm text-zinc-400 mt-1.5">
              {upcomingTrips.length === 0
                ? "Ready to plan your next adventure?"
                : `${upcomingTrips.length} upcoming trip${upcomingTrips.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip label="Create a trip from a saved itinerary file" side="left">
              <Button
                onClick={() => setImportOpen(true)}
                variant="outline"
                className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 focus-ring"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            </Tooltip>
            <Tooltip label="Create a new trip" side="left">
              <Button
                onClick={() => setCreateOpen(true)}
                className="bg-primary hover:bg-emerald-700 text-white px-5 shadow-lg shadow-emerald-950/40 transition-colors focus-ring"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Trip
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* Stats row.
            Always rendered (previously hidden whenever totalItems was 0, which
            made the header jump as items were added). While unhydrated the
            values are placeholders so the first client render still matches SSR. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <StatCard
            icon={<Package className="w-4 h-4" />}
            value={totalItems}
            label="Total items"
            accent="emerald"
            hint="Every item across your upcoming trips"
          />
          <StatCard
            icon={<CheckCircle2 className="w-4 h-4" />}
            value={checkedItems}
            label="Packed"
            accent="sage"
            hint="Items you have ticked off"
            sub={
              totalItems > 0
                ? `${Math.round((checkedItems / totalItems) * 100)}% complete`
                : undefined
            }
          />
          <StatCard
            icon={<Calendar className="w-4 h-4" />}
            value={
              upcomingTrips.length > 0
                ? formatDate(upcomingTrips[0].startDate) ??
                  formatDate(upcomingTrips[0].endDate) ??
                  "TBD"
                : "—"
            }
            label="Next trip"
            accent="violet"
            hint="Your soonest upcoming departure"
          />
        </div>

        {/* Trip grid */}
        {upcomingTrips.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingTrips.map((trip) => (
              <TripCard key={trip.id} trip={trip} progress={helpers.getProgress(trip.id)} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {upcomingTrips.length === 0 && (
          <motion.div
            initial={mounted ? { opacity: 0, y: 20 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center py-16 rounded-2xl border border-dashed border-zinc-800 surface-raised"
          >
            <div className="text-5xl mb-4" aria-hidden="true">🌍</div>
            <h2 className="text-lg font-semibold text-zinc-200 mb-2">No trips planned yet</h2>
            <p className="text-sm text-zinc-500 mb-6 max-w-sm mx-auto leading-relaxed">
              Create your first trip and start building your packing list. It only takes a minute.
            </p>
            <Tooltip label="Create your first trip" side="bottom">
              <Button
                onClick={() => setCreateOpen(true)}
                className="bg-primary hover:bg-emerald-700 text-white px-6 transition-colors focus-ring"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Your First Trip
              </Button>
            </Tooltip>
          </motion.div>
        )}
      </header>
      <CreateTripModal open={createOpen} onOpenChange={setCreateOpen} />
      <ImportTripModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
