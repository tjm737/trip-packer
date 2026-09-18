"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
import { getWeatherForDestination, WeatherForecast, getSuggestions, getHistoricalClimate, ClimateSummary, isWithinForecastRange } from "@/lib/weather";
import { formatDateRange } from "@/lib/dates";
import { Trip } from "@/lib/types";
import {
  MapPin,
  Calendar,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Trash2,
  Archive,
  ArrowLeft,
  Check,
  X,
  Minus,
  Edit3,
  Flag,
  Cloud,
  Star,
  Thermometer,
  Droplets,
  Wind,
  Umbrella,
  RefreshCw,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const ITEM_EMOJIS = [
  "📦", "🎒", "🧳", "📎", "🔑", "💊", "📱", "🔌", "🎧", "💻",
  "👕", "👖", "👗", "👟", "🧥", "🩲", "🧦", "🕶️", "🧢", "👒",
  "🪥", "🧴", "🧼", "☀️", "💳", "💵", "📘", "🗺️", "📋", "✈️",
  "🍫", "🍶", "🧸", "🎨", "📚", "🎮", "⌚", "💄", "🧴", "🪒",
];

function PackingItemRow({ item }: { item: any }) {
  const { item: itemActions, state } = useApp();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors group ${
        item.checked ? "bg-emerald-500/5" : "hover:bg-zinc-800/50"
      }`}
    >
      <Checkbox
        checked={item.checked}
        onCheckedChange={(checked) =>
          itemActions.update(item.id, { checked: !!checked })
        }
        className={`border-zinc-600 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500 ${
          item.checked ? "data-[state=checked]:bg-emerald-500" : ""
        }`}
      />
      <span className="text-sm">{item.icon}</span>

      <div className="flex-1 min-w-0">
        <span
          className={`text-sm transition-all ${
            item.checked
              ? "text-zinc-500 line-through"
              : "text-zinc-200"
          }`}
        >
          {item.name}
        </span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Tooltip label="Decrease quantity" side="top">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Decrease quantity of ${item.name}`}
            className="w-6 h-6 text-zinc-500 hover:text-zinc-300 focus-ring"
            onClick={() =>
              itemActions.update(item.id, {
                quantity: Math.max(1, (item.quantity || 1) - 1),
              })
            }
          >
            <Minus className="w-3 h-3" />
          </Button>
        </Tooltip>
        <span className="text-xs text-zinc-300 w-5 text-center tnum">
          {item.quantity}
        </span>
        <Tooltip label="Increase quantity" side="top">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Increase quantity of ${item.name}`}
            className="w-6 h-6 text-zinc-500 hover:text-zinc-300 focus-ring"
            onClick={() =>
              itemActions.update(item.id, {
                quantity: (item.quantity || 1) + 1,
              })
            }
          >
            <Plus className="w-3 h-3" />
          </Button>
        </Tooltip>
        <Tooltip label={`Remove ${item.name}`} side="top">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Remove ${item.name}`}
            className="w-6 h-6 text-zinc-600 hover:text-red-400 focus-ring"
            onClick={() => itemActions.delete(item.id)}
          >
            <X className="w-3 h-3" />
          </Button>
        </Tooltip>
      </div>
    </motion.div>
  );
}

function CategorySection({
  category,
  items,
  tripProgress,
  tripTotal,
}: {
  category: any;
  items: any[];
  tripProgress: number;
  tripTotal: number;
}) {
  const { category: catActions, item: itemActions } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const checkedInCategory = items.filter((i) => i.checked).length;
  const totalInCategory = items.length;

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    itemActions.create(
      category.tripId,
      category.id,
      newItemName.trim(),
      "📦",
      1
    );
    setNewItemName("");
  };

  return (
    <motion.div layout className="mb-4">
      {/* Category Header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 cursor-pointer hover:border-zinc-700 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <button onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}>
          {collapsed ? (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          )}
        </button>
        <span className="text-base">{category.icon}</span>
        <span className="text-sm font-medium text-zinc-200 flex-1">
          {category.name}
        </span>
        <span className="text-xs text-zinc-500">
          {checkedInCategory}/{totalInCategory}
        </span>

        {/* Category edit */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <Dialog
            open={editingCategoryId === category.id}
            onOpenChange={(o) => {
              if (o) {
                setEditingCategoryId(category.id);
                setEditName(category.name);
                setEditIcon(category.icon);
                setShowEmojiPicker(false);
              } else {
                setEditingCategoryId(null);
              }
            }}
          >
            <Button
              size="icon"
              variant="ghost"
              className="w-5 h-5 text-zinc-600 hover:text-zinc-400"
              onClick={(e) => e.stopPropagation()}
            >
              <Edit3 className="w-3 h-3" />
            </Button>
            <DialogContent className="sm:max-w-[320px] bg-zinc-900 border-zinc-700">
              <DialogHeader>
                <DialogTitle className="text-zinc-100">Edit Category</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-zinc-400 text-sm">Icon</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="w-9 h-9 bg-zinc-800 rounded-lg flex items-center justify-center text-lg hover:bg-zinc-700 transition-colors"
                    >
                      {editIcon || category.icon}
                    </button>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 bg-zinc-800 border-zinc-600 text-zinc-100"
                      placeholder="Category name"
                    />
                  </div>
                  {showEmojiPicker && (
                    <div className="flex flex-wrap gap-1 mt-2 bg-zinc-800 p-2 rounded-lg">
                      {ITEM_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => { setEditIcon(emoji); setShowEmojiPicker(false); }}
                          className="w-7 h-7 flex items-center justify-center text-sm hover:bg-zinc-700 rounded transition-colors"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCategoryId(null)}
                  className="text-zinc-400"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    catActions.update(category.id, { name: editName, icon: editIcon });
                    setEditingCategoryId(null);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            size="icon"
            variant="ghost"
            className="w-5 h-5 text-zinc-600 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete category "${category.name}" and all its items?`)) {
                catActions.delete(category.id);
              }
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Items */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1 space-y-0.5 pl-7"
          >
            {items.map((item) => (
              <PackingItemRow key={item.id} item={item} />
            ))}

            {/* Add item */}
            <div className="flex items-center gap-2 py-1.5 pl-1">
              <Input
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="Add item..."
                className="h-8 bg-transparent border-none text-sm text-zinc-300 placeholder:text-zinc-600 focus-visible:ring-0 px-1"
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
              />
              {newItemName && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-6 h-6 text-emerald-400 hover:text-emerald-300"
                  onClick={handleAddItem}
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TripDetail() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;
  const { state, trip, category: catActions, item: itemActions, helpers, hydrated } = useApp();

  // State used by all hooks — must be called unconditionally
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [climate, setClimate] = useState<ClimateSummary | null>(null);
  const [climateLoading, setClimateLoading] = useState(false);
  const [showClimate, setShowClimate] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  // Whether the 16-day forecast can actually reach this trip. If not, the
  // forecast panel would show weather for the wrong dates, so we surface
  // historical climate instead and say so.
  const [forecastReaches, setForecastReaches] = useState(true);
  const [suggestions, setSuggestions] = useState<{ name: string; icon: string; category: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [tripInfo, setTripInfo] = useState<Trip | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Hydrate from context + localStorage after mount
  useEffect(() => {
    const fromContext = state.trips.find((t) => t.id === tripId);
    if (fromContext) {
      setTripInfo(fromContext);
      setIsReady(true);
    } else {
      // State arrives from the SQLite-backed context; on a deep link the
      // provider may still be loading, so wait for hydration before deciding
      // the trip does not exist.
      if (!hydrated) return;
      setIsReady(true);
    }
  }, [tripId, state.trips]);

  // Keep tripInfo in sync with context so edits from elsewhere propagate
  useEffect(() => {
    const fromContext = state.trips.find((t) => t.id === tripId);
    if (fromContext) setTripInfo(fromContext);
  }, [tripId, state.trips]);

  // Sync notesText when the loaded trip changes
  useEffect(() => {
    if (tripInfo) setNotesText(tripInfo.notes);
  }, [tripInfo]);

  // Fetch weather when trip has a destination
  useEffect(() => {
    if (!tripInfo?.destination) {
      setWeather(null);
      return;
    }
    setForecastReaches(
      isWithinForecastRange(tripInfo.startDate, tripInfo.endDate)
    );
    let cancelled = false;
    const loadWeather = async () => {
      setWeatherLoading(true);
      setWeatherError(null);
      try {
        const forecast = await getWeatherForDestination(
          tripInfo.destination,
          tripInfo.startDate,
          tripInfo.endDate
        );
        if (cancelled) return;
        setWeather(forecast);
        if (forecast) {
          setSuggestions(getSuggestions(forecast));
          setShowSuggestions(false);
        }
      } catch (err) {
        if (!cancelled) setWeatherError("Could not fetch weather for this destination");
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };
    loadWeather();
    return () => {
      cancelled = true;
    };
  }, [tripId, tripInfo?.destination, tripInfo?.startDate, tripInfo?.endDate]);

  // Fetch historical climate for the same dates in prior years. This is what
  // makes far-future trips useful, since the forecast API only reaches 16 days.
  useEffect(() => {
    if (!tripInfo?.destination || !tripInfo?.startDate || !tripInfo?.endDate) {
      setClimate(null);
      return;
    }
    let cancelled = false;
    // Open the climate panel by default when the forecast can't reach the trip,
    // since it's then the only meaningful weather information on the page.
    setShowClimate(!isWithinForecastRange(tripInfo.startDate, tripInfo.endDate));
    const loadClimate = async () => {
      setClimateLoading(true);
      try {
        const summary = await getHistoricalClimate(
          tripInfo.destination,
          tripInfo.startDate,
          tripInfo.endDate
        );
        if (!cancelled) setClimate(summary);
      } catch {
        if (!cancelled) setClimate(null);
      } finally {
        if (!cancelled) setClimateLoading(false);
      }
    };
    loadClimate();
    return () => {
      cancelled = true;
    };
  }, [tripId, tripInfo?.destination, tripInfo?.startDate, tripInfo?.endDate]);

  // Progress and categories — derived, no hooks, safe before any return
  const progress = helpers.getProgress(tripId);
  const isComplete = progress === 100;
  const categories = helpers.getCategories(tripId);

  // Early return if still loading
  if (!isReady) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-5 h-5 border-2 border-zinc-600 border-t-emerald-500 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">Loading trip...</p>
        </div>
      </div>
    );
  }

  if (!tripInfo) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400">Trip not found</p>
          <Button
            variant="link"
            onClick={() => router.push("/")}
            className="text-emerald-400 mt-2"
          >
            ← Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Use tripInfo for display and stateful updates
  const tripDisplay = tripInfo;

  const handleRefreshWeather = () => {
    if (tripInfo.destination) {
      setWeather(null);
      setSuggestions([]);
      setShowSuggestions(false);
      const loadWeather = async () => {
        setWeatherLoading(true);
        setWeatherError(null);
        try {
          const forecast = await getWeatherForDestination(tripInfo.destination, tripInfo.startDate, tripInfo.endDate);
          setWeather(forecast);
          if (forecast) {
            const preds = getSuggestions(forecast);
            setSuggestions(preds);
            setShowSuggestions(false);
          }
        } catch (err) {
          setWeatherError("Could not fetch weather for this destination");
        } finally {
          setWeatherLoading(false);
        }
      };
      loadWeather();
    }
  }

  const handleSaveNotes = () => {
    trip.update(tripId, { notes: notesText });
    setEditingNotes(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Tooltip label="Back to all trips" side="right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/")}
                aria-label="Back to all trips"
                className="text-zinc-400 hover:text-white -ml-2 focus-ring"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Tooltip>
            <span className="text-2xl">{tripInfo.icon}</span>
            <h1 className="text-xl font-bold text-white">{tripInfo.name}</h1>
          </div>

          {/* Trip meta */}
          <div className="flex items-center gap-4 text-sm text-zinc-400 mb-3">
            {tripInfo.destination && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                <span>{tripInfo.destination}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
              <span>{formatDateRange(tripInfo.startDate, tripInfo.endDate)}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                {isComplete ? "🎉 All packed!" : "Packing progress"}
              </span>
              <span className="text-xs font-medium text-zinc-300">{progress}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden bg-zinc-800/80">
              <motion.div
                /* No `initial` here: animating width from 0 on every mount made the
                   bar replay its fill on each render/navigation. Letting it settle
                   at the real value and animating only on subsequent changes keeps
                   the progress honest. */
                initial={false}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={`h-full rounded-full ${
                  isComplete
                    ? "bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-400"
                    : "bg-gradient-to-r from-emerald-500 to-cyan-500"
                }`}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-6 sm:px-8 py-6">
        {/* Notes section */}
        <div className="mb-6 p-4 rounded-xl border border-zinc-800 surface-raised">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5 text-zinc-500" />
              Notes
            </span>
            <Tooltip label={editingNotes ? "Save notes" : "Edit notes"} side="left">
            <Button
              size="sm"
              variant="ghost"
              aria-label={editingNotes ? "Save notes" : "Edit notes"}
              className="h-6 px-2 text-zinc-500 hover:text-zinc-300 focus-ring"
              onClick={() => {
                if (editingNotes) {
                  handleSaveNotes();
                } else {
                  setNotesText(tripInfo.notes);
                  setEditingNotes(true);
                }
              }}
            >
              <Edit3 className="w-3 h-3" />
            </Button>
            </Tooltip>
          </div>
          {editingNotes ? (
            <Textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              onBlur={handleSaveNotes}
              autoFocus
              className="bg-transparent border-none text-sm text-zinc-300 resize-none focus-visible:ring-0"
              rows={3}
            />
          ) : (
            <p className="text-sm text-zinc-400">
              {tripInfo.notes || "No notes yet..."}
            </p>
          )}
        </div>

        {/* Weather forecast section */}
        {tripInfo.destination && (
          <div className="mb-6 p-4 rounded-xl border border-zinc-800 surface-raised">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5 text-zinc-500" />
                {forecastReaches ? "Weather Forecast" : "Current Weather"}
              </span>
              <Tooltip label="Refresh weather" side="left">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Refresh weather"
                  className="w-6 h-6 text-zinc-500 hover:text-zinc-200 focus-ring"
                  onClick={handleRefreshWeather}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
            </div>

            {!forecastReaches && weather && (
              <p className="text-xs text-amber-400/90 mb-3 leading-relaxed">
                Your trip is more than 16 days out, so a forecast isn&apos;t available yet.
                The readings below are conditions at this destination right now — see
                Historical Climate below for what to actually expect.
              </p>
            )}

            {weatherLoading && !weather ? (
              <div className="flex items-center gap-3 py-4">
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-emerald-500 rounded-full animate-spin" />
                <span className="text-sm text-zinc-400">Fetching weather for {tripInfo.destination}...</span>
              </div>
            ) : weatherError ? (
              <div className="flex items-center gap-3 py-4">
                <span className="text-sm text-amber-400">{weatherError}</span>
              </div>
            ) : weather ? (
              <div className="space-y-4">
                {/* Current conditions card */}
                <div className="flex items-center gap-4 p-3 rounded-lg surface-inset border border-zinc-800/60">
                  <span className="text-3xl">{weather.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-medium text-white">{Math.round(weather.temperature)}°F</span>
                      <span className="text-sm text-zinc-400">{weather.condition}</span>
                      {!forecastReaches && (
                        <span className="text-xs text-zinc-600">· right now</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                      <span className="flex items-center gap-1"><Droplets className="w-3 h-3" />{weather.precipitation.toFixed(2)} in</span>
                      <span className="flex items-center gap-1"><Wind className="w-3 h-3" />{Math.round(weather.windSpeed)} mph</span>
                    </div>
                  </div>
                </div>

                {/* 7-day forecast — only meaningful when it can reach the trip */}
                {forecastReaches && (
                  <div>
                    <p className="text-xs text-zinc-500 mb-2">Daily high / low (°F)</p>
                    <div className="grid grid-cols-7 gap-1">
                      {weather.daily.slice(0, 7).map((day) => (
                        <div key={day.date} className="text-center p-2 rounded-lg surface-inset border border-zinc-800/60">
                          <p className="text-xs text-zinc-500 mb-1">
                            {new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                          </p>
                          <span className="text-sm block mb-1">{day.icon}</span>
                          <p className="text-xs text-emerald-400">{Math.round(day.tempMax)}°</p>
                          <p className="text-xs text-zinc-600">{Math.round(day.tempMin)}°</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Weather-based packing suggestions */}
                {suggestions.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowSuggestions(!showSuggestions)}
                      className="flex items-center gap-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors w-full"
                    >
                      <Umbrella className="w-3.5 h-3.5" />
                      {showSuggestions ? "Hide" : "Show"} Weather-Based Suggestions
                      <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showSuggestions ? "rotate-180" : ""}`} />
                    </button>

                    <AnimatePresence>
                      {showSuggestions && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {suggestions.map((sugg, i) => {
                              const existingItem = helpers.getItemsForCategoryAndName(
                                tripId,
                                "Weather Suggestions",
                                sugg.name
                              );
                              return (
                                <div
                                  key={i}
                                  className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer transition-all ${
                                    existingItem
                                      ? "bg-emerald-900/20 border-emerald-700/30 text-emerald-400/70"
                                      : "bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-600"
                                  }`}
                                  title={existingItem ? "Already in list" : "Click to add to packing list"}
                                >
                                  <span>{sugg.icon}</span>
                                  <span className="flex-1 truncate">{sugg.name}</span>
                                  {existingItem ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                  ) : (
                                    <Plus
                                      className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const weatherCat = await helpers.findOrCreateCategory(tripId, "Weather Suggestions", "🌤️");
                                        await itemActions.create(tripId, weatherCat, sugg.name, "🌤️", 1);
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Historical climate — same dates in prior years */}
        {tripInfo.destination && tripInfo.startDate && tripInfo.endDate && (
          <div className="mb-6 p-4 rounded-xl border border-zinc-800 surface-raised">
            <button
              onClick={() => setShowClimate(!showClimate)}
              className="flex items-center gap-1.5 text-sm font-medium text-zinc-300 hover:text-white transition-colors w-full"
              title={showClimate ? "Collapse historical climate" : "Expand historical climate"}
            >
              <CalendarDays className="w-3.5 h-3.5 text-zinc-500" />
              Historical Climate
              <span className="text-xs font-normal text-zinc-600 ml-1">
                {climate ? `${climate.sampledYears} yr avg` : ""}
              </span>
              <ChevronDown
                className={`w-3 h-3 ml-auto transition-transform ${showClimate ? "rotate-180" : ""}`}
              />
            </button>

            {climateLoading && !climate ? (
              <div className="flex items-center gap-3 py-3 mt-3">
                <div className="w-4 h-4 border-2 border-zinc-600 border-t-emerald-500 rounded-full animate-spin" />
                <span className="text-sm text-zinc-400">
                  Loading past years for {tripInfo.destination}...
                </span>
              </div>
            ) : climate ? (
              <AnimatePresence initial={false}>
                {showClimate && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 space-y-4">
                      <p className="text-xs text-zinc-500">
                        What {climate.windowStart} – {climate.windowEnd} has typically looked like
                        at this destination, based on the last {climate.sampledYears} years.
                      </p>

                      {/* Averages */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2.5 rounded-lg surface-inset border border-zinc-800/60 text-center">
                          <p className="text-xs text-zinc-500 mb-1">Avg High</p>
                          <p className="text-lg font-medium text-emerald-400">
                            {Math.round(climate.avgHigh)}°F
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg surface-inset border border-zinc-800/60 text-center">
                          <p className="text-xs text-zinc-500 mb-1">Avg Low</p>
                          <p className="text-lg font-medium text-sky-400">
                            {Math.round(climate.avgLow)}°F
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg surface-inset border border-zinc-800/60 text-center">
                          <p className="text-xs text-zinc-500 mb-1">Wet Days</p>
                          <p className="text-lg font-medium text-zinc-300">
                            {climate.avgWetDays.toFixed(1)}
                          </p>
                        </div>
                      </div>

                      {/* Year-by-year */}
                      <div>
                        <p className="text-xs text-zinc-500 mb-2">Year by year</p>
                        <div className="space-y-1">
                          {climate.years.map((y) => (
                            <div
                              key={y.year}
                              className="flex items-center gap-3 px-2.5 py-1.5 rounded-lg surface-inset border border-zinc-800/50 text-xs"
                              title={`${y.year}: avg high ${y.tempMaxAvg}°F, avg low ${y.tempMinAvg}°F, peak ${y.tempMaxPeak}°F, low ${y.tempMinFloor}°F, ${y.precipitationTotal}in over ${y.wetDays} wet day(s)`}
                            >
                              <span className="text-zinc-500 w-10 flex-shrink-0">{y.year}</span>
                              <span className="text-zinc-600 w-4 flex-shrink-0">{y.icon}</span>
                              <span className="text-emerald-400 w-14 flex-shrink-0">
                                {Math.round(y.tempMaxAvg)}°
                              </span>
                              <span className="text-sky-400 w-14 flex-shrink-0">
                                {Math.round(y.tempMinAvg)}°
                              </span>
                              <span
                                className={`flex-1 truncate text-right ${
                                  y.precipitationTotal > 0.01 ? "text-zinc-400" : "text-zinc-600"
                                }`}
                              >
                                {y.precipitationTotal > 0.01
                                  ? `${y.precipitationTotal.toFixed(2)} in · ${y.wetDays}d wet`
                                  : "dry"}
                              </span>
                              <span className="text-zinc-500 w-10 flex-shrink-0 text-right">
                                {y.condition === "Clear sky" ? "Clear" : y.condition}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Extremes note */}
                      <p className="text-xs text-zinc-600 leading-relaxed">
                        Warmest year was {climate.warmestYear}, coolest was {climate.coolestYear},
                        and {climate.wettestYear} was the wettest. Peak temperatures in the window
                        have ranged from {Math.min(...climate.years.map((y) => y.tempMinFloor))}°F to{" "}
                        {Math.max(...climate.years.map((y) => y.tempMaxPeak))}°F.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <p className="text-sm text-zinc-500 py-3 mt-3">
                No historical data available for this destination.
              </p>
            )}
          </div>
        )}

        {/* Packing list */}
        {categories.length === 0 ? (
          <div className="text-center py-16">
            <Cloud className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 mb-4">No categories yet</p>
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300"
              onClick={() => {
                catActions.create(tripId, "Custom", "⭐");
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add a Category
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                items={helpers.getItems(cat.id)}
                tripProgress={progress}
                tripTotal={categories.length}
              />
            ))}

            {/* Add Category — inline field rather than window.prompt(), which
                looked alien against the dark UI and couldn't be styled or
                cancelled with anything but a browser-native dialog. */}
            <div className="py-2 px-3">
              {addingCategory ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newCategoryName.trim();
                    if (!name) return;
                    catActions.create(tripId, name, "⭐");
                    setNewCategoryName("");
                    setAddingCategory(false);
                  }}
                >
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setNewCategoryName("");
                        setAddingCategory(false);
                      }
                    }}
                    placeholder="Category name"
                    autoFocus
                    aria-label="New category name"
                    className="h-8 max-w-xs text-sm surface-inset border-zinc-800"
                  />
                  <Button type="submit" size="sm" variant="ghost" className="h-8 text-emerald-400 hover:text-emerald-300">
                    Add
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-zinc-500 hover:text-zinc-300"
                    onClick={() => {
                      setNewCategoryName("");
                      setAddingCategory(false);
                    }}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <Tooltip label="Add a packing category" side="top">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 focus-ring"
                    onClick={() => setAddingCategory(true)}
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add Category
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Trip actions */}
        <div className="mt-10 pt-6 border-t border-zinc-800/80 flex items-center gap-2">
          <Tooltip label="Change trip details" side="top">
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 focus-ring"
              onClick={() => router.push(`/trips/${tripId}/edit`)}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Edit Trip
            </Button>
          </Tooltip>
          <Tooltip
            label={tripInfo.archived ? "Restore to active trips" : "Hide from your active trips"}
            side="top"
          >
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30 focus-ring"
              onClick={() => {
                trip.archive(tripId, !tripInfo.archived);
              }}
            >
              <Archive className="w-3.5 h-3.5 mr-1.5" />
              {tripInfo.archived ? "Unarchive" : "Archive"}
            </Button>
          </Tooltip>
          <Tooltip label="Permanently delete this trip" side="top">
            <Button
              variant="outline"
              size="sm"
              className="border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/30 ml-auto focus-ring"
              onClick={async () => {
                if (confirm(`Delete "${tripInfo.name}"? This cannot be undone.`)) {
                  // Await the write: navigating first would unmount this page
                  // mid-request and could drop the delete entirely.
                  await trip.delete(tripId);
                  router.push("/");
                }
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Delete
            </Button>
          </Tooltip>
        </div>
      </main>
    </div>
  );
}
