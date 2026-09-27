/**
 * Bag claim document.
 *
 * Turns a bag and its contents into the structure a claim form needs: the bag's
 * identifying details, its contents grouped by category, and honest totals.
 * Pure functions only -- no React, no database -- so the awkward cases (an item
 * whose category was deleted, a dangling bagId, a bag with no contents) are
 * testable directly rather than through a rendered page.
 *
 * WHY THIS EXISTS
 * A bag goes missing at the carousel. The airline wants a list of what was in
 * it, and the traveller has to produce one from memory, under pressure, at an
 * airport. That list is the whole point of the feature: the bag's contents are
 * already recorded here, so the document is assembling what the user already
 * has rather than asking them to reconstruct it.
 *
 * SCOPE: contents only. The backlog entry for this (#7) also floated photos of
 * contents, and that was deliberately deferred pending a concrete airline
 * requirement -- an airline either wants photos or it does not, and guessing
 * costs a camera permission and a storage story. The document leaves room for
 * them (see CLAIM_DISCLAIMER) without pretending to have them.
 */

import type { Bag, Category, PackingItem, Trip } from "./types";

/*
 * What an airline claim form is expected to capture, and what this document
 * deliberately does NOT:
 *
 *  - Valuations. No price is stored per item, and inventing one would be worse
 *    than leaving the column blank for the traveller to fill in by hand.
 *  - Photos. Deferred, per above.
 *  - Receipts. Same.
 *
 * Saying so on the document is not boilerplate. A claim packet that looks
 * complete but silently omits the amount claimed invites it being filed as-is
 * and rejected later.
 */
export const CLAIM_DISCLAIMER =
  "This list was produced from the traveller's packing list. It records what " +
  "was in the bag, not what it was worth. Item values, receipts and photographs " +
  "are not included and should be attached separately.";

/** A line on the claim sheet: one item, with the category it belongs to. */
export type ClaimLine = {
  id: string;
  name: string;
  quantity: number;
  /** Resolved category name, or null when the item's category is unknown. */
  categoryName: string | null;
  /** The item's own ordering integer, used only for sorting. */
  order: number;
};

/** A category's worth of lines, in display order. */
export type ClaimSection = {
  /** Category name, or null for items whose category no longer resolves. */
  categoryName: string | null;
  lines: ClaimLine[];
  /** Sum of quantities, not a count of lines. */
  itemCount: number;
};

export type ClaimDocument = {
  bag: {
    name: string;
    kindLabel: string;
    /** Empty string when unset -- the page decides whether to show a blank. */
    tagNumber: string;
    notes: string;
  };
  trip: {
    name: string;
    destination: string;
    /** ISO date, unformatted; the view formats it. */
    startDate: string;
    endDate: string;
  };
  sections: ClaimSection[];
  /** Total pieces across every section, i.e. the sum of quantities. */
  totalItems: number;
  /** Distinct items, which is what "N items" reads as to most people. */
  totalLines: number;
  /** Included so the page can render the caveat without importing it twice. */
  disclaimer: string;
};

/**
 * Resolve a bag's kind to its label.
 *
 * Takes the label map rather than importing BAG_KIND_LABELS directly, so the
 * caller's single source of truth (types.ts) is the one used, and this module
 * stays free of that dependency for testing.
 *
 * An unrecognised kind is passed through verbatim rather than replaced with a
 * generic label: a stored kind outside the union is a bug, and showing the raw
 * value is how anyone finds out. The DB CHECK constraint makes it unlikely, but
 * this is the read path for already-stored rows.
 */
export function bagKindLabel(
  kind: string,
  labels: Record<string, string>
): string {
  return labels[kind] ?? kind;
}

/**
 * Build the claim document.
 *
 * ORDERING is fully determined, because a claim form is compared against a
 * physical bag by a stranger:
 *  - sections follow the category's own `order`, then name, so the sheet
 *    matches the order the user sees in the app;
 *  - items follow their `order`, then name, for the same reason.
 * Two runs over the same data must produce the same sheet, so nothing here
 * depends on Map iteration order or on the input array's order.
 *
 * UNKNOWN CATEGORIES are grouped into a single trailing section rather than
 * dropped. Note that the app's connection sets `PRAGMA foreign_keys = ON`
 * (db.ts:52), and items.categoryId references categories(id), so a dangling id
 * is not reachable through the normal write path -- this branch is defensive
 * depth rather than a live scenario. It is kept because the FK is a per-
 * connection pragma: a snapshot restored into a connection without it, or a
 * future schema change that drops the constraint, would make it reachable, and
 * silently omitting an item would understate a claim -- the one error that
 * costs the user money. Sorted last so it reads as an appendix.
 */
export function buildClaimDocument(
  trip: Pick<Trip, "name" | "destination" | "startDate" | "endDate">,
  bag: Pick<Bag, "name" | "kind" | "tagNumber" | "notes">,
  items: readonly PackingItem[],
  categories: readonly Category[],
  kindLabels: Record<string, string>
): ClaimDocument {
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  /*
   * Only items actually in this bag. A dangling bagId cannot reach here (the
   * caller filters by the bag it resolved), but an item with no bagId is
   * explicitly not part of any bag's contents.
   */
  const lines: ClaimLine[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    categoryName: categoryById.get(i.categoryId)?.name ?? null,
    order: i.order,
  }));

  /*
   * Group by category name rather than by id. Two categories may legitimately
   * share a name, and a claim sheet reads by name; grouping by id would emit
   * two sections both headed "Clothing".
   */
  const byCategory = new Map<string | null, ClaimLine[]>();
  for (const line of lines) {
    const bucket = byCategory.get(line.categoryName);
    if (bucket) bucket.push(line);
    else byCategory.set(line.categoryName, [line]);
  }

  const categoryOrderByName = new Map(categories.map((c) => [c.name, c.order]));

  const sections: ClaimSection[] = [];
  for (const [categoryName, sectionLines] of byCategory) {
    const sorted = [...sectionLines].sort(compareLines);
    sections.push({
      categoryName,
      lines: sorted,
      itemCount: sorted.reduce((n, l) => n + l.quantity, 0),
    });
  }

  /*
   * Known categories first, in their configured order; the unknown group always
   * last regardless of where its name would sort, so it reads as an appendix.
   */
  sections.sort((a, b) => {
    if (a.categoryName === null) return b.categoryName === null ? 0 : 1;
    if (b.categoryName === null) return -1;
    const ao = categoryOrderByName.get(a.categoryName) ?? Number.MAX_SAFE_INTEGER;
    const bo = categoryOrderByName.get(b.categoryName) ?? Number.MAX_SAFE_INTEGER;
    return ao - bo || a.categoryName.localeCompare(b.categoryName);
  });

  return {
    bag: {
      name: bag.name,
      kindLabel: bagKindLabel(bag.kind, kindLabels),
      tagNumber: bag.tagNumber ?? "",
      notes: bag.notes ?? "",
    },
    trip: {
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
    },
    sections,
    totalItems: sections.reduce((n, s) => n + s.itemCount, 0),
    totalLines: sections.reduce((n, s) => n + s.lines.length, 0),
    disclaimer: CLAIM_DISCLAIMER,
  };
}

/**
 * Items in the order the packing list shows them.
 *
 * `order` first, then name. The name tiebreak matters because order is a
 * client-assigned integer and two items can share one; without it the sheet's
 * order would depend on array position and could differ between two reads of
 * the same bag.
 */
function compareLines(a: ClaimLine, b: ClaimLine): number {
  return a.order - b.order || a.name.localeCompare(b.name);
}
