/*
 * Usage metrics — the parts that are decisions rather than plumbing.
 *
 * Split out from the route for the same reason as every other lib module in
 * this repo: the route is a request handler with no assertion surface, and the
 * rules that matter here (what counts as a valid event name, what may never be
 * stored, how a batch is capped) are exactly the rules that fail silently. A
 * metric that is dropped looks identical to a feature nobody used.
 *
 * Design stance, stated once: this is a COUNTING system, not a tracking system.
 * There is no visitor id, no IP, no user agent, no referrer, no free-form
 * string field. That is enforced structurally — `sanitizeMeta` whitelists
 * primitives under a length cap and drops everything else — rather than by
 * convention, because a convention is what gets violated the first time someone
 * wants "just one more field".
 */

/** Longest accepted event name. Names are ours, not the client's. */
export const MAX_NAME_LENGTH = 64;

/** Longest accepted session id. Ours too — a random 32-char hex string. */
export const MAX_SESSION_ID_LENGTH = 64;

/**
 * Most events accepted in one request.
 *
 * A batch cap is not about saving bytes; it is the thing that stops a
 * compromised client (or a bug in a retry loop) from writing unbounded rows in
 * a single call. Batches arrive on page unload, when several events queue at
 * once, so the cap is well above a plausible flush.
 */
export const MAX_BATCH = 50;

/**
 * Most meta keys kept per event, and the longest a meta value may be.
 *
 * Small on purpose. Meta exists for counts and booleans ("which tab"), not for
 * describing anything. Anything that would need more room than this is
 * something that should not be recorded at all.
 */
export const MAX_META_KEYS = 8;
export const MAX_META_VALUE_LENGTH = 120;
/** Longest meta key kept. Keys are ours, so anything longer is a bug or an attack. */
export const MAX_META_KEY_LENGTH = 40;

/**
 * Retained per-event counts, oldest dropped first.
 *
 * ⚠️ This is the ENTIRE allowlist. `isKnownEvent` is a membership test against
 * it, so a typo'd or invented name is rejected at the boundary instead of
 * quietly creating a new series that nobody will ever look at. Adding an event
 * means adding it here — which is the point: the deliberate step is what keeps
 * the table readable.
 */
export const KNOWN_EVENTS = [
  "app_open",
  "page_view",
  "trip_created",
  "trip_deleted",
  "feature_opened",
  "pull_to_refresh",
  "offline_detected",
  "share_created",
  "print_opened",
  "calendar_exported",
  "login_succeeded",
  "login_failed",
  "error",
] as const;

export type KnownEvent = (typeof KNOWN_EVENTS)[number];

const KNOWN = new Set<string>(KNOWN_EVENTS);

export function isKnownEvent(name: unknown): name is KnownEvent {
  return typeof name === "string" && KNOWN.has(name);
}

/**
 * Event names that must never be sent by the client.
 *
 * `login_succeeded` / `login_failed` are recorded server-side, where the
 * outcome is actually known. A client could report either one honestly or not;
 * the server is the only witness that cannot be wrong about it, so the client's
 * version is refused rather than trusted. Without this an attacker with a valid
 * session could pad the login counters and make the sign-in path look either
 * healthier or more broken than it is.
 */
const SERVER_ONLY = new Set<string>(["login_succeeded", "login_failed"]);

export function isServerOnlyEvent(name: string): boolean {
  return SERVER_ONLY.has(name);
}

export interface MetricEvent {
  name: string;
  sessionId?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Keep only primitives that are safe and useful to count.
 *
 * Strings are truncated rather than rejected: a too-long value is almost always
 * a route path or a label, and dropping the whole event over it would lose a
 * real data point to a cosmetic problem. Arrays and objects are dropped whole,
 * because a nested structure is how an identifier gets smuggled in.
 *
 * `null` and `undefined` are dropped: "absent" and "explicitly empty" are the
 * same fact for counting purposes, and storing both invites a distinction
 * nobody will remember the meaning of.
 */
export function sanitizeMeta(
  meta: unknown
): Record<string, string | number | boolean> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;

  const out: Record<string, string | number | boolean> = {};
  let kept = 0;

  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (kept >= MAX_META_KEYS) break;
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_META_KEY_LENGTH) continue;

    if (typeof value === "string") {
      out[key] = value.slice(0, MAX_META_VALUE_LENGTH);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      // numbers that are NaN/Infinity, arrays, objects, null, undefined, and
      // functions all land here and are dropped.
      continue;
    }
    kept++;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export interface SanitizedEvent {
  name: KnownEvent;
  sessionId: string | null;
  meta: Record<string, string | number | boolean> | null;
}

/**
 * Meta keys whose string value is treated as a route path and normalised.
 *
 * Applied on INGEST, not only on send. The client already normalises before it
 * calls `track`, but that is the sender's promise, not a guarantee: anyone can
 * POST this endpoint with curl. A first version normalised only client-side and
 * a raw `/trips/abc123` was written straight to the table — the id the whole
 * design exists to avoid storing. The boundary is the server; normalising there
 * is what makes the guarantee real rather than aspirational.
 */
const PATH_META_KEYS = new Set(["path", "from", "to"]);

/**
 * Validate and clean a single event.
 *
 * Returns null rather than throwing for anything unacceptable, so the caller
 * never needs a try/catch around attacker-supplied input.
 *
 * Note this is a MEMBERSHIP test against the allowlist, not a property lookup:
 * `KNOWN.has()` is used rather than `obj[name]`, so inherited names like
 * `constructor` and `__proto__` cannot become valid series.
 */
export function sanitizeEvent(raw: unknown): SanitizedEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const candidate = raw as MetricEvent;
  const name = candidate.name;

  // Server-only events are refused here as well as in the batch path: this
  // function is exported, so a future caller reaching for it directly must not
  // be able to bypass the trust boundary.
  if (!isKnownEvent(name) || isServerOnlyEvent(name)) return null;

  const sessionId =
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    candidate.sessionId.length <= MAX_SESSION_ID_LENGTH
      ? candidate.sessionId
      : null;

  const meta = sanitizeMeta(candidate.meta);

  // Re-normalise any path-shaped value, so an id cannot arrive by being
  // hand-crafted into the request body.
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (!PATH_META_KEYS.has(key)) continue;
      const value = meta[key];
      if (typeof value === "string") meta[key] = normalizePath(value);
    }
  }

  return { name, sessionId, meta };
}

/**
 * Validate and clean a batch from the client.
 *
 * Returns only the events that survive; never throws on bad input. A malformed
 * entry is dropped rather than 400-ing the whole batch, because a batch is
 * flushed on unload and a single bad event would otherwise take good ones with
 * it. The caller gets a count of what was rejected so it can be logged.
 *
 * Bounded by MAX_BATCH before any per-event work, so a huge payload costs a
 * slice rather than a loop.
 */
export function sanitizeBatch(input: unknown): {
  events: SanitizedEvent[];
  rejected: number;
} {
  if (!Array.isArray(input)) return { events: [], rejected: 0 };

  const events: SanitizedEvent[] = [];

  /*
   * Truncated, not rejected. The input is capped to MAX_BATCH first, so the
   * write is bounded; everything beyond the cap counts as rejected so the
   * caller's log reflects that events were genuinely dropped.
   */
  const capped = input.slice(0, MAX_BATCH);
  let rejected = Math.max(0, input.length - capped.length);

  for (const raw of capped) {
    const event = sanitizeEvent(raw);
    if (event) {
      events.push(event);
    } else {
      rejected++;
    }
  }

  return { events, rejected };
}

/**
 * Turn a pathname into something countable without recording the user's trip
 * ids. Trip pages become `/trips/:id` so the shape of usage is visible without
 * the table becoming a log of which trips exist.
 *
 * ⚠️ The id patterns are SHAPE-BASED, not length-based alone. A first version
 * required 8+ hex characters, which let `generateId()`'s real output straight
 * through — this app's ids are short base36, so `/trips/abc123` was stored
 * verbatim. Any segment under a known parent is now replaced regardless of
 * length, and opaque segments are matched by length as a second net.
 */
export function normalizePath(pathname: string): string {
  if (typeof pathname !== "string") return "/";

  // Strip query and hash: both can carry identifiers.
  const path = pathname.split("?")[0].split("#")[0];

  const segments = path.split("/").filter(Boolean);

  /*
   * Routes whose first segment is a fixed word and whose second segment is
   * always an id. Listing them explicitly is the reliable approach: a
   * heuristics-only pass cannot distinguish `/trips/abc123` from a real static
   * route, and guessing wrong either leaks an id or fragments the report.
   */
  const ID_PARENTS = new Set(["trips", "share", "bags"]);

  const shaped = segments.map((seg, i) => {
    if (i > 0 && ID_PARENTS.has(segments[i - 1])) return ":id";
    // Second net: long opaque tokens anywhere else (uuids, cuids, tokens).
    if (/^[0-9a-fA-F-]{16,}$/.test(seg)) return ":id";
    if (/^[A-Za-z0-9_-]{24,}$/.test(seg)) return ":id";
    return seg;
  });

  const out = "/" + shaped.join("/");

  // Collapse the "///" and "no-leading-slash" cases to a clean absolute path.
  const cleaned = out === "/" ? "/" : out.replace(/\/+/g, "/");

  return cleaned.slice(0, MAX_META_VALUE_LENGTH) || "/";
}

/**
 * A stable "is this the same sitting" bucket for a timestamp.
 *
 * Used only for grouping counts by day, which is why it takes the ISO string
 * rather than a Date: every stored timestamp in this app is ISO, and formatting
 * a Date would introduce a timezone question that the storage layer has already
 * settled.
 */
export function dayBucket(iso: string): string {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}
