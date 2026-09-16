"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/AppContext";
import {
  ArrowLeft,
  Plus,
  Sparkles,
  MapPin,
  Calendar,
  Flag,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sidebar } from "@/components/Sidebar";

const EMOJI_OPTIONS = [
  "✈️", "🏖️", "🏔️", "🌆", "🗼", "🏝️", "🎿", "🚢",
  "🏕️", "🌴", "🗺️", "🎡", "🏛️", "🌋", "🚂", "🛸",
  "🏠", "🎪", "🎓", "💼", "🩺", "🛏️", "🍽️", "⛳",
];

export default function NewTripPage() {
  const router = useRouter();
  const { trip, state } = useApp();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [icon, setIcon] = useState("✈️");

  const handleCreate = () => {
    if (!name.trim()) return;
    const created = trip.create({
      name: name.trim(),
      destination: destination.trim(),
      startDate: startDate || new Date().toISOString().split("T")[0],
      endDate: endDate || startDate,
      notes,
      icon,
    });
    // Navigate to the newly created trip
    setTimeout(() => {
      const data = JSON.parse(localStorage.getItem("trip-packer-data") || "{}");
      const trips = data.trips || [];
      const latest = trips[trips.length - 1];
      if (latest) router.push(`/trips/${latest.id}`);
    }, 50);
  };

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar onNewTrip={() => {}} />
      <main className="flex-1">
        <div className="max-w-xl mx-auto px-8 py-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-zinc-400 hover:text-white mb-6 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>

          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              <h1 className="text-2xl font-bold text-white">
                {step === 1 ? "Trip Details" : "Pick an Icon"}
              </h1>
            </div>
            <p className="text-zinc-400 text-sm">Step {step} of 2</p>
          </div>

          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <Label className="text-zinc-300">Trip Name *</Label>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Summer Vacation"
                  className="mt-1.5 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600"
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
                />
              </div>

              <div>
                <Label className="text-zinc-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                  Destination
                </Label>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Bali, Indonesia"
                  className="mt-1.5 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600"
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-zinc-300 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                    Start Date
                  </Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1.5 bg-zinc-900 border-zinc-700 text-white"
                  />
                </div>
                <div>
                  <Label className="text-zinc-300 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-zinc-500" />
                    End Date
                  </Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-1.5 bg-zinc-900 border-zinc-700 text-white"
                  />
                </div>
              </div>

              <div>
                <Label className="text-zinc-300 flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-zinc-500" />
                  Notes (optional)
                </Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything to remember..."
                  className="mt-1.5 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 resize-none"
                  rows={3}
                />
              </div>

              <Button
                onClick={() => name.trim() && setStep(2)}
                disabled={!name.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-base"
              >
                Continue <Plus className="w-4 h-4 ml-2" />
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <Label className="text-zinc-300">Choose an Icon</Label>
                <div className="grid grid-cols-8 gap-2 mt-3">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setIcon(emoji)}
                      className={`w-12 h-12 rounded-xl text-xl flex items-center justify-center transition-all ${
                        icon === emoji
                          ? "bg-emerald-600 ring-2 ring-emerald-400 scale-110"
                          : "bg-zinc-900 hover:bg-zinc-800 hover:scale-105"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className="text-white font-medium">{name || "Untitled Trip"}</div>
                    <div className="text-zinc-500 text-sm">
                      {destination || "No destination set"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1 border-zinc-700 text-zinc-300"
                >
                  Back
                </Button>
                <Button
                  onClick={handleCreate}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-6"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Create Trip
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
