import airportsJson from "airports-json";

/*
 * Offline IATA/ICAO airport lookup.
 *
 * Why this exists at all: Nominatim is a place-name database and has no
 * concept of airport codes. Asking it to resolve "LHR" returns Lahore,
 * "PHL" returns Liverpool, and "KEF" returns a region of Tunisia — all
 * plausible-looking results for a query that never meant a place at all. That
 * is worse than a failure, because the pin lands somewhere real on the map and
 * looks authoritative.
 *
 * So codes are resolved against actual airport data before Nominatim is
 * consulted, and a hit short-circuits the network entirely. That also makes
 * flight endpoints resolve instantly and work with no connectivity, which
 * matters because this data is baked in rather than fetched.
 *
 * Data: airports-json (OurAirports), ~5,200 airports worldwide.
 */

type RawAirport = {
  ident?: string;
  type?: string;
  name?: string;
  latitude_deg?: string;
  longitude_deg?: string;
  iso_country?: string;
  municipality?: string;
  gps_code?: string;
  iata_code?: string;
  local_code?: string;
};

export type AirportHit = {
  /** The key used to find it: "IATA:LHR" or "G:EGLL". */
  key: string;
  code: string;
  name: string;
  municipality: string;
  country: string;
  lat: number;
  lng: number;
  type: string;
  /** A display label, formatted like Nominatim's so callers need no special case. */
  label: string;
};

/**
 * OurAirports type rankings. A large airport is what someone naming an IATA
 * code almost always means; a closed airfield or a heliport sharing the code
 * should never win.
 */
const TYPE_RANK: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
  heliport: 4,
  balloonport: 5,
  closed: 9,
};

/** Airport codes are 3 letters (IATA) or 4 alphanumerics (ICAO). */
const IATA_RE = /^[A-Z]{3}$/;
const ICAO_RE = /^[A-Z0-9]{4}$/;

/**
 * Build the lookup once at module load.
 *
 * Kept as two maps rather than scanning the array per query: a trip resolves
 * dozens of locations on every page load, and a linear scan of 5,000 records
 * each time is needless work for a table that never changes at runtime.
 *
 * Where several airports share a code, the highest-ranked type wins — so a
 * large airport always beats a closed strip with the same identifier.
 */
function buildIndex(): { byIata: Map<string, AirportHit>; byIcao: Map<string, AirportHit> } {
  const raw = airportsJson as unknown as { airports?: RawAirport[] } | RawAirport[];
  const list: RawAirport[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.airports)
      ? raw.airports
      : [];

  const byIata = new Map<string, AirportHit>();
  const byIcao = new Map<string, AirportHit>();

  const place = (r: RawAirport): AirportHit | null => {
    const lat = Number.parseFloat(r.latitude_deg ?? "");
    const lng = Number.parseFloat(r.longitude_deg ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const name = (r.name ?? "").trim();
    if (!name) return null;

    const municipality = (r.municipality ?? "").trim();
    const country = (r.iso_country ?? "").trim();

    // Formatted to read like a Nominatim display_name so the map label and the
    // reservation list need no special-casing for airport-derived points.
    const label = [name, municipality, country].filter(Boolean).join(", ");

    return {
      key: "",
      code: "",
      name,
      municipality,
      country,
      lat,
      lng,
      type: r.type ?? "",
      label,
    };
  };

  const consider = (map: Map<string, AirportHit>, code: string, hit: AirportHit) => {
    const existing = map.get(code);
    if (!existing) {
      map.set(code, hit);
      return;
    }
    const rank = TYPE_RANK[hit.type] ?? 8;
    const existingRank = TYPE_RANK[existing.type] ?? 8;
    if (rank < existingRank) map.set(code, hit);
  };

  for (const r of list) {
    const base = place(r);
    if (!base) continue;

    const iata = (r.iata_code ?? "").trim().toUpperCase();
    if (iata && IATA_RE.test(iata)) {
      consider(byIata, iata, { ...base, key: `IATA:${iata}`, code: iata });
    }

    // gps_code is the real-world ICAO, ident is the OurAirports fallback for
    // strips that have no assigned ICAO. Prefer gps_code.
    const icao = ((r.gps_code || r.ident) ?? "").trim().toUpperCase();
    if (icao && ICAO_RE.test(icao)) {
      consider(byIcao, icao, { ...base, key: `ICAO:${icao}`, code: icao });
    }
  }

  return { byIata, byIcao };
}

const { byIata, byIcao } = buildIndex();

/** True when the string could be an airport code at all. */
export function looksLikeAirportCode(token: string): boolean {
  const t = token.trim().toUpperCase();
  return IATA_RE.test(t) || ICAO_RE.test(t);
}

/**
 * Look up a single bare code.
 *
 * IATA is tried first because it is what appears on a boarding pass; ICAO is
 * the fallback for fields that use the 4-letter form.
 */
export function lookupAirportCode(token: string): AirportHit | null {
  const t = token.trim().toUpperCase();
  if (!t) return null;
  if (IATA_RE.test(t)) return byIata.get(t) ?? null;
  if (ICAO_RE.test(t)) return byIcao.get(t) ?? null;
  return null;
}

/**
 * Pull a trailing or parenthesised airport code out of free text.
 *
 * Handles the shapes people actually type, taken from real entries in this
 * app's own data:
 *   "PHL"                 -> PHL
 *   "Philadelphia (PHL)"  -> PHL
 *   "MUC - Munich"        -> MUC
 *   "LHR, London"         -> LHR
 *   "LHR (T5)"            -> LHR   (terminal, not a code — see below)
 *   "near MUC"            -> MUC
 *
 * Returns null when there is no code-shaped token, so ordinary place names
 * ("Bolzano", "South Tyrol") fall through to Nominatim untouched.
 */
export function extractAirportCode(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // A bare code on its own is the common case and must not be treated as a
  // place name.
  if (looksLikeAirportCode(text) && text.split(/\s+/).length === 1) {
    return text.toUpperCase();
  }

  /*
   * A leading token followed by a parenthesised qualifier: "LHR (T5)",
   * "MUC (T1)". The parenthesised part is a terminal or gate, not a code, so
   * the code is whatever precedes it — but only when it genuinely resolves,
   * which the caller checks.
   */
  const headParen = /^([A-Za-z0-9]{3,4})\s*\([^)]*\)\s*$/.exec(text);
  if (headParen && looksLikeAirportCode(headParen[1])) {
    return headParen[1].toUpperCase();
  }

  // "(PHL)" anywhere in the string.
  const paren = /\(([A-Za-z0-9]{3,4})\)/.exec(text);
  if (paren && looksLikeAirportCode(paren[1])) return paren[1].toUpperCase();

  // A leading token followed by a separator: "MUC - Munich", "LHR, London".
  const lead = /^([A-Za-z0-9]{3,4})\s*[-–—,:]\s*\S/.exec(text);
  if (lead && looksLikeAirportCode(lead[1])) return lead[1].toUpperCase();

  // A trailing token after a separator: "Munich, MUC".
  const trail = /\s*[-–—,:]\s*([A-Za-z0-9]{3,4})$/.exec(text);
  if (trail && looksLikeAirportCode(trail[1])) return trail[1].toUpperCase();

  /*
   * A code embedded in prose: "near MUC", "arriving MUC". Only a known code
   * qualifies, so a sentence that happens to contain a three-letter word is
   * not mistaken for an airport.
   */
  const words = text.split(/\s+/);
  if (words.length === 2) {
    for (const w of words) {
      const t = w.toUpperCase();
      if (IATA_RE.test(t) && lookupAirportCode(t)) return t;
    }
  }

  return null;
}

/**
 * Resolve free text that names an airport, e.g. "PHL" or "Philadelphia (PHL)".
 *
 * Returns null when there is no code or the code is unknown, leaving the caller
 * to fall back to Nominatim. That is deliberate for codes like TXL (Berlin
 * Tegel, closed 2020 and absent from current data): a wrong guess is worse than
 * a real lookup, so the lookup is allowed to try.
 */
export function resolveAirportText(raw: string): AirportHit | null {
  const code = extractAirportCode(raw);
  if (!code) return null;
  return lookupAirportCode(code);
}
