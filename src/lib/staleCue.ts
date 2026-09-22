"use client";

/*
 * How stale is a cached itinerary?
 *
 * The problem this solves: offline, a cached trip page is byte-identical to a
 * live one. A departure time read from cache looks exactly like a departure
 * time read from the server, so a traveller at an airport has no way to tell
 * whether the flight time in front of them is current or was captured three
 * days ago. On a travel app a confidently wrong departure time is worse than
 * an obvious error, because the failure is silent and the consequence is a
 * missed flight.
 *
 * The service worker already records when each trip page was cached; this
 * module turns that timestamp into something a human can act on. It is kept
 * free of React and of the worker so it can be tested directly.
 */

/**
 * A timestamp older than this reads as "days ago" rather than a clock time.
 *
 * Six hours is chosen because it is shorter than a sleep and longer than a
 * flight: an itinerary refreshed this morning is still plausibly current for a
 * same-day trip, while one from yesterday is not, even though both are "a day
 * old" by date arithmetic.
 */
const RELATIVE_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/**
 * Format the age of a cached copy for display.
 *
 * Deliberately absolute-and-relative rather than a bare clock time: "saved
 * 3:40 PM" is ambiguous the moment the day rolls over, which is precisely the
 * case that matters. Callers should prefer `describeSavedAt(...).short` inside
 * a sentence and `.full` for a title/tooltip.
 *
 * Returns null for an unusable input so callers can render nothing rather than
 * "Invalid Date". A missing stamp is a normal state (a trip never opened
 * online), not an error to surface.
 */
export function describeSavedAt(
  savedAt: string | null | undefined,
  now: Date = new Date()
): { short: string; full: string; isStale: boolean } | null {
  if (!savedAt) return null;

  const then = new Date(savedAt);
  if (Number.isNaN(then.getTime())) return null;

  const ageMs = now.getTime() - then.getTime();

  /*
   * A future stamp means the device clock moved backwards, or the stamp was
   * written by a device whose clock is ahead. Either way it is not a staleness
   * signal, and rendering "saved in 3 hours" would be nonsense. Treat the copy
   * as current rather than alarming the user about a clock they cannot fix.
   */
  if (ageMs < 0) {
    return { short: "just now", full: `Saved ${formatClock(then)}`, isStale: false };
  }

  const short = formatAge(ageMs);
  return {
    short,
    full: `Saved ${formatClock(then)} — ${short} ago`,
    isStale: ageMs > RELATIVE_THRESHOLD_MS,
  };
}

/**
 * Age in the coarsest unit that is still useful.
 *
 * "Under a minute" is bounded deliberately: clocks are not synchronised, so a
 * copy saved 20 seconds ago on a device whose clock is a minute slow would
 * otherwise read as saved in the future. Sub-minute is "just now", full stop.
 */
function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day" : `${days} days`;
}

function formatClock(d: Date): string {
  try {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    // A locale that throws must not take the banner down with it.
    return d.toISOString();
  }
}
