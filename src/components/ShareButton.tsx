"use client";

import { Share2 } from "lucide-react";

/*
 * The trip Share control.
 *
 * A labelled pill rather than a bare icon, matching the sage controls the app
 * already uses for "act on this trip" affordances (the Map and listing links in
 * TripReservations): solid emerald border, subtle emerald fill, emerald-300
 * text. A second, differently-styled button in the trip header would read as a
 * different kind of thing.
 *
 * The tap target is 44px high by default and relaxes to 32px from `sm` up.
 * 44px is the iOS minimum and this button is anchored in the trip header, so
 * it is one of the first things a thumb reaches for on a phone.
 *
 * `title` is present as a house rule: every button carries a tooltip, so a
 * hover (or a long-press on iOS) explains what the control does without the
 * user having to tap it first.
 */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Share this trip"
      aria-label="Share this trip"
      className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-500/20 px-3 text-xs text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:h-8 sm:text-[11px]"
    >
      <Share2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={2} />
      <span>Share</span>
    </button>
  );
}
