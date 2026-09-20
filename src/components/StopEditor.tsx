"use client";

import { useState } from "react";
import { Check, ExternalLink, X, Loader2 } from "lucide-react";

import { useApp } from "@/lib/AppContext";
import { Reservation } from "@/lib/types";
import { requestReservationEdit } from "@/lib/editRequest";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { Draft, FIELDS, toDraft } from "@/components/TripReservations";

/*
 * Inline editor for a single map stop.
 *
 * A stop is a *view* of a reservation — a flight contributes two stops from one
 * booking — so editing here writes back to the reservation and lets the map
 * re-derive. There is no such thing as editing a stop independently of its
 * booking, and the UI should not imply otherwise.
 *
 * Only the fields that actually move a pin are shown: title and the one or two
 * locations. Times, confirmation numbers and costs stay in the full editor
 * (reachable via "Open full editor") because they do not affect the map, and a
 * cramped panel is not the place to edit a booking's whole record.
 *
 * `type` is deliberately not editable — changing a booking's category is a
 * delete-and-re-add, matching the reservations list.
 */

type Props = {
  reservation: Reservation;
  onClose: () => void;
};

export function StopEditor({ reservation: r, onClose }: Props) {
  const { reservation: api } = useApp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(r));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = FIELDS[draft.type];
  const dirty =
    draft.title !== r.title ||
    draft.location !== r.location ||
    draft.locationTo !== r.locationTo;
  const canSave = draft.title.trim().length > 0 && dirty && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Only send what this panel can change. Writing the whole draft back
      // would clobber any field edited elsewhere since this panel opened.
      await api.update(r.id, {
        title: draft.title.trim(),
        location: draft.location,
        locationTo: draft.locationTo,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-300/80">
          Edit stop
        </span>
        <Tooltip label="Close without saving">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close editor"
            className="grid h-6 w-6 place-items-center rounded text-zinc-500 transition-colors hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <Input
        value={draft.title}
        onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
        placeholder="Booking name"
        aria-label="Booking name"
      />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
            {f.fromLabel ?? "Location"}
          </label>
          <Input
            value={draft.location}
            onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))}
            placeholder="City, airport or address"
            aria-label={f.fromLabel ?? "Location"}
          />
        </div>
        {f.toLabel && (
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">
              {f.toLabel}
            </label>
            <Input
              value={draft.locationTo}
              onChange={(e) => setDraft((p) => ({ ...p, locationTo: e.target.value }))}
              placeholder="City, airport or address"
              aria-label={f.toLabel}
            />
          </div>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="gap-1.5"
          aria-label="Save stop"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </Button>
        <Tooltip label="Times, confirmation and cost live in the full booking editor">
          <button
            type="button"
            onClick={() => {
              requestReservationEdit(r.id);
              onClose();
            }}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-white/5 bg-white/[0.02]",
              "px-2.5 text-xs text-zinc-400 transition-colors hover:text-emerald-300"
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open full editor
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
