"use client";

import { Printer } from "lucide-react";

/*
 * Opens the printable itinerary in a new tab.
 *
 * Mirrors ShareButton exactly — same pill shape, same tap-target sizing, same
 * tooltip treatment — because the two sit side by side in the trip header and
 * any difference in height or padding would read as a mistake.
 *
 * A new tab rather than a same-tab navigation: printing is a detour. Sending the
 * user to another page and making them come back would lose their place in the
 * tab, scroll position and any in-progress edit on the trip page.
 */
export function PrintButton({ tripId }: { tripId: string }) {
  const href = `/trips/${encodeURIComponent(tripId)}/print`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Print this itinerary"
      aria-label="Print this itinerary"
      className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-500/20 px-3 text-xs text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:h-8 sm:text-[11px]"
    >
      <Printer className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={2} />
      <span>Print</span>
    </a>
  );
}
