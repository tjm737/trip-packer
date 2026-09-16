"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import {
  MapPin,
  Calendar,
  ArrowRight,
  Plus,
  Sparkles,
} from "lucide-react";
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

function TripCard({ trip, progress }: { trip: any; progress: number }) {
  const isUpcoming = new Date(trip.endDate) >= new Date() && !trip.archived;
  const daysUntil = isUpcoming
    ? Math.ceil((new Date(trip.startDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <motion.button
      layout
      onClick={() => (window.location.href = `/trips/${trip.id}`)}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="w-full text-left p-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{trip.icon}</span>
            <div>
              <h3 className="text-lg font-semibold text-white group-hover:text-emerald-300 transition-colors">
                {trip.name}
              </h3>
              {trip.destination && (
                <div className="flex items-center gap-1 text-sm text-zinc-400 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{trip.destination}</span>
                </div>
              )}
            </div>
          </div>
          {isUpcoming && daysUntil !== null && daysUntil >= 0 && daysUntil <= 7 && (
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              {daysUntil === 0 ? "Today!" : `${daysUntil}d`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500 mb-3">
          <div className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            <span>
              {new Date(trip.startDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}{" "}
              –{" "}
              {new Date(trip.endDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Packed</span>
            <span className="text-zinc-300 font-medium">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={`h-full rounded-full ${
                progress === 100
                  ? "bg-gradient-to-r from-emerald-400 to-green-500"
                  : "bg-gradient-to-r from-emerald-500 to-cyan-500"
              }`}
            />
          </div>
        </div>
      </div>
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
        <ArrowRight className="w-5 h-5 text-zinc-400" />
      </div>
    </motion.button>
  );
}

function CreateTripModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { trip, state } = useApp();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [icon, setIcon] = useState("✈️");
  const [step, setStep] = useState(1);

  const handleCreate = () => {
    if (!name.trim()) return;
    trip.create({
      name: name.trim(),
      destination: destination.trim(),
      startDate: startDate || new Date().toISOString().split("T")[0],
      endDate: endDate || startDate,
      notes,
      icon,
    });
    // Navigate to latest trip
    setTimeout(() => {
      const data = JSON.parse(localStorage.getItem("trip-packer-data") || "{}");
      const trips = data.trips || [];
      const latest = trips[trips.length - 1];
      if (latest) window.location.href = `/trips/${latest.id}`;
    }, 50);
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
            <div className="grid grid-cols-2 gap-3">
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
                <button
                  key={emoji}
                  onClick={() => setIcon(emoji)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                    icon === emoji
                      ? "bg-emerald-600 scale-110 ring-2 ring-emerald-400"
                      : "bg-zinc-800 hover:bg-zinc-700 hover:scale-105"
                  }`}
                >
                  {emoji}
                </button>
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
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
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

export default function Dashboard() {
  const { state, helpers } = useApp();
  const [createOpen, setCreateOpen] = useState(false);

  const upcomingTrips = state.trips
    .filter((t) => !t.archived)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  const totalItems = state.items.filter((i) =>
    upcomingTrips.some((t) => t.id === i.tripId)
  ).length;
  const checkedItems = state.items.filter((i) =>
    upcomingTrips.some((t) => t.id === i.tripId) && i.checked
  ).length;

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Hello, {state.users.find((u) => u.id === state.activeUserId)?.name || "Traveler"} 👋
            </h1>
            <p className="text-zinc-400 mt-1">
              {upcomingTrips.length === 0
                ? "Ready to plan your next adventure?"
                : `${upcomingTrips.length} upcoming trip${upcomingTrips.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Trip
          </Button>
        </div>

        {/* Stats row */}
        {totalItems > 0 && (
          <div className="flex gap-4 mb-6">
            <div className="px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
              <div className="w-5 h-5 rounded bg-emerald-500/20 flex items-center justify-center">
                <Plus className="w-3 h-3 text-emerald-400" />
              </div>
              <div>
                <div className="text-lg font-semibold text-white">{totalItems}</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Total Items</div>
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-emerald-400 flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-emerald-400 rounded-full" />
              </div>
              <div>
                <div className="text-lg font-semibold text-white">{checkedItems}</div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Packed</div>
              </div>
            </div>
            {upcomingTrips.length > 0 && (
              <div className="px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
                <Calendar className="w-5 h-5 text-cyan-400" />
                <div>
                  <div className="text-lg font-semibold text-white">
                    {new Date(upcomingTrips[0].startDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Next Trip</div>
                </div>
              </div>
            )}
          </div>
        )}

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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-center py-20"
          >
            <div className="text-6xl mb-4">🌍</div>
            <h2 className="text-xl font-semibold text-zinc-300 mb-2">No trips planned yet</h2>
            <p className="text-zinc-500 mb-6 max-w-sm mx-auto">
              Create your first trip and start building your packing list. It only takes a minute.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Trip
            </Button>
          </motion.div>
        )}
      </header>
      <CreateTripModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
