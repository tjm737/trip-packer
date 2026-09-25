/**
 * Bag import: copying bags from a previous trip into a new one.
 *
 * Kept as pure functions separate from the React that drives it, for two
 * reasons. The repo has no DOM test infrastructure, so anything that lives in a
 * component is untestable here; and the interesting decisions -- what counts as
 * importable, how ids are remapped, what happens when the source trip is
 * deleted mid-dialog -- are all decidable without a renderer.
 *
 * The remapping is the part worth being careful about. Bags carry ids that are
 * referenced by items, so a copy that reuses the source ids would make the new
 * trip's bags collide with the old trip's in the same table, and two trips
 * would silently share bag rows. Every import therefore mints new ids.
 */

import type { AppState, Bag, BagKind, PackingItem } from "./types";

/** A trip a bag can be imported from: one the user owns or has access to. */
export type BagSourceTrip = {
  id: string;
  name: string;
  bagCount: number;
};

export const BAG_KIND_LABELS: Record<BagKind, string> = {
  checked: "Checked",
  carry_on: "Carry-on",
  personal: "Personal item",
  other: "Other",
};

export const BAG_KINDS: BagKind[] = ["carry_on", "checked", "personal", "other"];

/** Nothing to import, as a named value rather than a fresh {} each render. */
export const NO_IMPORT = { tripId: null, itemIds: null } as const;

export type BagImportSelection = {
  /** Source trip, or null for "no import". */
  tripId: string | null;
  /**
   * Which of that trip's items to bring along, by SOURCE item id. null means
   * every item already assigned to an imported bag.
   */
  itemIds: string[] | null;
};

/**
 * Trips the given state can offer as import sources, newest first, excluding
 * `excludeTripId` (the trip being created).
 *
 * Only trips that actually have bags are offered: an entry that would import
 * nothing is a dead option, and offering it invites the user to pick it and see
 * no effect.
 */
export function bagSourceTrips(
  state: Pick<AppState, "trips" | "bags">,
  excludeTripId: string | null = null
): BagSourceTrip[] {
  const counts = new Map<string, number>();
  for (const b of state.bags ?? []) {
    counts.set(b.tripId, (counts.get(b.tripId) ?? 0) + 1);
  }
  return (state.trips ?? [])
    .filter((t) => t.id !== excludeTripId)
    .map((t) => ({ id: t.id, name: t.name, bagCount: counts.get(t.id) ?? 0 }))
    .filter((t) => t.bagCount > 0);
}

/**
 * The items an import would carry, given a selection.
 *
 * Defined as "items already assigned to one of the source trip's bags" rather
 * than "all items in the trip". Importing a bag and then finding the entire
 * packing list duplicated is not what the user asked for when they asked to
 * import bags -- and the items are only meaningful in the new trip if they are
 * the contents of the bags being copied.
 */
export function bagImportCandidates(
  state: Pick<AppState, "bags" | "items">,
  selection: BagImportSelection
): PackingItem[] {
  if (!selection.tripId) return [];
  const bagIds = new Set(
    (state.bags ?? []).filter((b) => b.tripId === selection.tripId).map((b) => b.id)
  );
  const inBags = (state.items ?? []).filter(
    (i) => i.bagId !== null && i.bagId !== undefined && bagIds.has(i.bagId)
  );
  if (selection.itemIds === null) return inBags;
  // An explicit list is intersected with what is actually importable, so a stale
  // selection (the source trip changed since the checkbox was ticked) degrades
  // to the truth rather than importing something that no longer qualifies.
  const wanted = new Set(selection.itemIds);
  return inBags.filter((i) => wanted.has(i.id));
}

/** The shape the create path needs: bags and items ready to be persisted. */
export type BagImportPayload = {
  bags: Bag[];
  items: PackingItem[];
};

/**
 * Build the bags and items to create for a new trip.
 *
 * `newTripId` is where the copies land; ids for the copies come from `mintId`,
 * injected so this stays pure and the tests stay deterministic. Items are
 * remapped to the NEW bag ids, and an item whose bag is missing from the
 * selection is dropped rather than imported orphaned -- an item whose bag was
 * not copied would land in the new trip with a bagId pointing into another
 * trip, which is exactly the cross-trip reference the access layer has to
 * defend against.
 */
export function buildBagImport(
  state: Pick<AppState, "bags" | "items">,
  newTripId: string,
  selection: BagImportSelection,
  mintId: () => string,
  now: string
): BagImportPayload {
  if (!selection.tripId) return { bags: [], items: [] };

  const sourceBags = (state.bags ?? []).filter((b) => b.tripId === selection.tripId);
  const bagIdMap = new Map<string, string>();
  const bags: Bag[] = sourceBags.map((b) => {
    const id = mintId();
    bagIdMap.set(b.id, id);
    return {
      id,
      tripId: newTripId,
      name: b.name,
      kind: b.kind,
      // Tag numbers are the user's own identifier for a physical bag. Carrying
      // it over is the point of importing; a duplicate tag is theirs to fix.
      tagNumber: b.tagNumber,
      notes: b.notes,
      createdAt: now,
      updatedAt: now,
    };
  });

  const items: PackingItem[] = bagImportCandidates(state, selection)
    .map((i): PackingItem | null => {
      const newBagId = i.bagId ? bagIdMap.get(i.bagId) : null;
      if (!newBagId) return null;
      return {
        ...i,
        id: mintId(),
        tripId: newTripId,
        bagId: newBagId,
        // Contents arrive unpacked: a copy of last trip's list is a plan, not a
        // record of what is already in the case.
        checked: false,
      };
    })
    .filter((i): i is PackingItem => i !== null);

  return { bags, items };
}

/**
 * A one-line summary for the dialog, or null when nothing would be imported.
 *
 * Pluralisation is done here rather than in JSX because "1 bags" is the kind of
 * thing that survives to production when the string is assembled inline.
 */
export function bagImportSummary(
  state: Pick<AppState, "bags" | "items">,
  selection: BagImportSelection
): string | null {
  if (!selection.tripId) return null;
  const bagCount = (state.bags ?? []).filter((b) => b.tripId === selection.tripId).length;
  if (bagCount === 0) return null;
  const itemCount = bagImportCandidates(state, selection).length;
  const bagPart = `${bagCount} ${bagCount === 1 ? "bag" : "bags"}`;
  if (itemCount === 0) return bagPart;
  return `${bagPart}, ${itemCount} ${itemCount === 1 ? "item" : "items"}`;
}
