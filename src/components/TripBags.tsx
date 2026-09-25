"use client";

import { useState } from "react";
import { useApp } from "@/lib/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Luggage, Pencil, Plus, Trash2 } from "lucide-react";

/**
 * Bag kinds, with the weight limit an airline claim would care about.
 *
 * Kept here rather than in types.ts because the limits are a presentation
 * affordance -- they are shown next to the kind and never enforced. A hard
 * limit would be wrong: cabin allowances vary by carrier and fare, so a number
 * that blocks the user would be confidently incorrect more often than helpful.
 */
const BAG_KINDS = [
  { value: "carry-on", label: "Carry-on", hint: "Typically 22 x 14 x 9 in" },
  { value: "checked", label: "Checked", hint: "Typically 50 lb / 23 kg" },
  { value: "personal", label: "Personal item", hint: "Fits under the seat" },
  { value: "other", label: "Other", hint: "Gear, stroller, sports bag" },
] as const;

function kindLabel(kind: string): string {
  return BAG_KINDS.find((k) => k.value === kind)?.label ?? "Other";
}

/**
 * Bag manager for a trip.
 *
 * Bags are per-trip containers for packing items. Deleting one never deletes its
 * contents -- the items return to unassigned, because an item's existence should
 * not depend on the container it happened to be filed under. That is the
 * opposite of category deletion, which does cascade, and the asymmetry is
 * deliberate: a category IS the item's identity, a bag is just where it goes.
 */
export function TripBags({ tripId }: { tripId: string }) {
  const { bag: bagActions, state } = useApp();
  const bags = (state.bags ?? []).filter((b) => b.tripId === tripId);
  const items = state.items;

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<string>("carry-on");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const itemCount = (bagId: string) => items.filter((i) => i.bagId === bagId).length;

  const openRename = (id: string, current: string) => {
    setRenameDraft(current);
    setEditingId(id);
  };

  const submitRename = async () => {
    const v = renameDraft.trim();
    if (!v || !editingId) return;
    await bagActions.update(editingId, { name: v });
    setEditingId(null);
  };

  const submitNew = async () => {
    if (!draftName.trim()) return;
    await bagActions.create(tripId, draftName.trim(), draftKind as never);
    setDraftName("");
    setDraftKind("carry-on");
    setAdding(false);
  };

  return (
    <div className="mb-6 rounded-xl border border-zinc-800 surface-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-zinc-300 flex items-center gap-1.5">
          <Luggage className="w-3.5 h-3.5 text-zinc-500" />
          Bags
          {bags.length > 0 && (
            <Badge variant="secondary" className="ml-1 bg-zinc-800 text-zinc-400 text-[10px]">
              {bags.length}
            </Badge>
          )}
        </span>
        <Tooltip label="Add a bag" side="left">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Add a bag"
            className="w-6 h-6 text-zinc-500 hover:text-zinc-200 focus-ring"
            onClick={() => setAdding(true)}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </div>

      {bags.length === 0 && !adding && (
        <p className="text-xs text-zinc-500 leading-relaxed">
          No bags yet. Add one to sort your packing list by what goes where — handy
          for splitting a trip across carry-on and checked, and for knowing exactly
          what was in a bag if it goes missing.
        </p>
      )}

      <div className="space-y-1.5">
        {bags.map((b) => {
          const count = itemCount(b.id);
          return (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-lg bg-zinc-800/50 px-3 py-2"
            >
              <Luggage className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-zinc-200 block truncate">{b.name}</span>
                <span className="text-[11px] text-zinc-500">
                  {kindLabel(b.kind)} · {count} {count === 1 ? "item" : "items"}
                </span>
              </div>
              <Tooltip label="Rename" side="top">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Rename ${b.name}`}
                  className="w-6 h-6 text-zinc-500 hover:text-zinc-300 focus-ring"
                  onClick={() => openRename(b.id, b.name)}
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              </Tooltip>
              <Tooltip
                label={
                  count > 0
                    ? `Delete bag — ${count} item${count === 1 ? "" : "s"} stay in the list`
                    : "Delete bag"
                }
                side="top"
              >
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${b.name}`}
                  className="w-6 h-6 text-zinc-500 hover:text-red-400 focus-ring"
                  onClick={() => bagActions.delete(b.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </Tooltip>
            </div>
          );
        })}
      </div>

      {/* Add form */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="bg-zinc-900 border-zinc-800 sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-white">Add a Bag</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Name it and pick a type.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="bag-name" className="text-zinc-300">
                Name
              </Label>
              <Input
                id="bag-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitNew()}
                placeholder="e.g. Blue Away carry-on"
                autoFocus
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300">Type</Label>
              <Select value={draftKind} onValueChange={(v) => setDraftKind(v ?? "carry-on")}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {BAG_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value} className="text-zinc-200">
                      <span className="flex items-center gap-2">
                        {k.label}
                        <span className="text-[11px] text-zinc-500">{k.hint}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setAdding(false)}
              className="text-zinc-400"
            >
              Cancel
            </Button>
            <Button
              onClick={submitNew}
              disabled={!draftName.trim()}
              className="bg-primary hover:bg-emerald-700 text-white"
            >
              Add Bag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename form, mirroring the trip rename dialog idiom. */}
      <Dialog open={editingId !== null} onOpenChange={(v) => !v && setEditingId(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-white">Rename Bag</DialogTitle>
          </DialogHeader>
          <Input
            id="bag-rename"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            autoFocus
            className="bg-zinc-800 border-zinc-700 text-white"
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditingId(null)}
              className="text-zinc-400"
            >
              Cancel
            </Button>
            <Button
              onClick={submitRename}
              disabled={!renameDraft.trim()}
              className="bg-primary hover:bg-emerald-700 text-white"
            >
              <Check className="w-4 h-4 mr-2" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
