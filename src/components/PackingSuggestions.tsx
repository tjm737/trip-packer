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
import { checkAvailability, generateObject, type AvailabilityReport } from "@/lib/foundationModels";
import {
  activitiesFromReservations,
  addableRowCount,
  buildPackingPrompt,
  buildSuggestionRows,
  generateControlState,
  suggestionsAfterAdd,
  suggestionsFromResponse,
  suggestionsViewState,
  unavailableHint,
  type AddPayload,
  type PackingSuggestion,
} from "@/lib/packingSuggestions";
import { getReservationsForTrip } from "@/lib/storage";

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

  /**
   * Booked activities on this trip, in trip order.
   *
   * Reuses getReservationsForTrip so the itinerary tab and the model see the
   * same sequence -- if the user has hand-dragged the itinerary, that
   * deliberate order is what governs which activities survive the prompt cap.
   */
  const activities = useCallback(() => {
    return activitiesFromReservations(
      getReservationsForTrip(tripId, state.reservations ?? [])
    );
  }, [state.reservations, tripId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    try {
      const prompt = buildPackingPrompt(
        { destination, days, month, activities: activities() },
        existingNames()
      );
      const raw = await generateObject<Record<string, unknown>>(prompt, ["items"]);
      /*
       * null (the bridge's failure value) becomes [], the same "generated,
       * nothing usable" state as an empty reply. Both mean "show the empty
       * message", and neither is allowed to look like an unhandled error.
       */
      setSuggestions(suggestionsFromResponse(raw, existingNames()));
    } finally {
      setGenerating(false);
    }
  }, [destination, days, month, existingNames, activities]);

  /*
   * Add one suggestion. Deliberately per-item and click-driven: this is the
   * only path by which a suggestion reaches the packing list.
   */
  const addOne = useCallback(
    async (payload: AddPayload) => {
      /*
       * The row model already ran the click-time gate against the live list
       * when it was built, and handed over the trimmed name. This re-reads
       * `name` from the payload rather than re-trimming here, because the set
       * key and the name written to the list must be the same string -- if
       * they drifted, a row could keep a stale spinner or add a second item.
       */
      const name = payload.name;

      setAdding((prev) => new Set(prev).add(name));
      try {
        const categoryId = await helpers.findOrCreateCategory(
          tripId,
          payload.categoryName,
          payload.categoryIcon
        );
        await itemActions.create(
          payload.tripId,
          categoryId,
          name,
          payload.categoryIcon,
          payload.quantity
        );
      } finally {
        setAdding((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        // Drop it from the candidate list -- it is on the list now, and the
        // row would otherwise invite a second, duplicate add.
        setSuggestions((prev) => suggestionsAfterAdd(prev, name));
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

  const control = generateControlState(availability, generating, suggestions !== null);
  const view = suggestionsViewState(suggestions);

  /*
   * Rows are rebuilt from the live list on every render, so a row that has
   * just been added (here or in another tab) comes back non-actionable rather
   * than clickable-but-refused.
   *
   * `getItemsForCategoryAndName` is consulted by trimmed name because that is
   * what the gate keys on everywhere else.
   */
  const rows = buildSuggestionRows(
    suggestions ?? [],
    (name) => !!helpers.getItemsForCategoryAndName(tripId, CATEGORY_NAME, name),
    adding,
    tripId,
    CATEGORY_NAME,
    CATEGORY_ICON
  );
  const canAddAnything = addableRowCount(rows) > 0;

  return (
    <div className="py-2 px-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* The tooltip wraps a span, not the button, on purpose: a disabled
            <button> swallows pointer events, so Base UI's trigger never fires
            and the tooltip would silently never open -- exactly when the user
            most needs to know why the control is dead. */}
        <Tooltip
          label={
            control.enabled
              ? "Ask the on-device model for packing ideas — you choose what to add"
              : unavailableHint(availability)
          }
          side="top"
        >
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              disabled={!control.enabled}
              onClick={generate}
              className="text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 focus-ring disabled:opacity-50"
            >
              {control.generating ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1.5" />
              )}
              {control.label}
            </Button>
          </span>
        </Tooltip>

        {!control.enabled && (
          <span className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {unavailableHint(availability)}
          </span>
        )}
      </div>

      {/* Candidates. Each row is a button -- clicking it adds that one item and
          nothing else. */}
      {view === "list" && canAddAnything && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 mb-2">
            Suggestions — tap to add
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {rows.map((row) => {
              /*
               * A row whose name is unusable, already on the list, or mid-add
               * has no payload; rendering it as a live button would offer a
               * click that does nothing.
               */
              if (!row.payload) return null;
              const payload = row.payload;
              return (
                <button
                  key={row.name}
                  type="button"
                  disabled={row.adding}
                  onClick={() => addOne(payload)}
                  title={`Add "${payload.name}" to your packing list`}
                  className="flex items-start gap-2 p-2 rounded-lg border text-sm text-left bg-zinc-800/50 border-zinc-700/50 text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-600 focus-ring transition-all disabled:opacity-60"
                >
                  {row.adding ? (
                    <Loader2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400 flex-shrink-0 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 mt-0.5 text-zinc-500 flex-shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{payload.name}</span>
                    {row.reason && (
                      <span className="block text-[11px] text-zinc-500 leading-relaxed mt-0.5">
                        {row.reason}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === "empty" && (
        <p className="mt-3 text-xs text-zinc-500 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          Nothing new to suggest — everything it came up with is already on your list.
        </p>
      )}
    </div>
  );
}
