"use client";

/*
 * A one-slot handoff for "open this booking in the full editor".
 *
 * The map and the reservations list sit on different tabs of the trip page and
 * read the same records, but neither owns the other. Clicking "Edit" on a map
 * stop needs to reach the reservation editor, which may not even be mounted at
 * the time — the Itinerary tab is unmounted while the Map tab is showing.
 *
 * This is deliberately NOT in AppContext. AppContext is the app's data cache
 * and every field in it is persisted domain state; "which editor is currently
 * open" is transient view state that should never touch the API. Keeping it in
 * its own module also means the two components stay independent — the
 * reservations list does not need to know the map exists, only that something
 * may have asked it to open a particular row.
 *
 * Two kinds of subscriber, because the request has two halves:
 *
 *   - the page, which needs to switch to the tab that owns the editor, and
 *   - the reservations panel, which needs to actually open the row.
 *
 * The page's watcher must not consume the request or the panel would never see
 * it, so `observeEditRequests` is a non-consuming peek and only
 * `subscribeEditRequests` clears the slot.
 *
 * Usage:
 *   requestReservationEdit(id)          // from the map
 *   observeEditRequests(cb)             // in the page, to switch tabs
 *   subscribeEditRequests(cb)           // in the reservations list, to open
 */

let pending: string | null = null;
const openers = new Set<(id: string) => void>();
const observers = new Set<(id: string) => void>();

/** Ask the reservations panel to open its inline editor for `id`. */
export function requestReservationEdit(id: string): void {
  pending = id;
  // forEach, not for...of: the default TS target rejects iterating a Set.
  observers.forEach((fn) => fn(id));
  openers.forEach((fn) => fn(id));
}

/**
 * Watch every request without consuming it. Used by the page to switch to the
 * tab that holds the reservations panel before the panel gets a chance to open.
 */
export function observeEditRequests(fn: (id: string) => void): () => void {
  observers.add(fn);
  return () => {
    observers.delete(fn);
  };
}

/**
 * Consume a pending request, if any, and subscribe to future ones.
 *
 * Returns the id that was already waiting, so a request made while the panel
 * was unmounted (the map edited while a different tab was showing) is still
 * honoured rather than dropped.
 */
export function subscribeEditRequests(fn: (id: string) => void): () => void {
  openers.add(fn);
  if (pending) {
    const id = pending;
    pending = null;
    fn(id);
  }
  return () => {
    openers.delete(fn);
  };
}
