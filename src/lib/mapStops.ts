/*
 * Stop filtering for the map, extracted from TripMap.tsx so the behaviour is
 * testable without a DOM.
 *
 * This exists because the default state ("do not include draft itinerary items
 * on the map") is a product decision that is easy to reverse by accident: it is
 * one boolean, and nothing else in the app breaks when it flips. It would fail
 * silently -- the map would simply draw more pins -- so the default is pinned
 * in a test rather than left as a literal in a component.
 */

/// The minimum a stop needs for filtering. Structural rather than a named
/// import so this module does not depend on the component's larger Stop type.
export type FilterableStop = {
  type: string;
  confirmed: boolean;
};

/**
 * Whether draft (unconfirmed) stops are hidden when the screen first loads.
 *
 * TRUE means drafts are excluded by default. This is the product decision, and
 * it is deliberately the reverse of the app's original behaviour, which showed
 * them. The reasoning: the map answers "where am I actually going", and an
 * unbooked stop is somewhere you have not committed to yet. Drawing it on first
 * look overstates the trip and puts pins on the map that may never happen.
 *
 * Showing them stays one tap away.
 */
export const DRAFTS_HIDDEN_BY_DEFAULT = true;

/**
 * Applies the type filter and the draft filter to a stop list, renumbering what
 * survives.
 *
 * Renumbering happens on the filtered sequence, so the pin labelled 3 is the
 * third stop *visible* rather than the third stop of the full trip -- otherwise
 * hiding a category would leave gaps in the pin numbering.
 *
 * The early return preserves identity when nothing was filtered, which matters
 * because this feeds a useMemo: returning a fresh array every call would
 * invalidate every downstream memo and re-render the map on each parent render.
 */
export function filterStops<T extends FilterableStop>(
  stops: T[],
  hiddenTypes: ReadonlySet<string>,
  hiddenDrafts: boolean
): T[] {
  const filtered = stops.filter(
    (s) => !hiddenTypes.has(s.type) && !(hiddenDrafts && !s.confirmed)
  );
  if (filtered.length === stops.length) return stops;
  return filtered.map((s, i) => ({ ...s, index: i + 1 }));
}
