"use client";

/*
 * "Suggest items" for the packing list, backed by Apple's on-device model.
 *
 * Design contract, deliberate and load-bearing:
 *   - Nothing is ever added automatically. Generating fills a list of
 *     candidates; each one requires its own click to join the packing list.
 *   - When the model is unavailable (browser, older iPhone, Apple Intelligence
 *     off) the button explains why rather than sitting there doing nothing.
 *
 * Both properties are why this is a separate component: the availability check
 * and the click-to-add loop are the whole feature, and mixing them into the
 * already-long trip page would bury them.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Plus, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useApp } from "@/lib/AppContext";
import {
  checkAvailability,
  generateObject,
  type AvailabilityReport,
} from "@/lib/foundationModels";
import {
  addability,
  buildPackingPrompt,
  normalizeSuggestions,
  type PackingSuggestion,
} from "@/lib/packingSuggestions";

/** Category the generated items land in, created on first use. */
const CATEGORY_NAME = "Suggested";
const CATEGORY_ICON = "✨";

export function PackingSuggestions({
  tripId,
  destination,
  days,
  month,
}: {
  tripId: string;
  destination: string;
  days?: number;
  month?: number;
}) {
  const { state, helpers, item: itemActions } = useApp();

  const [availability, setAvailability] = useState<AvailabilityReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [generating, setGenerating] = useState(false);
  /* null = never generated; [] = generated but nothing usable came back. The
     distinction drives which empty message to show. */
  const [suggestions, setSuggestions] = useState<PackingSuggestion[] | null>(null);
  /* Names currently being written, so a row can show a spinner and the button
     can't be double-clicked into two identical items. */
  const [adding, setAdding] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    checkAvailability()
      .then((report) => {
        if (!cancelled) setAvailability(report);
      })
      .catch(() => {
        if (!cancelled) {
          setAvailability({
            available: false,
            reason: "unknown",
            message: "",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Every item name already on this trip, for the model to avoid. */
  const existingNames = useCallback(() => {
    return state.items
      .filter((i) => i.tripId === tripId)
      .map((i) => i.name)
      .filter(Boolean);
  }, [state.items, tripId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const prompt = buildPackingPrompt(
        { destination, days, month },
        existingNames()
      );
      const raw = await generateObject<Record<string, unknown>>(prompt, ["items"]);
      setSuggestions(normalizeSuggestions(raw, existingNames()));
    } finally {
      setGenerating(false);
    }
  }, [destination, days, month, existingNames]);

  /*
   * Add one suggestion. Deliberately per-item and click-driven: this is the
   * only path by which a suggestion reaches the packing list.
   */
  const addOne = useCallback(
    async (suggestion: PackingSuggestion) => {
      const name = suggestion.name.trim();

      // Re-check at click time: the list may have gained this item since the
      // suggestions were generated (another tab, or an earlier click).
      const existingItem = helpers.getItemsForCategoryAndName(tripId, CATEGORY_NAME, name);
      if (addability(name, !!existingItem) !== "ok") return;

      setAdding((prev) => new Set(prev).add(name));
      try {
        const categoryId = await helpers.findOrCreateCategory(
          tripId,
          CATEGORY_NAME,
          CATEGORY_ICON
        );
        await itemActions.create(tripId, categoryId, name, CATEGORY_ICON, 1);
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        // Drop it from the candidate list -- it is on the list now, and the
        // row would otherwise invite a second, duplicate add.
        setSuggestions((prev) => (prev ? prev.filter((s) => s.name !== name) : prev));
      }
    },
    [helpers, itemActions, tripId]
  );

  if (checking) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 py-2 px-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking for on-device suggestions…
      </div>
    );
  }

  const available = availability?.available === true;

  return (
    <div className="py-2 px-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* The tooltip wraps a span, not the button, on purpose: a disabled
            <button> swallows pointer events, so Base UI's trigger never fires
            and the tooltip would silently never open -- exactly when the user
            most needs to know why the control is dead. */}
        <Tooltip
          label={
            available
              ? "Ask the on-device model for packing ideas — you choose what to add"
              : unavailableHint(availability)
          }
          side="top"
        >
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              disabled={!available || generating}
              onClick={generate}
              className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 focus-ring disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1.5" />
              )}
              {generating ? "Thinking…" : suggestions ? "Suggest again" : "Suggest items"}
            </Button>
          </span>
        </Tooltip>

        {!available && (
          <span className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {unavailableHint(availability)}
          </span>
        )}
      </div>

      {/* Candidates. Each row is a button -- clicking it adds that one item and
          nothing else. */}
      {suggestions !== null && suggestions.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 mb-2">
            Suggestions — tap to add
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {suggestions.map((s) => {
              const isAdding = adding.has(s.name);
              return (
                <button
                  key={s.name}
                  type="button"
                  disabled={isAdding}
                  onClick={() => addOne(s)}
                  title={`Add "${s.name}" to your packing list`}
                  className="flex items-start gap-2 p-2 rounded-lg border text-sm text-left bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-600 focus-ring transition-all disabled:opacity-60"
                >
                  {isAdding ? (
                    <Loader2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 flex-shrink-0 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 mt-0.5 text-zinc-500 flex-shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{s.name}</span>
                    {s.reason && (
                      <span className="block text-[11px] text-zinc-500 leading-relaxed mt-0.5">
                        {s.reason}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {suggestions !== null && suggestions.length === 0 && (
        <p className="mt-3 text-xs text-zinc-500 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          Nothing new to suggest — everything it came up with is already on your list.
        </p>
      )}
    </div>
  );
}

/** Plain-language reason the feature is off, for the tooltip and inline note. */
function unavailableHint(report: AvailabilityReport | null): string {
  if (!report) return "Checking device support…";
  if (report.available) return "";
  /* The plugin already sends a user-safe `message`; prefer it so the wording
     lives in one place. The switch is the fallback for the reasons that can
     arrive with an empty message. */
  if (report.message) return report.message;
  switch (report.reason) {
    case "os_too_old":
      return "Packing suggestions need a newer version of iOS.";
    case "device_not_eligible":
      return "This device doesn't support on-device Apple Intelligence.";
    case "not_enabled":
      return "Turn on Apple Intelligence in Settings to use packing suggestions.";
    case "model_not_ready":
      return "The on-device model is still getting ready — try again shortly.";
    default:
      return "On-device suggestions aren't available right now.";
  }
}
