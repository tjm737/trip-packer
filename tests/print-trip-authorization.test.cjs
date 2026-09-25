/*
 * Regression tests for the /trips/[id]/print authorization bug.
 *
 * THE BUG (fixed, verified by hand against a forged session):
 *
 *   The page guarded with `hasValidSession()` only. That answers "is anyone
 *   signed in", not "may this person read THIS trip". Because `readState()` is
 *   unscoped and returns every account's rows, any signed-in user could render
 *   any other user's full itinerary by requesting its id -- booking reference
 *   codes, addresses and all. A forged second-account session returned HTTP 200
 *   with a fully rendered document.
 *
 * WHY THESE TESTS LOOK THE WAY THEY DO
 *
 *   The behaviour under test is a server component reading SQLite directly.
 *   There is no DOM/React test infrastructure in this repo by design, so an
 *   end-to-end test of the page would not catch the regression it is meant to
 *   catch: deleting the guard does not make `canReadEntityById` fail, it makes
 *   it never get called.
 *
 *   So this file tests two layers, and both are necessary:
 *
 *     1. The DECISION (canReadEntityById) -- that a signed-in non-owner is
 *        genuinely refused another user's trip, including the shared-trip case
 *        and the bare-id cases.
 *     2. The WIRING (source assertions) -- that the page still calls the
 *        decision function, in BOTH the body and generateMetadata, and no
 *        longer relies on a session-only check.
 *
 *   Layer 2 is the one that fails if someone "simplifies" the guard back to
 *   hasValidSession(). It is deliberately a source read, not a render: the
 *   property is "the guard is present and ownership-aware", and a source read
 *   states that directly.
 */

const h = require("./harness.cjs");
const fs = require("node:fs");
const path = require("node:path");

const { canReadEntityById, scopeStateForUser } = h.loadModule("src/lib/access.ts");

const PRINT_PAGE = path.join(__dirname, "..", "src", "app", "trips", "[id]", "print", "page.tsx");

/* -- fixtures -------------------------------------------------------------- */

const OWNER = "user-owner";
const STRANGER = "user-stranger";
const COLLAB = "user-collab";

function fixture({ sharedWith = [] } = {}) {
  const now = new Date().toISOString();
  return {
    users: [
      { id: OWNER, name: "Owner", avatarColor: "bg-zinc-500", createdAt: now, isOwner: false },
      { id: STRANGER, name: "Stranger", avatarColor: "bg-zinc-500", createdAt: now, isOwner: false },
      { id: COLLAB, name: "Collab", avatarColor: "bg-zinc-500", createdAt: now, isOwner: false },
    ],
    trips: [
      { id: "trip-owner", userId: OWNER, name: "Iceland Ring Road", createdAt: now, updatedAt: now },
      { id: "trip-stranger", userId: STRANGER, name: "Own Trip", createdAt: now, updatedAt: now },
    ],
    categories: [{ id: "cat-1", tripId: "trip-owner", name: "Clothing", icon: "👕" }],
    items: [
      { id: "item-1", tripId: "trip-owner", categoryId: "cat-1", name: "Passport", packed: false },
    ],
    reservations: [],
    tasks: [],
    // Grants are what make a trip readable by a non-owner. Shape and field name
    // mirror `tripMembers` as read by roleOnTrip() -- a viewer may read.
    tripMembers: sharedWith.map((userId) => ({
      id: `member-${userId}`,
      tripId: "trip-owner",
      userId,
      role: "viewer",
    })),
  };
}

async function run() {
  /* --------------------------------------------------------------------- */
  /* LAYER 1: the authorization decision                                    */
  /* --------------------------------------------------------------------- */

  await h.test("a signed-in STRANGER cannot read another user's trip", () => {
    // This is the bug. If this ever returns true, the disclosure is back.
    h.assertEqual(
      canReadEntityById(fixture(), STRANGER, "trip", "trip-owner"),
      false
    );
  });

  await h.test("the owner CAN read their own trip", () => {
    h.assertEqual(canReadEntityById(fixture(), OWNER, "trip", "trip-owner"), true);
  });

  await h.test("a signed-in user can read their OWN trip", () => {
    h.assertEqual(
      canReadEntityById(fixture(), STRANGER, "trip", "trip-stranger"),
      true
    );
  });

  await h.test("a user granted access CAN read the shared trip", () => {
    // The check must not be so blunt that it breaks trip sharing.
    const state = fixture({ sharedWith: [COLLAB] });
    h.assertEqual(canReadEntityById(state, COLLAB, "trip", "trip-owner"), true);
  });

  await h.test("a grant on one trip does not open another user's other trips", () => {
    // Collaborator is granted trip-owner but must not also see trip-stranger.
    const state = fixture({ sharedWith: [COLLAB] });
    h.assertEqual(canReadEntityById(state, COLLAB, "trip", "trip-stranger"), false);
  });

  await h.test("a NON-EXISTENT trip id is refused for everyone", () => {
    // Refusal must not depend on the trip existing, or the response
    // distinguishes "not yours" from "not there".
    h.assertEqual(canReadEntityById(fixture(), OWNER, "trip", "trip-does-not-exist"), false);
    h.assertEqual(canReadEntityById(fixture(), STRANGER, "trip", "trip-does-not-exist"), false);
  });

  await h.test("an EMPTY or malformed trip id is refused (not a wildcard)", () => {
    h.assertEqual(canReadEntityById(fixture(), OWNER, "trip", ""), false);
    h.assertEqual(canReadEntityById(fixture(), STRANGER, "trip", "   "), false);
  });

  await h.test("a null / anonymous identity is refused", () => {
    h.assertEqual(canReadEntityById(fixture(), null, "trip", "trip-owner"), false);
    h.assertEqual(canReadEntityById(fixture(), undefined, "trip", "trip-owner"), false);
  });

  await h.test("an UNKNOWN user id is refused, not treated as a wildcard", () => {
    h.assertEqual(canReadEntityById(fixture(), "user-who-does-not-exist", "trip", "trip-owner"), false);
  });

  await h.test("identity alone is never permission (scope is what enforces reads)", () => {
    /*
     * scopeStateForUser is what the API uses; it must drop the other user's
     * trips entirely rather than merely flagging them. If scoping ever became
     * additive, the API would leak even with the page fixed.
     */
    const scoped = scopeStateForUser(fixture(), STRANGER);
    h.assert(scoped !== null, "a known user should get a scoped state, not null");
    const tripIds = scoped.trips.map((t) => t.id);
    h.assert(!tripIds.includes("trip-owner"), "stranger's scope must NOT include another user's trip");
  });

  /* --------------------------------------------------------------------- */
  /* LAYER 2: the wiring -- the guard must still be present and ownership-  */
  /* aware in BOTH the page body and generateMetadata.                      */
  /* --------------------------------------------------------------------- */

  const src = fs.readFileSync(PRINT_PAGE, "utf8");

  /*
   * Strip comments before the structural assertions below.
   *
   * Without this, simply MENTIONING canReadEntityById in a comment satisfies a
   * `src.includes(...)` check. That was verified the hard way: commenting out
   * both calls (`if (false)`) still passed a naive version of this file, i.e.
   * the test was green while the vulnerability was reintroduced. Assertions
   * here must run against code, never prose. The doc comments in this file
   * deliberately name the function, so prose is guaranteed to be present.
   */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^\s*\/\/.*$/gm, "");      // line comments

  /** Count live (non-comment) calls of fn. */
  const liveCalls = (fn) => (code.match(new RegExp(`\\b${fn}\\s*\\(`, "g")) || []).length;

  await h.test("the print page still CALLS the ownership check (live code, not a comment)", () => {
    h.assert(
      liveCalls("canReadEntityById") >= 2,
      "expected live canReadEntityById() calls in BOTH generateMetadata and the body; " +
        `found ${liveCalls("canReadEntityById")}. A comment mentioning it does not count.`
    );
  });

  await h.test("the ownership check actually GATES a refusal (not dead code)", () => {
    /*
     * A call whose result is ignored is not a guard. Require the call to appear
     * as the operand of an `if` and be negated, which is the only shape that
     * can refuse. This is what catches `if (false)` / a dropped `!`.
     */
    const gated = /if\s*\([^)]*!\s*canReadEntityById\s*\(/.test(code);
    h.assert(
      gated,
      "canReadEntityById must be negated inside an if() so that a refusal is possible"
    );
    h.assert(
      !/if\s*\(\s*false\s*\)/.test(code),
      "an `if (false)` guard is a disabled guard"
    );
  });

  await h.test("the print page no longer relies on hasValidSession (live code)", () => {
    h.assertEqual(
      liveCalls("hasValidSession"),
      0,
      "page must not fall back to a session-only guard"
    );
  });

  await h.test("the print page resolves the acting user (live code)", () => {
    h.assert(
      liveCalls("getActingUser") >= 2,
      "page must know WHO is asking, in both generateMetadata and the body"
    );
  });

  await h.test("generateMetadata is guarded too, not just the body", () => {
    /*
     * generateMetadata resolves BEFORE the body's redirect and is a separate
     * unguarded read in the original bug, which leaked the trip NAME via
     * <title> even on a response that otherwise redirected. Count the guard so
     * a future edit cannot quietly fix only the body.
     */
    const occurrences = liveCalls("canReadEntityById");
    h.assert(
      occurrences >= 2,
      `expected the ownership guard in BOTH generateMetadata and the body; found ${occurrences} call(s)`
    );
  });

  await h.test("a refused request renders an indistinguishable 'not available'", () => {
    // A redirect would reveal that the trip exists but belongs to someone else.
    h.assert(
      src.includes("Trip not available"),
      "refusal must be a generic not-available page"
    );
  });

  return h.summary();
}

run();
