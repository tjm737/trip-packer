"use client";

/*
 * A one-slot handoff for "open this booking in the full editor".
 *
 * The map and the reservations list are siblings on the trip page and read the
 * same records, but neither owns the other. Clicking "Edit" on a map stop needs
 * to reach the reservation editor below, which is a different subtree.
 *
 * This is deliberately NOT in AppContext. AppContext is the app's data cache
 * and every field in it is persisted domain state; "which editor is currently
 * open" is transient view state that should never touch the API. Keeping it in
 * its own module also means the two components stay independent — the
 * reservations list does not need to know the map exists, only that something
 * may have asked it to open a particular row.
 *
 * Usage:
 *   requestReservationEdit(id)            // from the map
 *   useEditRequest(takeRequest)           // in the reservations list
 */

let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

/** Ask the reservations panel to open its inline editor for `id`. */
export function requestReservationEdit(id: string): void {
  pending = id;
  // forEach, not for...of: the default TS target rejects iterating a Set.
  listeners.forEach((fn) => fn(id));
}

/**
 * Consume a pending request, if any, and subscribe to future ones.
 *
 * Returns the id that was already waiting, so a request made while the panel
 * was unmounted (e.g. the map edited before the list scrolled into view) is
 * still honoured rather than dropped.
 */
export function subscribeEditRequests(fn: (id: string) => void): () => void {
  listeners.add(fn);
  if (pending) {
    const id = pending;
    pending = null;
    fn(id);
  }
  return () => {
    listeners.delete(fn);
  };
}
