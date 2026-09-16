"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/AppContext";
import {
  ArrowLeft,
  Sparkles,
  MapPin,
  Calendar,
  CalendarDays,
  Flag,
  Edit3,
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

export default function EditTripPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;
  const { state, trip } = useApp();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [icon, setIcon] = useState("✈️");

  const tripData = state.trips.find((t) => t.id === tripId);

  // Load trip data
  useEffect(() => {
    if (tripData) {
      setName(tripData.name);
      setDestination(tripData.destination);
      setStartDate(tripData.startDate);
      setEndDate(tripData.endDate);
      setNotes(tripData.notes);
      setIcon(tripData.icon);
    }
  }, [tripData?.id]);

  const handleSave = () => {
    if (!name.trim() || !tripData) return;
    trip.update(tripId, {
      name: name.trim(),
      destination: destination.trim(),
      startDate: startDate,
      endDate: endDate,
      notes,
      icon,
    });
    router.push(`/trips/${tripId}`);
  };

  if (!tripData) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-zinc-400">Trip not found</p>
      </div>
    );
  }

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
              <Edit3 className="w-5 h-5 text-cyan-400" />
              <h1 className="text-2xl font-bold text-white">
                Edit Trip
              </h1>
            </div>
            <p className="text-zinc-400 text-sm">Update your trip details</p>
          </div>

          <div className="space-y-5">
            <div>
              <Label className="text-zinc-300">Trip Name *</Label>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Summer Vacation"
                className="mt-1.5 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600"
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
                Notes
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything to remember..."
                className="mt-1.5 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-600 resize-none"
                rows={3}
              />
            </div>

            <div>
              <Label className="text-zinc-300">Icon</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setIcon(emoji)}
                    className={`w-10 h-10 rounded-lg text-lg flex items-center justify-center transition-all ${
                      icon === emoji
                        ? "bg-cyan-600 ring-2 ring-cyan-400 scale-110"
                        : "bg-zinc-900 hover:bg-zinc-800"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => router.back()}
                className="flex-1 border-zinc-700 text-zinc-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!name.trim()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
