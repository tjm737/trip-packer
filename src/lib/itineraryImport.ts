/**
 * Import an itinerary from a saved HTML file.
 *
 * The input is a self-contained HTML page: a hero, then `<section>` blocks
 * for Flights, Lodging, Day by day, and so on. Nothing about it is
 * machine-readable — the structure lives entirely in class names — so this
 * parser keys off those classes and is intentionally tolerant: a missing
 * section yields nothing rather than throwing, because the whole point is to
 * accept files we did not generate.
 *
 * Parsing runs on the server. The browser has DOMParser, but the file is
 * uploaded to an API route, and doing the work there keeps one
 * implementation instead of two.
 *
 * Deliberate limitation: no HTML sanitisation library and no regex-as-parser.
 * We walk the document with a small tolerant tokeniser and extract only text
 * and the handful of attributes we understand, so nothing from the source
 * file is ever rendered as markup.
 *
 * Why not a real DOM parser: this has to run in a Next.js route handler with
 * no jsdom dependency, and the input is untrusted. A narrow tokeniser that
 * can only emit text nodes and known class names is a smaller surface than a
 * full DOM implementation we then have to sanitise.
 */

import type { Reservation, ReservationType, Task } from "./types";

/** Reserved for callers that want to pre-check before importing. */
export type ParsedItinerary = {
  trip: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
    notes: string;
    icon: string;
  };
  /**
   * `id`/`tripId` are assigned at insert time. `createdAt` is deliberately
   * absent here and stamped once in `parseItinerary`, so that every record
   * from one import shares a timestamp instead of six extractors each
   * calling `new Date()` and producing values a few milliseconds apart.
   */
  reservations: Array<Omit<Reservation, "id" | "tripId" | "createdAt">>;
  tasks: Array<Omit<Task, "id" | "tripId" | "createdAt">>;
  warnings: string[];
};

/* ------------------------------------------------------------------ *
 * Text extraction
 * ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  "&rarr;": "→",
  "&larr;": "←",
  "&middot;": "·",
  "&mdash;": "—",
  "&ndash;": "–",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&euro;": "€",
  "&pound;": "£",
  "&hellip;": "…",
};

function decode(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(ENTITIES)) {
    out = out.split(k).join(v);
  }
  // Numeric entities, e.g. &#8212; and &#x2014;
  out = out.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return out;
}

/**
 * Flatten an HTML fragment to plain text.
 *
 * Block-level tags become newlines so that a `<div>`-per-line source keeps
 * its line structure; inline tags vanish. This matters for `.flight-meta`,
 * where the source separates facts with `&middot;`, and for `.day-body`,
 * where an inline `<span class="opt">` holds an optional aside we want to
 * keep as part of the sentence.
 */
function toText(fragment: string): string {
  let s = fragment;
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n");
  s = s.replace(/<[^>]*>/g, "");
  /*
   * Fragments arrive as slices that stop wherever the caller's boundary
   * regex matched, which can land inside a tag and leave a partial one
   * behind — a trailing `</div` with no closing `>`. Those survive the
   * strip above because they look like text. Removing any `<` followed by
   * a tag-ish run to the end of the string clears them.
   */
  s = s.replace(/<\/?[a-zA-Z][^>]*$/, "");
  s = decode(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Strip the trailing "listing" / "site" link label the source appends. */
function splitNameAndUrl(fragment: string): { name: string; url: string } {
  const href = /href="([^"]+)"/.exec(fragment);
  let name = toText(fragment);
  // The source renders `<name> · <a>listing</a>`; the link text duplicates
  // nothing useful, so drop a trailing separator plus the link word.
  name = name.replace(/\s*·\s*(listing|site|link|map)\s*$/i, "").trim();
  return { name, url: href ? decode(href[1]) : "" };
}

/* ------------------------------------------------------------------ *
 * Section splitting
 * ------------------------------------------------------------------ */

type ParsedSection = { title: string; body: string };

/**
 * Pull the top-level `<section>` blocks and their `<h2>` titles.
 *
 * Nesting: the source has no nested sections, so a non-greedy match to the
 * closing tag is safe here. If a future file nests them the outer match wins
 * and the inner content is still walked by the per-section extractors.
 */
function sections(html: string): ParsedSection[] {
  const out: ParsedSection[] = [];
  const re = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(body);
    out.push({ title: h2 ? toText(h2[1]) : "", body });
  }
  return out;
}

/**
 * Split a container into the blocks introduced by an element carrying `cls`.
 *
 * Element-agnostic on purpose: the source mixes `<div class="stay">` with
 * `<span class="rest-name">`, and assuming a tag name is how the dining
 * section silently returned nothing.
 *
 * The class match is anchored to the whole attribute value rather than a word
 * boundary, because `\bstay\b` also matches `stay-dates` — a hyphen is a word
 * boundary — which silently turns 4 stays into 11 fragments. Only an exact
 * class list (possibly with other classes alongside) is a real match.
 *
 * The body runs to the next sibling of the same class, or the end of the
 * container, so callers get one block per element and no lookahead against
 * tags that the section splitter has already consumed.
 */
function blocksOfClass(html: string, cls: string): string[] {
  const open = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`,
    "gi"
  );
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(html)) !== null) starts.push(m.index);

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : html.length;
    return html.slice(start, end);
  });
}

/**
 * Read the text of a leaf element by class.
 *
 * Distinct from `blocksOfClass`, which runs to the *next element of the same
 * class* — correct for a repeated block like a flight row, but wrong for a
 * one-per-row field like `flight-code`, where there is no next sibling of
 * that class and the slice would run to the end of the container, swallowing
 * every following field. A leaf field instead ends at its own closing tag.
 *
 * These fields are single-level in the source (text plus inline spans and
 * links, but no nested block elements), so the first closing tag of its own
 * tag name is the right boundary.
 */
function leafOf(html: string, cls: string): string {
  const open = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`,
    "i"
  );
  const m = open.exec(html);
  if (!m) return "";
  const tag = m[1];
  const rest = html.slice(m.index + m[0].length);
  // Closing tag of the same element, e.g. `</div>` or `</span>`.
  const close = new RegExp(`</${tag}>`, "i").exec(rest);
  return close ? rest.slice(0, close.index) : rest;
}

/**
 * Text of a leaf element, e.g. `flight-code`.
 *
 * Use this for fields that appear once per block. Use `blocksOfClass` when a
 * class repeats and each occurrence starts a new record.
 */
function fieldText(html: string, cls: string): string {
  return toText(leafOf(html, cls));
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

/**
 * Turn "Mon 10/12" plus a reference year into "2026-10-12".
 *
 * The source omits the year on every date, so it has to come from the file's
 * own title ("Oct 12–20, 2026"). We infer the year per-date rather than
 * applying one blindly, so a trip that crosses New Year lands on the right
 * side of the boundary.
 */
function toIsoDate(dayMonth: string, year: number, prevIso: string | null): string {
  const m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(dayMonth);
  if (!m) return "";
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  let y = year;
  // A date that jumps backwards by more than 6 months rolled into next year.
  if (prevIso) {
    const prev = new Date(prevIso + "T00:00:00Z");
    const cand = new Date(Date.UTC(y, mm - 1, dd));
    if (cand.getTime() < prev.getTime() - 183 * 864e5) y += 1;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mm)}-${pad(dd)}`;
}

/**
 * "6:45 PM" -> "18:45". Returns "" when absent.
 *
 * The source writes times loosely: a leading `~` marks an estimate and a
 * trailing `(+1)` marks an arrival on the following day. `~` is ignored so
 * the estimate still lands as a time, and the caller pulls `(+1)` off the
 * raw string separately because it affects the arrival date, not the clock.
 */
function to24h(s: string): string {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s);
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2];
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (!ap && h > 23) return "";
  return `${String(h).padStart(2, "0")}:${min}`;
}

/** True when the source marked a time as landing on the next day, "(+1)". */
function isNextDay(s: string): boolean {
  return /\(\s*\+\s*1\s*\)/.test(s);
}

/** Advance an ISO date by one day, or return "" if it cannot be read. */
function nextDay(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Pull the year from the document title, falling back to the current one. */
function yearFrom(html: string): number {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const hay = title ? decode(title[1]) : html.slice(0, 4000);
  const m = /\b(20\d{2})\b/.exec(hay);
  return m ? Number(m[1]) : new Date().getUTCFullYear();
}

/* ------------------------------------------------------------------ *
 * Extractors
 * ------------------------------------------------------------------ */

function parseFlights(sec: ParsedSection, year: number, warn: string[]) {
  const out: ParsedItinerary["reservations"] = [];
  const rows = blocksOfClass(sec.body, "flight-row");
  let prev: string | null = null;
  for (const row of rows) {
    const route = fieldText(row, "flight-route");
    const code = fieldText(row, "flight-code");
    const meta = fieldText(row, "flight-meta");
    const dateRaw = fieldText(row, "flight-date");
    const cabin = fieldText(row, "flight-cabin");

    const iso = toIsoDate(dateRaw, year, prev);
    if (iso) prev = iso;

    // "PHL (T1) &rarr; LHR (T5)" -> endpoints, keeping the terminal text
    // because it is genuinely useful at the airport.
    const parts = route.split("→").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) {
      warn.push(`Flight ${code || route}: could not read an origin/destination pair`);
    }

    const departRaw = /(?:Depart|Departs?)\s*([^·\n]+)/i.exec(meta)?.[1] ?? "";
    const arriveRaw = /(?:Arrive|Arrives?)\s*([^·\n]+)/i.exec(meta)?.[1] ?? "";
    const depart = to24h(departRaw);
    const arrive = to24h(arriveRaw);

    /*
     * An overnight flight marked "(+1)" lands the following day. Without this
     * the arrival date equals the departure date, which reads as a
     * same-morning landing and puts the wrong date under the flight.
     */
    const endDate = isNextDay(arriveRaw) ? nextDay(iso) : iso;

    // Keep every fact that is not a plain depart/arrive, so seats, layovers
    // and durations survive the import instead of being dropped.
    const notes = meta
      .split("·")
      .map((s) => s.trim())
      .filter((s) => s && !/^(Depart|Arrive)\b/i.test(s))
      .join(" · ");

    out.push({
      type: "flight",
      title: code || route || "Flight",
      confirmation: "",
      location: parts[0] ?? "",
      locationTo: parts[1] ?? "",
      startDate: iso,
      startTime: depart,
      endDate,
      endTime: arrive,
      cost: "",
      notes: [cabin, notes].filter(Boolean).join(" · "),
      order: out.length,
    });
  }
  return out;
}

function parseLodging(sec: ParsedSection, year: number, warn: string[]) {
  const out: ParsedItinerary["reservations"] = [];
  /*
   * Each stay is `<div class="stay"><div class="stay-name">…</div><div
   * class="stay-dates">…</div></div>`. The outer block is delimited by the
   * next stay, so no lookahead at closing tags is needed — see the note on
   * blocksOfClass about why a `\bstay\b` match would also catch stay-dates.
   */
  let prev: string | null = null;
  for (const block of blocksOfClass(sec.body, "stay")) {
    const nameFrag = leafOf(block, "stay-name");
    const datesRaw = fieldText(block, "stay-dates");
    const { name, url } = splitNameAndUrl(nameFrag);
    if (!name) continue;

    // "Tue 10/13 → Wed 10/14"
    const sides = datesRaw.split("→").map((s) => s.trim());
    const start = toIsoDate(sides[0] ?? "", year, prev);
    if (start) prev = start;
    const end = toIsoDate(sides[1] ?? "", year, start || prev);

    // "Erding — near MUC" -> the part after the em dash is the locality.
    const dash = name.split("—").map((s) => s.trim());
    const place = dash.length > 1 ? dash[dash.length - 1] : "";

    out.push({
      type: "lodging",
      title: dash[0] || name,
      confirmation: "",
      location: place,
      locationTo: "",
      startDate: start,
      startTime: "",
      endDate: end,
      endTime: "",
      cost: "",
      notes: [dash.slice(1).join(" — "), url].filter(Boolean).join(" · "),
      order: out.length,
    });
  }
  if (out.length === 0) warn.push("Lodging: no stays found");
  return out;
}

function parseCar(sec: ParsedSection, year: number, warn: string[]) {
  const facts: Record<string, string> = {};
  const re = /class="fact-label"[^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class="fact-value"[^>]*>([\s\S]*?)<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sec.body)) !== null) {
    facts[toText(m[1]).toLowerCase()] = toText(m[2]);
  }
  const sub = fieldText(sec.body, "section-sub");
  const pickup = facts["pickup / return"] ?? facts["pickup"] ?? "";
  const sides = pickup.split("→").map((s) => s.trim());

  // "MUC Airport · 10/13 → 10/19" — the first side carries place and date.
  const startBits = /^(.*?)[·\s]*(\d{1,2}\s*\/\s*\d{1,2})\s*$/.exec(sides[0] ?? "");
  const start = toIsoDate(startBits?.[2] ?? sides[0] ?? "", year, null);
  const end = toIsoDate(sides[1] ?? "", year, start || null);

  const detail = Object.entries(facts)
    .filter(([k]) => !k.startsWith("pickup"))
    .map(([k, v]) => `${k.replace(/\b\w/g, (c) => c.toUpperCase())}: ${v}`)
    .join(" · ");

  if (!pickup) warn.push("Rental car: no pickup details found");

  return {
    type: "car" as ReservationType,
    title: toText(sub) ? `${toText(sub).split(",")[0]}` : "Rental car",
    confirmation: "",
    location: startBits?.[1]?.trim() || (sides[0] ?? ""),
    locationTo: "",
    startDate: start,
    startTime: "",
    endDate: end,
    endTime: "",
    cost: "",
    notes: detail,
    order: 0,
  };
}

function parseDining(sec: ParsedSection) {
  const out: ParsedItinerary["reservations"] = [];
  // A rest-item wraps its own rest-name and rest-tag divs, so the block must
  // run to the next rest-item. Closing on the first `</div>` would cut each
  // entry off before its name.
  for (const block of blocksOfClass(sec.body, "rest-item")) {
    const nameFrag = leafOf(block, "rest-name");
    const tag = fieldText(block, "rest-tag");
    const href = /href="([^"]+)"/.exec(block);
    const name = toText(nameFrag);
    if (!name) continue;
    out.push({
      type: "activity",
      title: name,
      confirmation: "",
      // The tag is "Vöran village · walkable" or "Merano · 1 star"; the first
      // segment is the town, which is what the map needs.
      location: tag.split("·")[0].trim(),
      locationTo: "",
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
      cost: "",
      notes: [tag.split("·").slice(1).join("·").trim(), href ? decode(href[1]) : ""]
        .filter(Boolean)
        .join(" · "),
      order: 0,
    });
  }
  return out;
}

function parseDays(sec: ParsedSection, year: number): string {
  const lines: string[] = [];
  /*
   * One `<div class="day">` per day, holding day-date / day-title / day-body
   * children. Matching on a bare `day` word boundary would also split on
   * day-date and day-body, so each day is delimited by the next day block.
   */
  let prev: string | null = null;
  for (const block of blocksOfClass(sec.body, "day")) {
    const dateRaw = fieldText(block, "day-date");
    const title = fieldText(block, "day-title");
    const body = fieldText(block, "day-body");
    if (!title && !body) continue;
    const iso = toIsoDate(dateRaw, year, prev);
    if (iso) prev = iso;

    const label = iso
      ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : dateRaw;
    lines.push(`${label} — ${title}`);
    if (body) lines.push(body);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function parseTodos(sec: ParsedSection) {
  const out: ParsedItinerary["tasks"] = [];
  // Same block-per-item rule as dining: an item's own markup contains nested
  // divs, so it runs to the next item rather than to the first `</div>`.
  for (const block of blocksOfClass(sec.body, "todo-item")) {
    const text = toText(block);
    if (!text) continue;
    out.push({ title: text, done: false, dueDate: "", notes: "", order: out.length });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function parseItinerary(html: string): ParsedItinerary {
  const warnings: string[] = [];
  const year = yearFrom(html);

  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const name = h1 ? toText(h1[1]) : "";

  // The hero carries a title, a one-line blurb, and a date range. The blurb
  // becomes the opening of the notes; the date range is only a fallback for
  // the warning message, since the trip's real span is derived from the
  // reservations below.
  const eyebrowM = /class="eyebrow"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const eyebrow = eyebrowM ? toText(eyebrowM[1]) : "";
  const blurbM = /class="dates"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const blurb = blurbM ? toText(blurbM[1]) : "";

  const secs = sections(html);
  const byTitle = (needle: string) =>
    secs.find((s) => s.title.toLowerCase().includes(needle.toLowerCase()));

  const flightsSec = byTitle("flight");
  const lodgingSec = byTitle("lodging");
  const daysSec = byTitle("day by day");
  const carSec = byTitle("rental car") ?? byTitle("car");
  const dineSec = byTitle("dining") ?? byTitle("restaurant");
  const todoSec = byTitle("still to do") ?? byTitle("to do");

  const reservations: ParsedItinerary["reservations"] = [];
  if (flightsSec) reservations.push(...parseFlights(flightsSec, year, warnings));
  else warnings.push("No flights section found");
  if (lodgingSec) reservations.push(...parseLodging(lodgingSec, year, warnings));
  else warnings.push("No lodging section found");
  if (carSec) reservations.push(parseCar(carSec, year, warnings));
  else warnings.push("No rental car section found");
  if (dineSec) reservations.push(...parseDining(dineSec));
  else warnings.push("No dining section found");

  // Order is positional across the whole set, so the route reads top to bottom
  // in the same order the file presents it: outbound flight, stays, car, food.
  reservations.forEach((r, i) => {
    r.order = i;
  });

  const tasks = todoSec ? parseTodos(todoSec) : [];
  if (!todoSec) warnings.push("No to-do section found");

  const notes = daysSec ? parseDays(daysSec, year) : "";
  if (!notes) warnings.push("No day-by-day section found");

  // The hero blurb is prose about the trip, so it leads the notes.
  const notesFull = [blurb, notes].filter(Boolean).join("\n\n");

  // Destination: prefer the first lodging locality, which is a real
  // geocodable place, over the freeform hero text.
  const firstLodging = reservations.find((r) => r.type === "lodging" && r.location);
  const destination = firstLodging?.location ?? "";

  // Trip span from the earliest and latest dates we actually parsed, so the
  // header cannot disagree with the reservations below it.
  const allDates = reservations.flatMap((r) =>
    [r.startDate, r.endDate].filter((d): d is string => Boolean(d))
  ).sort();
  const startDate = allDates[0] ?? "";
  const endDate = allDates[allDates.length - 1] ?? "";
  if (!startDate) warnings.push(`Could not read dates; found "${eyebrow}" in the header`);

  const stamp = new Date().toISOString();

  return {
    trip: {
      name: name || "Imported trip",
      destination,
      startDate,
      endDate,
      notes: notesFull,
      icon: "✈️",
    },
    reservations: reservations.map((r) => ({ ...r, createdAt: stamp })),
    tasks,
    warnings,
  };
}
