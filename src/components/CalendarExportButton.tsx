"use client";

import { CalendarPlus } from "lucide-react";

import { track } from "@/lib/track";

/*
 * Downloads the trip itinerary as an .ics file.
 *
 * Mirrors PrintButton — the two sit side by side in the trip header, so the
 * pill shape, tap-target sizing and tooltip treatment have to match exactly or
 * the difference reads as a mistake.
 *
 * A plain anchor, not a fetch-and-blob. The route sets
 * `Content-Disposition: attachment`, so the browser downloads it natively,
 * which means:
 *
 *   - no JavaScript is needed at the moment of download, so it still works if
 *     the bundle has not hydrated yet or the app is offline-in-shell;
 *   - on iOS and Android the download is handed to the OS, which offers the
 *     "Add to Calendar" flow — a blob URL would instead be intercepted by
 *     Capacitor and behave inconsistently across the three platforms;
 *   - the browser's own download UI provides the progress and failure
 *     feedback, which is more trustworthy than a spinner we draw ourselves.
 *
 * `download` is deliberately omitted: on some browsers it suppresses the
 * filename the server sent and substitutes the URL's last segment, which here
 * would be "calendar.ics" rather than the trip's name.
 */
export function CalendarExportButton({ tripId }: { tripId: string }) {
  const href = `/api/trips/${encodeURIComponent(tripId)}/calendar.ics`;

  return (
    <a
      href={href}
      onClick={() => track("calendar_exported")}
      title="Download this itinerary as a calendar file"
      aria-label="Download this itinerary as a calendar file"
      className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-sky-500 bg-sky-500/20 px-3 text-xs text-sky-300 transition-colors hover:border-sky-400 hover:bg-sky-500/30 hover:text-sky-200 focus-ring sm:h-8 sm:text-[11px]"
    >
      <CalendarPlus className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={2} />
      <span>Calendar</span>
    </a>
  );
}
