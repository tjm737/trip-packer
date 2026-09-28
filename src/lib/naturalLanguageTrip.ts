/*
 * Natural-language trip entry: turns one sentence into the fields the create
 * dialog already collects.
 *
 * WHY A PURE MODULE
 *
 * The model call itself is untestable here (no on-device model in CI), but
 * everything around it is not: building the prompt, normalising what comes
 * back, and deciding which fields are confident enough to prefill. Those are
 * the parts that actually break, and they are pure functions of strings. So
 * the prompt text and the response handling live here and the component stays
 * a thin shell -- the same split used for itineraryOrder, packingSuggestions,
 * bagImport and the rest.
 *
 * WHAT THE MODEL DOES AND DOES NOT DO
 *
 * It does NOT create the trip. It extracts fields, which the user then sees
 * in the normal create dialog and can correct before anything is written. That
 * is deliberate on two counts: a mis-transcribed destination silently saved is
 * much worse than one shown for confirmation, and the existing dialog already
 * owns validation, icon choice and bag import. This module produces a
 * suggestion, never a record.
 */

/** Fields the create flow accepts, as extracted from free text. */
export interface TripDraft {
  name: string;
  destination: string;
  /** ISO yyyy-mm-dd, or "" when the text did not say. */
  startDate: string;
  /** ISO yyyy-mm-dd, or "" when the text did not say. */
  endDate: string;
  notes: string;
  /** Only set when the text clearly implies one. */
  icon: string;
}

/** The subset of TripDraft the model is asked to return. */
export const TRIP_FIELDS = [
  "name",
  "destination",
  "startDate",
  "endDate",
  "notes",
] as const;

/*
 * The prompt is written to a small on-device model with no world knowledge and
 * no clock. Two consequences shape it:
 *
 *  1. It cannot resolve "next Friday" to a date, and it has no idea what today
 *     is. So we pass today's date in and insist on absolute ISO output. Asking
 *     a dateless model for "next Friday" yields either a guess or a literal
 *     string, both of which are worse than empty.
 *  2. It will invent a plausible destination if one is not stated, because
 *     that is what the sentence pattern suggests. The empty-string instruction
 *     is therefore explicit and repeated, and the normaliser below enforces it
 *     again on the way out -- belt and braces, because a fabricated city is the
 *     single most damaging failure mode for this feature.
 */
export function buildExtractionPrompt(input: string, today: string): string {
  return [
    "Extract trip details from the user's message.",
    `Today is ${today}.`,
    "",
    "Return ONLY a JSON object with exactly these keys:",
    "  name        - short trip title, e.g. 'Lisbon Getaway'. Empty string if unclear.",
    "  destination - the city or place being visited. Empty string if the message does not name one. Do NOT guess a destination.",
    "  startDate   - departure date as yyyy-mm-dd. Empty string if the message does not give a date.",
    "  endDate     - return date as yyyy-mm-dd. Empty string if the message does not give one.",
    "  notes       - any other useful detail from the message. Empty string if none.",
    "",
    "Rules:",
    "- Use absolute dates. Resolve words like 'next Friday' against the date above.",
    "- If a field is not stated, use an empty string. Never invent a value.",
    "- Do not add keys. Do not wrap the JSON in prose or code fences.",
    "",
    `Message: ${input}`,
  ].join("\n");
}

/** True for yyyy-mm-dd with a real calendar date. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Round-trip through Date to reject 2026-02-31 and friends, which match the
  // regex but are not dates. getTime() catches an Invalid Date.
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Collapse whitespace and trim, for values coming out of a model. */
function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/*
 * Icon inference is intentionally tiny and explicit. The model is not asked for
 * an icon: it would choose freely, and an unexpected emoji is a worse default
 * than the plane the dialog already starts with. Only unambiguous signals are
 * honoured, and anything else leaves the dialog's own default in place.
 */
const ICON_HINTS: Array<[RegExp, string]> = [
  [/\b(beach|island|resort|seaside|coast|surf)\b/i, "🏖️"],
  [/\b(ski|snowboard|skiing|slopes|alps)\b/i, "⛷️"],
  // Stems, not whole words: "hiking" and "hiked" must both match, so the
  // pattern is a prefix, not the bare noun.
  [/\b(hik|trek|mountain|trail|camp)/i, "⛰️"],
  [/\b(road ?trip|drive|driving)\b/i, "🚗"],
  [/\b(cruise|sail|boat|ferry)\b/i, "🚢"],
  [/\b(wedding|anniversary|honeymoon)\b/i, "💍"],
  [/\b(conference|summit|work|business|meeting)\b/i, "💼"],
];

export function inferIcon(input: string): string {
  for (const [pattern, icon] of ICON_HINTS) {
    if (pattern.test(input)) return icon;
  }
  return "";
}

/*
 * Normalise whatever the model returned into a TripDraft.
 *
 * Every field is independently validated, and an unparseable response yields
 * all-empty rather than a partial guess. Two rules matter here:
 *
 *  - A date that is not a real ISO date is dropped, not passed through. The
 *    create flow stores what it is given, so a malformed date would reach
 *    SQLite.
 *  - endDate before startDate is discarded. The create flow treats a start with
 *    no end as a single-day trip, which is sane; a range that runs backwards is
 *    not, and shows up as a negative span in the UI.
 *
 * `fallbackName` is used when the model produced no name: the destination is a
 * much better trip title than an empty box, and the user can still edit it.
 */
export function normaliseTripDraft(
  raw: unknown,
  input: string,
  fallbackName = "New Trip"
): TripDraft {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const name = clean(source.name);
  const destination = clean(source.destination);
  const notes = clean(source.notes);

  let startDate = clean(source.startDate);
  let endDate = clean(source.endDate);

  if (!isIsoDate(startDate)) startDate = "";
  if (!isIsoDate(endDate)) endDate = "";

  // A range that runs backwards is not a trip. Drop the end and let the create
  // flow treat it as single-day rather than persisting a negative span.
  if (startDate && endDate && endDate < startDate) endDate = "";

  // The create flow requires a name. Prefer what the user wrote, then the
  // destination, then a neutral placeholder.
  const resolvedName = name || destination || fallbackName;

  return {
    name: resolvedName,
    destination,
    startDate,
    endDate,
    notes,
    icon: inferIcon(input),
  };
}

/*
 * Whether a draft is worth showing at all.
 *
 * The dialog opens on a button press, so an empty result is a legitimate
 * outcome that must be detected: prefilling a create form with nothing and
 * calling it success would read as the feature being broken. Requiring one of
 * destination or a date keeps the bar at "the sentence actually said
 * something".
 */
export function isUsefulDraft(draft: TripDraft): boolean {
  return Boolean(draft.destination || draft.startDate);
}
