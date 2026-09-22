/*
 * Packing suggestions from the on-device model.
 *
 * Split into a pure half (prompt building + response normalising) and a thin
 * IO half, so the interesting logic is testable in Node with no native bridge
 * present. The IO half is deliberately the boring part.
 *
 * The contract that matters: this module only ever PRODUCES candidates. It
 * never writes to the packing list. Adding is the user's click, handled by the
 * calling component -- a model that silently edits the user's list is a bug,
 * not a feature.
 */

/** A single candidate the user may choose to add. */
export interface PackingSuggestion {
  name: string;
  /** Short reason, shown under the name. Optional -- the model may omit it. */
  reason?: string;
}

export interface SuggestContext {
  /** Trip destination, e.g. "Tokyo, Japan". */
  destination: string;
  /** Trip length in days, when known. */
  days?: number;
  /** Month the trip starts, 1-12, when known. Drives climate reasoning. */
  month?: number;
  /** Names already on the list, so the model avoids re-suggesting them. */
  existing?: string[];
}

/** How many suggestions to ask for. Enough to be useful, few enough to scan. */
export const MAX_SUGGESTIONS = 12;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Describe the trip in one compact line.
 *
 * Kept terse on purpose: the on-device model has a small context window, and
 * padding the prompt with prose measurably degrades output on short prompts.
 * Only facts the user actually gave are included -- an invented "beach trip"
 * would steer the model toward irrelevant items.
 */
export function describeTrip(ctx: SuggestContext): string {
  const parts: string[] = [];
  const dest = ctx.destination?.trim();
  if (dest) parts.push(dest);
  if (typeof ctx.days === "number" && ctx.days > 0) {
    parts.push(`${ctx.days} day${ctx.days === 1 ? "" : "s"}`);
  }
  if (typeof ctx.month === "number" && ctx.month >= 1 && ctx.month <= 12) {
    parts.push(`in ${MONTHS[ctx.month - 1]}`);
  }
  return parts.join(", ");
}

/**
 * Build the prompt for the on-device model.
 *
 * Two constraints are stated explicitly because the model otherwise ignores
 * them: do not repeat what is already packed, and return JSON only. The
 * existing-item list is capped -- a long list pushes the instruction out of
 * the small context window, so the tail is dropped rather than the rule.
 */
export function buildPackingPrompt(ctx: SuggestContext, existing: string[] = []): string {
  const trip = describeTrip(ctx) || "an unspecified trip";
  const seen = existing
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);

  const lines = [
    `Suggest ${MAX_SUGGESTIONS} things to pack for a trip to ${trip}.`,
    "Prefer specific, useful items over generic ones.",
    `Return JSON only, shaped exactly like: {"items":[{"name":"...","reason":"..."}]}`,
    `Include at most ${MAX_SUGGESTIONS} items. Do not invent activities.`,
  ];

  if (seen.length > 0) {
    lines.push(`Do not suggest any of these, already packed: ${seen.join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * Whether a suggestion may be added right now.
 *
 * This is the click-time gate, and it exists because the list can change
 * between generating suggestions and clicking one: another tab, a sync, or an
 * earlier click in the same session. Returns the reason rather than a bare
 * boolean so the caller can distinguish "nothing to do" (already present)
 * from "not a usable item" (blank), and so this decision is testable without
 * rendering the component.
 *
 * Deliberately does NOT consult `existing` from generate time -- only the
 * live list -- because the stale copy is exactly what would let a duplicate
 * through.
 */
export function addability(
  suggestionName: string,
  isAlreadyOnList: boolean
): "ok" | "blank" | "duplicate" {
  if (!suggestionName.trim()) return "blank";
  if (isAlreadyOnList) return "duplicate";
  return "ok";
}

/**
 * Normalise a raw model response into suggestions.
 *
 * Tolerant by necessity: the model may return `{items:[...]}`, a bare array
 * as the object's only value, or entries as plain strings. Anything without a
 * usable non-empty name is dropped rather than rendered as a blank row.
 *
 * Deduplicates case-insensitively against both itself and `existing`, so a
 * model that ignores the "already packed" instruction cannot produce a
 * suggestion the user already has.
 */
export function normalizeSuggestions(
  raw: unknown,
  existing: string[] = []
): PackingSuggestion[] {
  const entries = extractArray(raw);
  if (!entries) return [];

  const taken = new Set(existing.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const out: PackingSuggestion[] = [];

  for (const entry of entries) {
    const item = toSuggestion(entry);
    if (!item) continue;

    const key = item.name.toLowerCase();
    if (taken.has(key)) continue;
    taken.add(key);

    out.push(item);
    if (out.length >= MAX_SUGGESTIONS) break;
  }

  return out;
}

/** Pull the array of candidates out of whatever shape the model produced. */
function extractArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Record<string, unknown>;
  // The prompted key first, then the usual near-misses, then a single array
  // value of any name -- models rename the key often.
  for (const key of ["items", "suggestions", "packingList", "list"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  const arrays = Object.values(obj).filter(Array.isArray);
  return arrays.length === 1 ? (arrays[0] as unknown[]) : null;
}

/** Coerce one entry into a suggestion, or null when it has no usable name. */
function toSuggestion(entry: unknown): PackingSuggestion | null {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const rec = entry as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name.trim()
    : typeof rec.item === "string" ? rec.item.trim()
    : "";
  if (!name) return null;

  const rawReason = typeof rec.reason === "string" ? rec.reason.trim()
    : typeof rec.why === "string" ? rec.why.trim()
    : "";

  return rawReason ? { name, reason: rawReason } : { name };
}
