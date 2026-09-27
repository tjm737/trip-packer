"use client";

import { Printer } from "lucide-react";

/*
 * Opens the printable itinerary in a new tab.
 *
 * A new tab rather than a same-tab navigation: printing is a detour. Sending the
 * user to another page and making them come back would lose their place in the
 * tab, scroll position and any in-progress edit on the trip page.
 *
 * TWO VARIANTS
 *
 * "header" (default) is the original compact pill, kept because the shared-trip
 * page and the print preview both use this component and neither has a sidebar.
 *
 * "sidebar" is a full-width row for the sidebar's trip section. It exists as a
 * variant rather than a second component so the href, the tooltip and the
 * new-tab behaviour cannot drift between the two placements — the things that
 * actually matter here are identical, and only the box differs. The row grows to
 * fill the sidebar's width, which is the point of the move: the sidebar has room
 * the header did not.
 *
 * Colours are unchanged between variants on purpose. Print is emerald and
 * Calendar is sky in both, because that pairing is how these two are recognised
 * across the app; only the geometry responds to where they are drawn.
 */
export function PrintButton({
  tripId,
  variant = "header",
}: {
  tripId: string;
  variant?: "header" | "sidebar";
}) {
  const href = `/trips/${encodeURIComponent(tripId)}/print`;

  const className =
    variant === "sidebar"
      ? "inline-flex h-9 w-full shrink-0 items-center justify-start gap-2 rounded-md border border-emerald-500 bg-emerald-500/20 px-3 text-xs text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring"
      : "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-500/20 px-3 text-xs text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:h-8 sm:text-[11px]";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Print this itinerary"
      aria-label="Print this itinerary"
      className={className}
    >
      <Printer
        className={variant === "sidebar" ? "h-3.5 w-3.5" : "h-4 w-4 sm:h-3.5 sm:w-3.5"}
        strokeWidth={2}
      />
      <span>Print</span>
    </a>
  );
}
