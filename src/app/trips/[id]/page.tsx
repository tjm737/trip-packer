"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useApp } from "@/lib/AppContext";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          size="icon"
          variant="ghost"
          className="w-6 h-6 text-zinc-500 hover:text-zinc-300"
          onClick={() =>
            itemActions.update(item.id, {
              quantity: Math.max(1, (item.quantity || 1) - 1),
            })
          }
        >
          <Minus className="w-3 h-3" />
        </Button>
        <span className="text-xs text-zinc-400 w-4 text-center tabular-nums">
          {item.quantity}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="w-6 h-6 text-zinc-500 hover:text-zinc-300"
          onClick={() =>
            itemActions.update(item.id, {
              quantity: (item.quantity || 1) + 1,
            })
          }
        >
          <Plus className="w-3 h-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="w-6 h-6 text-zinc-600 hover:text-red-400"
          onClick={() => itemActions.delete(item.id)}
        >
          <X className="w-3 h-3" />
        </Button>
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
  const { state, trip, category: catActions, item: itemActions, helpers } = useApp();
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState("");

  const tripData = state.trips.find((t) => t.id === tripId);
  if (!tripData) {
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

  const progress = helpers.getProgress(tripId);
  const isComplete = progress === 100;
  const categories = helpers.getCategories(tripId);

  // Load notes
  useEffect(() => {
    setNotesText(tripData.notes);
  }, [tripData.id]);

  const handleSaveNotes = () => {
    trip.update(tripId, { notes: notesText });
    setEditingNotes(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="text-zinc-400 hover:text-white -ml-2"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="text-2xl">{tripData.icon}</span>
            <h1 className="text-xl font-bold text-white">{tripData.name}</h1>
          </div>

          {/* Trip meta */}
          <div className="flex items-center gap-4 text-sm text-zinc-400 mb-3">
            {tripData.destination && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                <span>{tripData.destination}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
              <span>
                {new Date(tripData.startDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                –{" "}
                {new Date(tripData.endDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
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
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
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
      <main className="max-w-3xl mx-auto px-6 py-6">
        {/* Notes section */}
        <div className="mb-8 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
              <Flag className="w-3.5 h-3.5 text-zinc-500" />
              Notes
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                if (editingNotes) {
                  handleSaveNotes();
                } else {
                  setNotesText(tripData.notes);
                  setEditingNotes(true);
                }
              }}
            >
              <Edit3 className="w-3 h-3" />
            </Button>
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
              {tripData.notes || "No notes yet..."}
            </p>
          )}
        </div>

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

            {/* Add Category */}
            <div className="flex items-center gap-2 py-2 px-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                onClick={() => {
                  const name = prompt("Category name:");
                  if (name?.trim()) {
                    catActions.create(tripId, name.trim(), "⭐");
                  }
                }}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Add Category
              </Button>
            </div>
          </div>
        )}

        {/* Trip actions */}
        <div className="mt-12 pt-6 border-t border-zinc-800 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
            onClick={() => router.push(`/trips/${tripId}/edit`)}
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit Trip
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30"
            onClick={() => {
              trip.archive(tripId, !tripData.archived);
            }}
          >
            <Archive className="w-3.5 h-3.5 mr-1.5" />
            {tripData.archived ? "Unarchive" : "Archive"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/30 ml-auto"
            onClick={() => {
              if (confirm(`Delete "${tripData.name}"? This cannot be undone.`)) {
                trip.delete(tripId);
                router.push("/");
              }
            }}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      </main>
    </div>
  );
}
