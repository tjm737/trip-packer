"use client";

import { AlertTriangle } from "lucide-react";
import { describeSavedAt } from "@/lib/staleCue";

/*
 * Tells the user that the itinerary in front of them came from cache.
 *
 * Why this exists: a cached trip page is byte-identical to a live one, so
 * offline the app was previously lying by omission. Someone at an airport
 * reads a departure time, and nothing distinguishes "current" from "captured
 * three days ago". On a travel app that is the worst possible failure, because
 * it is silent and the consequence is a missed flight.
 *
 * It renders ONLY when both halves of the evidence are present: the device
 * reports offline AND the page actually came from the cache (the worker
 * returned a saved-at time). Either alone is not enough to make a claim —
 * an offline device showing a live page has nothing stale to warn about, and
 * a cached copy read while online is superseded by the network anyway.
 *
 * When offline but never cached there is no timestamp, so there is nothing to
 * say about staleness and this stays silent; the offline notice page handles
 * that case.
 */
export function StaleItineraryNotice({
  savedAt,
  offline,
}: {
  savedAt: string | null;
  offline: boolean;
}) {
  const age = describeSavedAt(savedAt);
  if (!offline || !age) return null;

  return (
    <div
      role="status"
      /*
       * role="status" rather than "alert": this is ambient context, not a
       * reaction to something the user just did, and a screen reader
       * interrupting mid-sentence would be worse than the warning is good.
       * The same amber treatment as the unresolved-location notice, since it
       * is the same class of message: the data you are reading may be wrong.
       */
      className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-300/90"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        You’re offline, so this is a saved copy. Flight times and details may have
        changed since it was saved
        <span title={age.full} className="text-amber-200">
          {" "}
          {age.short} ago
        </span>
        . Check with your airline before relying on it.
      </div>
    </div>
  );
}
