import "server-only";

import { getDb } from "./db";
import { resolveAirportText } from "./airports";

/*
 * Geocoding via Nominatim (OpenStreetMap).
 *
 * Three constraints shape this file:
 *
 *   1. Nominatim's usage policy allows roughly one request per second and
 *      requires an identifying User-Agent. Requests are therefore serialised
 *      with a small delay between them rather than fired in parallel. A
 *      parallel burst would get the whole host throttled or blocked.
 *
 *   2. Results are cached in SQLite keyed on the normalised query, so the
 *      common case (re-opening a trip) needs no network at all.
 *
 *   3. A failure must not stall the map. Anything unresolvable is recorded as
 *      a miss and reported back as null, and the caller simply draws one fewer
 *      pin rather than erroring.
 */

const USER_AGENT = "trip-packer/1.0 (personal trip planner; homelab)";

/** Nominatim asks for at most ~1 request/second. */
const MIN_INTERVAL_MS = 1100;

export type GeoPoint = {
  query: string;
  lat: number;
  lng: number;
  label: string;
};

type CacheRow = {
  query: string;
  lat: number | null;
  lng: number | null;
  label: string;
  miss: number;
};

/**
 * Matches a 3-letter IATA code, optionally in the "(SEA)" position.
 *
 * Kept as a single named pattern because it now feeds two decisions — whether
 * to build airport-aware strategies, and whether the cached answer for a query
 * is trustworthy — and those must not drift apart.
 */
const AIRPORT_CODE_RE = /\b[A-Z]{3}\b/;

/**
 * Normalise a location string so equivalent spellings share one cache entry.
 *
 * Case, surrounding whitespace and repeated spaces are all collapsed: the
 * reservation form is free text, so "Keflavík Airport", "keflavik airport"
 * and " Keflavík  Airport " must not produce three separate lookups.
 */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Serialises requests so we never exceed one per MIN_INTERVAL_MS. */
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function readCache(query: string): GeoPoint | null | undefined {
  const row = getDb()
    .prepare("SELECT query, lat, lng, label, miss FROM geocache WHERE query = ?")
    .get(query) as CacheRow | undefined;

  if (!row) return undefined; // not cached
  if (row.miss === 1) return null; // known-unresolvable
  return { query: row.query, lat: row.lat as number, lng: row.lng as number, label: row.label };
}

function writeCache(query: string, point: GeoPoint | null): void {
  getDb()
    .prepare(
      `INSERT INTO geocache (query, lat, lng, label, miss, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET
         lat = excluded.lat,
         lng = excluded.lng,
         label = excluded.label,
         miss = excluded.miss`
    )
    .run(
      query,
      point ? point.lat : null,
      point ? point.lng : null,
      point ? point.label : "",
      point ? 0 : 1,
      new Date().toISOString()
    );
}

/**
 * Build progressively better search strings for a location.
 *
 * The reservation form invites entries like "Seattle (SEA)" or "Keflavík
 * (KEF)". Nominatim treats the parenthesised IATA code as free text and can
 * match a nearby building instead of the airport — "Seattle (SEA)" resolves to
 * a rail yard 15 km away, while "SEA airport" correctly finds the terminal.
 *
 * So we try the query as typed first, then a version with the code stripped,
 * and finally the code plus the word "airport". The first plausible hit wins.
 * Note the order matters: a plain city name is already accurate, so we must
 * not discard the user's text unless it actually failed to look like a place.
 */
function searchStrategies(raw: string, context?: string): string[] {
  const trimmed = raw.trim();
  const strategies: string[] = [];

  /*
   * A context-augmented query goes first, because it is strictly the most
   * specific thing we can ask.
   *
   * Ranking alone cannot separate these: Nominatim scores a nightclub and a
   * city district alike, so whichever strategy is queried first wins a tie.
   * "Terminal 5" on its own returns a Manhattan nightclub, and it is only by
   * asking the disambiguated form first that the right answer is reached.
   *
   * The context leads the query, because Nominatim's free-text search is
   * order-sensitive and degrades sharply with trailing words: "Sofitel London
   * Heathrow Terminal 5" resolves to the hotel, while the reverse order
   * "Terminal 5 Sofitel London Heathrow" matches nothing at all. Context is
   * the more distinctive term, so it earns the leading position.
   */
  if (context) {
    const hint = `${context} ${trimmed}`.replace(/\s+/g, " ").trim();
    strategies.push(hint);
  }

  strategies.push(trimmed);

  // "Seattle (SEA)" / "Seattle, WA (SEA)" -> code "SEA", rest "Seattle"
  const paren = /^(.*?)\s*\(([A-Za-z]{3,4})\)\s*$/.exec(trimmed);
  if (paren) {
    const place = paren[1].replace(/,\s*$/, "").trim();
    const code = paren[2].toUpperCase();
    if (place) strategies.push(place);
    // The code alone with "airport" is the most reliable airport match.
    if (/^[A-Z]{3}$/.test(code)) strategies.push(`${code} airport`);
  }

  return Array.from(new Set(strategies.filter(Boolean)));
}

/**
 * Nominatim result shape, limited to the fields we use.
 */
type NominatimHit = {
  lat: string;
  lon: string;
  display_name?: string;
  type?: string;
  class?: string;
  importance?: number;
};

/**
 * Rank a candidate result for a given search string.
 *
 * This exists because taking Nominatim's first hit is wrong for our input.
 * "Seattle (SEA)" returns a railway building — nominally a match, but the user
 * meant the airport, and a pin 15 km off makes the map misleading rather than
 * merely imprecise.
 *
 * So when the query carries an airport code, an aerodrome outranks everything.
 * Otherwise we prefer larger administrative areas, falling back to whatever
 * came back first.
 */
function scoreHit(hit: NominatimHit, wantsAirport: boolean): number {
  const type = (hit.type ?? "").toLowerCase();
  const cls = (hit.class ?? "").toLowerCase();

  if (wantsAirport) {
    if (type === "aerodrome" || cls === "aeroway") return 100;
    // An airport named in the display string is nearly as good.
    if ((hit.display_name ?? "").toLowerCase().includes("airport")) return 90;
    /*
     * Anything that is clearly not an airport must not win by default.
     *
     * Nominatim answers "Terminal 5 airport" with an aerodrome, but it answers
     * "Terminal 5" with a music venue (amenity/leisure in Manhattan). Without
     * this guard the venue scores 10 — the same as an unlabelled candidate —
     * and can still be selected as the best hit. A venue, shop or building is
     * never what a travel itinerary means by "Terminal 5".
     */
    if (cls === "amenity" || cls === "leisure" || cls === "shop" || cls === "tourism") {
      return 0;
    }
  }

  if (cls === "place" && type === "city") return 60;
  if (cls === "place" && type === "town") return 55;
  if (cls === "boundary" && type === "administrative") return 50;

  return 10;
}

/**
 * Resolve a single location string to coordinates.
 *
 * Returns null when no strategy finds a match. The second return value reports
 * whether the answer came from the cache, which the caller uses to decide
 * whether it needs to keep throttling.
 */
export async function geocode(
  raw: string,
  context?: string
): Promise<{ point: GeoPoint | null; cached: boolean }> {
  const query = normaliseQuery(raw);
  if (!query) return { point: null, cached: true };

  /*
   * Airport codes are resolved locally before anything else.
   *
   * This runs ahead of the cache read on purpose. Earlier versions cached
   * whatever Nominatim returned for a bare code, which was often a real but
   * unrelated place — "lhr" was stored as Lahore, "phl" as Liverpool. Those
   * rows are still in the database, so consulting the cache first would keep
   * serving the wrong answer forever. An exact airport match is authoritative
   * and overwrites whatever was cached before.
   *
   * Offline, instant, and no rate limit; "LHR" means Heathrow.
   */
  const airport = resolveAirportText(raw);
  if (airport) {
    const point: GeoPoint = {
      query,
      lat: airport.lat,
      lng: airport.lng,
      label: airport.label,
    };
    writeCache(query, point);
    return { point, cached: false };
  }

  const strategies = searchStrategies(raw, context);
  /*
   * Whether the query names an airport, decided from the input itself rather
   * than from how many strategies exist.
   *
   * These used to be the same thing, because the only query that produced a
   * second strategy was one carrying an airport code. Once `context` could add
   * a strategy, "more than one strategy" no longer implies "airport" — an
   * ordinary hotel with a title would have been scored as though it were one.
   */
  const wantsAirport = AIRPORT_CODE_RE.test(raw);

  /*
   * A context-resolved answer is cached under its own key.
   *
   * "Terminal 5" means Heathrow's terminal in the context of "Sofitel London
   * Heathrow", but nothing at all on its own. Sharing one cache key between
   * the two would let whichever ran first decide for both — the same class of
   * poisoning that put a Manhattan nightclub on this map.
   */
  const cacheKey = context ? `${query}\u0000${normaliseQuery(context)}` : query;

  /*
   * When the query names an airport-related place, consult the cache only if it
   * was resolved by one of the airport-aware strategies.
   *
   * A plain cache read would pin the wrong answer forever. "Terminal 5" was
   * cached from a bare lookup as a music venue in Manhattan, and because the
   * cache is checked before any scoring, no amount of better candidates could
   * ever displace it. That is the same failure mode as the old "lhr" -> Lahore
   * rows, so it takes the same shape of fix: an authoritative strategy is
   * allowed to re-resolve and overwrite.
   *
   * Entries written by the airport-aware strategies are still served from
   * cache, so this costs a lookup only for the (rare) mis-cached inputs.
   */
  if (!wantsAirport) {
    const hit = readCache(cacheKey);
    if (hit !== undefined) return { point: hit, cached: true };
  } else {
    const hit = readCache(cacheKey);
    if (
      hit !== undefined &&
      hit !== null &&
      (hit.label ?? "").toLowerCase().includes("airport")
    ) {
      return { point: hit, cached: true };
    }
  }

  let best: { hit: NominatimHit; score: number; strategy: string } | null = null;

  for (const candidate of strategies) {
    await throttle();

    const url =
      "https://nominatim.openstreetmap.org/search?" +
      new URLSearchParams({
        format: "json",
        limit: "5",
        q: candidate,
        // Ask for the structured fields we rank on.
        addressdetails: "0",
      }).toString();

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });

      // A 429 or 5xx is transient, so stop rather than burn the remaining
      // strategies and do NOT cache — this should be retried later.
      if (!res.ok) return { point: null, cached: false };

      const data = (await res.json()) as NominatimHit[];
      if (!Array.isArray(data) || data.length === 0) continue;

      for (const h of data) {
        const score = scoreHit(h, wantsAirport);
        if (!best || score > best.score) best = { hit: h, score, strategy: candidate };
      }

      // A perfect airport match cannot be improved on, so stop early.
      if (best && best.score >= 100) break;
    } catch {
      // Network failure or timeout — transient, so leave the cache alone.
      return { point: null, cached: false };
    }
  }

  if (best) {
    const lat = Number.parseFloat(best.hit.lat);
    const lng = Number.parseFloat(best.hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const point: GeoPoint = {
        query,
        lat,
        lng,
        label: best.hit.display_name ?? best.strategy,
      };
      writeCache(cacheKey, point);
      return { point, cached: false };
    }
  }

  // Every strategy came back empty, so this is a genuine miss. Remember it so
  // a vague or mistyped location is not re-queried on every page load.
  writeCache(cacheKey, null);
  return { point: null, cached: false };
}

/**
 * Resolve many locations, skipping ones already cached and de-duplicating
 * repeats within the batch so a flight to and from the same city only costs
 * one lookup.
 */
export async function geocodeMany(
  raws: string[],
  /*
   * Optional per-query disambiguating text, keyed by the raw location string.
   *
   * A reservation's location is often a fragment — "Terminal 5" — whose meaning
   * only exists in the context of its title ("Sofitel London Heathrow"). The
   * caller knows that pairing; this function does not, so it is passed in.
   */
  contexts?: Record<string, string>
): Promise<{ points: GeoPoint[]; unresolved: string[] }> {
  const points: GeoPoint[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const raw of raws) {
    const q = normaliseQuery(raw);
    if (!q) continue;
    const context = contexts?.[raw.trim()];
    // A context-resolved query is a distinct lookup, so it must not be
    // deduplicated against the same string without one.
    const dedupeKey = context ? `${q}\u0000${normaliseQuery(context)}` : q;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const { point } = await geocode(raw, context);
    if (point) points.push(point);
    else unresolved.push(raw.trim());
  }

  return { points, unresolved };
}
