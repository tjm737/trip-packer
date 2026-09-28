"use client";

/*
 * On-device trip conflict check.
 *
 * WHAT IT IS
 * ----------
 * A card on the Itinerary tab that reviews the trip's bookings and surfaces
 * things that do not add up -- two reservations at once, a stay that does not
 * cover the night you land, a day that is implausible. Runs entirely on device
 * through Apple's Foundation Models; nothing is uploaded.
 *
 * WHY IT IS SHAPED THIS WAY
 * -------------------------
 * Findings are advisory, never corrective. The card says "worth a look" and
 * never "fix this", because a trip plan is a plan and not a constraint system:
 * a late dinner before an early flight is a choice a traveller is entitled to
 * make, and an app that calls it an error is wrong about their own holiday.
 *
 * Nothing here can be acted on destructively -- there is no "apply" or "fix"
 * button -- so a model that over-reports costs the reader a few seconds rather
 * than changing their data. That is the property that makes model-driven
 * checking safe to ship. The filtering in tripConflicts.ts is the other half:
 * a finding about a reservation or date that does not exist never renders.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, AlertTriangle, Info, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useApp } from "@/lib/AppContext";
import { checkAvailability, generateObject, type AvailabilityReport } from "@/lib/foundationModels";
import {
  checkTripConflicts,
  conflictControlState,
  conflictsViewState,
  type Conflict,
} from "@/lib/tripConflicts";
import { getReservationsForTrip } from "@/lib/storage";
import type { Trip } from "@/lib/types";

/** The field list handed to the plugin so it returns the shape we expect. */
const FIELDS = ["conflicts"];

export function TripConflicts({ tripId }: { tripId: string }) {
  const { state } = useApp();

  const [availability, setAvailability] = useState<AvailabilityReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  /* null = never run; [] = run and clean. The distinction is what stops this
     card from claiming a trip is fine before anyone has looked. */
  const [findings, setFindings] = useState<Conflict[] | null>(null);

  const reservations = getReservationsForTrip(tripId, state.reservations);

  useEffect(() => {
    let cancelled = false;
    checkAvailability()
      .then((report) => {
        if (!cancelled) setAvailability(report);
      })
      .catch(() => {
        if (!cancelled) setAvailability({ available: false, reason: "unknown", message: "" });
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Findings describe a specific set of reservations, so editing the trip
  // invalidates them. Dropping back to idle -- rather than leaving the old
  // results up -- prevents advice about bookings that no longer exist from
  // being read as advice about the current trip.
  const reservationCount = reservations.length;
  const trip = state.trips.find((t) => t.id === tripId);
  const tripName = trip?.name ?? "Trip";
  useEffect(() => {
    setFindings(null);
  }, [reservationCount, tripId]);

  const control = conflictControlState(
    availability?.available === true,
    running,
    findings !== null,
    reservationCount,
    availability
  );

  const run = useCallback(async () => {
    setRunning(true);
    try {
      /*
       * checkTripConflicts reads the trip's own bookings out of the full list,
       * so the prompt is built from exactly what this card is displaying. Only
       * the name is needed here; the reservations are looked up internally by
       * trip id, which is what keeps the prompt and the rendered list in step.
       */
      const { findings: result } = checkTripConflicts(
        { id: tripId, name: tripName } as Trip,
        state.reservations,
        (prompt) => generateObject<Record<string, unknown>>(prompt, FIELDS)
      );
      setFindings(await result);
    } finally {
      setRunning(false);
    }
  }, [tripId, tripName, state.reservations]);

  const view = conflictsViewState(findings);

  return (
    <div className="p-4 rounded-xl border border-zinc-800 surface-raised">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-200">Check for conflicts</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {control.hint || "Review these bookings for clashes, gaps and impossible days."}
            </p>
          </div>
        </div>

        {control.enabled ? (
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-700 text-zinc-300 shrink-0 focus-ring"
            onClick={run}
            disabled={running}
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : findings !== null ? (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            )}
            {control.label}
          </Button>
        ) : (
          <Tooltip label={control.hint} side="left">
            <span>
              <Button
                size="sm"
                variant="outline"
                className="border-zinc-800 text-zinc-600 shrink-0 cursor-not-allowed"
                disabled
              >
                {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                {control.label}
              </Button>
            </span>
          </Tooltip>
        )}
      </div>

      {view === "clean" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
          <p className="text-xs text-emerald-200/90">
            Nothing obviously out of place in these bookings.
          </p>
        </div>
      )}

      {view === "list" && findings && (
        <ul className="mt-3 space-y-2">
          {findings.map((f, i) => (
            <li
              key={`${f.reservationIds.join("-")}-${i}`}
              className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
            >
              {f.severity === "warning" ? (
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              ) : (
                <Info className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200">{f.title}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{f.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === "list" && (
        <p className="mt-2 text-[11px] text-zinc-600">
          These are suggestions, not rules — your trip may be exactly as intended.
        </p>
      )}
    </div>
  );
}
