import { Reservation } from "@/lib/types";

/**
 * Sequencing for the itinerary and the map route.
 *
 * Extracted from TripMap.tsx so the ordering can be exercised directly. It was
 * living inline, which meant every rule below was only reachable through a
 * React component that imports Leaflet's CSS and cannot load under plain Node —
 * so the one piece of logic most likely to be wrong silently was also the one
 * piece with no test. It is pure: a list of reservations in, a list out, no
 * network, no clock, no DOM.
 */

/**
 * Order reservations for the map: date order, adjusted by any manual drags.
 *
 * The base sequence is by date (undated last), because a booking's date is the
 * whole point and a record still missing one should never push a confirmed
 * flight down the route. On top of that base, a ranking says where the user has
 * dragged each booking.
 *
 * The ranking is applied as a stable adjustment over the date-sorted list, not
 * as a wholesale re-sort. That distinction is what makes a drag do what it looks
 * like it does: dragging the 9th row to the top gives that row rank 0 while
 * everyone else keeps their existing value, so the dragged booking moves and the
 * rest stay put relative to each other.
 *
 * The consequence is deliberate: a dragged booking can sit above one that is
 * chronologically earlier, so the list and the route may not read in date order.
 * That is the price of "grab a row, drop it, it stays there", and the drag is
 * the only way to express a position the dates disagree with.
 *
 * `ranks` lets a drag supply live positions before they are persisted; omitted,
 * each reservation's stored `order` is used.
 */
export function inItineraryOrder(
  res: Reservation[],
  opts: { includeUnmapped?: boolean; ranks?: Map<string, number> } = {}
): Reservation[] {
  /*
   * Whether this row carries a manual position.
   *
   * A live rank from an in-progress drag counts, and so does a stored
   * `orderManual`. A row with neither has never been dragged: its `order` is
   * just an insertion counter and must not be allowed to compete with rows the
   * user actually placed.
   *
   * This is the bug that drew a road from London to Munich. `order` is
   * NOT NULL DEFAULT 0 and every insert assigns MAX+1, so treating a stored
   * `order` as a manual position marked *every* row as dragged and let the
   * importer's file order — car and hotel before the flight — decide the route.
   */
  const isManual = (r: Reservation) =>
    opts.ranks?.has(r.id) || r.orderManual !== null;

  const rankOf = (r: Reservation, i: number) => {
    const live = opts.ranks?.get(r.id);
    if (Number.isFinite(live)) return live as number;
    return Number.isFinite(r.order) ? (r.order as number) : i;
  };

  const items = res
    .map((r, i) => ({ r, rank: rankOf(r, i), touched: isManual(r) }))
    .filter(({ r }) => opts.includeUnmapped || r.startDate || r.location);

  /*
   * Two passes. The first sorts by date alone, which is the arrangement a user
   * who has never dragged anything should see. The second lifts out the rows
   * carrying a manual position and re-inserts them at it.
   *
   * Within a single date, a reservation that carries a TIME is ordered before
   * one that does not. An untimed booking makes no claim about when it happens
   * — it is pinned to the day and nothing finer — so it cannot be said to
   * precede a departure that has a specific clock time. Letting the empty
   * string sort first (the old behaviour) made it do exactly that, because ""
   * compares below every "HH:MM".
   *
   * That inversion is what produced a road line from London to Munich on a
   * trip with a flight between them. Waking up on 13 Oct, the map saw the
   * untimed car hire and hotel sorted ahead of the 15:10 LHR->MUC departure and
   * faithfully drew a drive: it had been told you collect a car in Munich
   * before the flight that takes you to Munich.
   *
   * Ordering timed-first is the narrow fix. It does not reorder across dates,
   * and it is stable among the untimed rows, which keep their existing `order`
   * relative to each other. A user who wants a different same-day sequence
   * still says so by dragging, which is applied below and wins over this.
   */
  const byDate = [...items].sort((a, b) => {
    const aD = a.r.startDate || "";
    const bD = b.r.startDate || "";
    if (aD && bD && aD !== bD) return aD.localeCompare(bD);
    if (aD && !bD) return -1;
    if (!aD && bD) return 1;
    const aT = a.r.startTime || "";
    const bT = b.r.startTime || "";
    // Same date: a real time outranks the absence of one. (`!!aT !== !!bT`
    // catches exactly one side being empty; equal emptiness falls through.)
    if (!!aT !== !!bT) return aT ? -1 : 1;
    if (aT !== bT) return aT.localeCompare(bT);
    return a.r.id.localeCompare(b.r.id);
  });

  /*
   * Rows are keyed by reservation id throughout. Holding position by object
   * identity would silently fail: the entries below are built with object
   * spreads, so a later `indexOf` on one of them matches nothing and the row is
   * inserted a second time instead of moved. That produced a list with every
   * booking duplicated.
   */
  const ranked = byDate
    .map((it, i) => ({ id: it.r.id, rank: it.rank, dateIdx: i }))
    .filter((it) => byDate.find((x) => x.r.id === it.id)!.touched)
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.dateIdx - b.dateIdx));

  const lifted = new Set(ranked.map((it) => it.id));
  const ordered = byDate.filter((it) => !lifted.has(it.r.id));

  /*
   * Insert in rank order, each at its rank clamped to the list it is entering.
   * A plain comparison sort cannot express this: a dragged row has to move past
   * rows whose dates it does not precede, while those rows keep their relative
   * positions rather than shuffling among themselves.
   */
  for (const it of ranked) {
    const at = Math.max(0, Math.min(ordered.length, it.rank));
    const item = byDate.find((x) => x.r.id === it.id)!;
    ordered.splice(at, 0, item);
  }

  return ordered.map(({ r }) => r);
}
