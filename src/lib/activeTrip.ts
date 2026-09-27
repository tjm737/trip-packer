/*
 * Works out which trip, if any, the current route is showing.
 *
 * Extracted from the sidebar as a pure function so it can be tested without a
 * DOM or a router. The sidebar is global chrome — it renders on the landing
 * page, the profile screen and every trip screen alike — while Print and
 * Calendar are properties of ONE trip. Deciding whether to draw them is
 * therefore entirely a question about the path, and that question has edge
 * cases worth pinning down in tests rather than discovering in the UI.
 *
 * SHAPE OF THE ROUTE
 *
 *   /trips/abc123            -> "abc123"
 *   /trips/abc123/print      -> "abc123"   (the print preview is still that trip)
 *   /trips/abc123/map        -> "abc123"
 *   /trips/abc123/anything   -> "abc123"   (any future sub-route, for free)
 *   /trips                   -> null       (the list, not a trip)
 *   /trips/                  -> null
 *   /                        -> null       (landing page)
 *   /profile                 -> null
 *   /share/abc123            -> null       (deliberate: see below)
 *
 * WHY AN EMPTY SEGMENT IS REJECTED RATHER THAN COERCED
 *
 * "/trips//print" has no id. Naively reading segments[1] would yield "" and
 * produce links to /api/trips//calendar.ics, which is a 404 dressed up as a
 * working button. Returning null means no buttons are drawn, which is the
 * honest outcome for a route that names no trip.
 *
 * WHY /share/[token] IS EXCLUDED, DESPITE BEING A TRIP VIEW
 *
 * A shared trip is addressed by an opaque TOKEN, not a trip id, and the token
 * deliberately does not resolve to the trip's real id on the client (the whole
 * point of the share link is that it grants read access without revealing the
 * trip's identity). The API routes these buttons call are keyed by trip id, so
 * there is nothing valid to point them at. The share page already offers its
 * own export affordances for exactly this reason; the sidebar must not
 * fabricate links it cannot honour.
 */
export function activeTripIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;

  // Strip query and hash defensively: callers pass a pathname, but a raw
  // location string would otherwise produce an id with "?foo=1" glued to it.
  const path = pathname.split("?")[0].split("#")[0];

  /*
   * Split WITHOUT dropping empty segments. An earlier revision filtered them
   * out, which silently rewrote "/trips//print" into "/trips/print" — and that
   * does not fail loudly, it resolves the id to the literal string "print" and
   * builds links to /api/trips/print/calendar.ics. A plausible-looking control
   * aimed at the wrong trip is worse than no control, so the empty segment has
   * to survive to the check below rather than being tidied away.
   *
   * Leading and trailing slashes do still need to go, or "/trips/abc123/" would
   * leave a trailing "" and shift nothing (harmless here, but the id check
   * should see a clean list).
   */
  const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) return null;

  const segments = trimmed.split("/");

  // ["trips", "<id>", ...] — the list route (/trips) has no second segment.
  if (segments.length < 2) return null;
  if (segments[0] !== "trips") return null;

  const id = segments[1];

  // Decoded so a percent-encoded id compares equal to the raw one the rest of
  // the app uses. A malformed escape sequence throws, and a route we cannot
  // parse is a route we cannot build links for.
  let decoded: string;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    return null;
  }

  return decoded.length > 0 ? decoded : null;
}
