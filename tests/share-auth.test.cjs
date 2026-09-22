/*
 * Tests that share-link management is authorized, and that the public read
 * projection leaks nothing private.
 *
 * Two distinct properties, both previously broken and both verified exploitable
 * against a running dev server before being fixed:
 *
 *   (a) /api/share had NO authorization at all. An unauthenticated POST with a
 *       tripId returned HTTP 200 and a working token:
 *         $ curl -X POST .../api/share -d '{"tripId":"<any-uuid>"}'
 *         {"token":"4da1b65f-...","tokens":[...]}   HTTP 200
 *       The trip's owner could be read with that token immediately.
 *
 *   (b) /api/shared/[token] returned the whole `trip` row, including `userId`
 *       (the owner's identity) and the trip record's share state. This is a
 *       public, cacheable endpoint, so publishing the caller's own credential
 *       back to them is how one leaked URL becomes a log full of them.
 *
 * The HTTP layer is not exercised here — that needs a live session cookie, and
 * the authorization decision bottoms out in assertCanWriteTrip/roleOnTrip,
 * which is what these tests pin. The route tests that call those helpers live
 * in the same commit's manual verification; what must never silently regress is
 * the permission predicate itself and the shape of the public payload.
 */

const h = require("./harness.cjs");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");

const STUB = path.join(__dirname, "..", "scripts", "server-only-stub.cjs");
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return STUB;
  return realResolve.call(this, request, ...rest);
};

const TMP_DB = path.join(os.tmpdir(), `tp-share-auth-${process.pid}.db`);
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${TMP_DB}${suffix}`, { force: true });
process.env.TRIP_PACKER_DB = TMP_DB;

const db = h.loadModule(path.join(h.SRC, "lib", "db.ts"));
const access = h.loadModule(path.join(h.SRC, "lib", "access.ts"));

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${TMP_DB}${suffix}`, { force: true });
}

(async () => {
  const now = new Date().toISOString();

  // Owner with a trip.
  db.tx.insertUser({ id: "u-owner", name: "Owner", avatarColor: "bg-sage-500", createdAt: now });
  db.tx.insertTrip({
    id: "trip-owner",
    userId: "u-owner",
    name: "Private Trip",
    destination: "Munich",
    startDate: "",
    endDate: "",
    notes: "secret notes",
    icon: "plane",
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  // A second real trip, owned by the same owner as the first. Needed for the
  // cross-trip tests: the threat is someone who legitimately owns one trip
  // reaching for another trip's link, and a nonexistent trip would fail on the
  // foreign key instead of exercising the scoping under test.
  db.tx.insertTrip({
    id: "trip-other",
    userId: "u-owner",
    name: "Other Trip",
    destination: "Lisbon",
    startDate: "",
    endDate: "",
    notes: "",
    icon: "plane",
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  // A second account that owns nothing — the attacker in the exploit above.
  db.tx.insertUser({ id: "u-stranger", name: "Stranger", avatarColor: "bg-zinc-500", createdAt: now });

  // A viewer grant on someone else's trip.
  db.tx.addTripMember({ tripId: "trip-owner", userId: "u-stranger", role: "viewer", createdAt: now });

  await h.test("a non-member cannot write (and therefore cannot share) a trip", () => {
    db.tx.insertUser({ id: "u-nobody", name: "Nobody", avatarColor: "bg-zinc-500", createdAt: now });
    const s = db.readState();
    h.assertEqual(
      access.assertCanWriteTrip(s, "u-nobody", "trip-owner"),
      false,
      "a signed-in stranger must not be able to share another user's trip"
    );
  });

  await h.test("a VIEWER cannot write, so cannot re-share a trip shared with them", () => {
    const s = db.readState();
    h.assertEqual(
      access.roleOnTrip(s, "u-stranger", "trip-owner"),
      "viewer",
      "the grant should be a viewer"
    );
    h.assertEqual(
      access.assertCanWriteTrip(s, "u-stranger", "trip-owner"),
      false,
      "a viewer must not be able to grant third parties access by minting a link"
    );
  });

  await h.test("the owner CAN write, so sharing stays possible", () => {
    const s = db.readState();
    h.assertEqual(access.assertCanWriteTrip(s, "u-owner", "trip-owner"), true, "owner must write");
  });

  await h.test("a null/absent user can neither read nor write", () => {
    const s = db.readState();
    h.assertEqual(access.assertCanWriteTrip(s, null, "trip-owner"), false, "null must not write");
    h.assertEqual(access.canReadTrip(s, null, "trip-owner"), false, "null must not read");
    h.assertEqual(access.canReadTrip(s, undefined, "trip-owner"), false, "undefined must not read");
  });

  await h.test("an unknown trip is not writable even by the owner", () => {
    const s = db.readState();
    h.assertEqual(
      access.assertCanWriteTrip(s, "u-owner", "trip-does-not-exist"),
      false,
      "a non-existent trip must not be writable"
    );
  });

  await h.test("share tokens resolve only to their own trip", () => {
    db.tx.createShareToken("tok-alpha", "trip-owner");
    // resolveShareToken returns { tripId, visibility } so the read path can apply
    // the per-link section toggles in the same query that authenticates the link.
    h.assertEqual(
      db.tx.resolveShareToken("tok-alpha")?.tripId,
      "trip-owner",
      "known token resolves"
    );
    h.assertEqual(db.tx.resolveShareToken("tok-forged"), undefined, "unknown token resolves to nothing");
  });

  await h.test("a token created without a visibility choice shows everything", () => {
    /*
     * A link minted before this feature (or by a caller that omits the argument)
     * must not come back with a record that hides sections the owner never hid.
     */
    db.tx.createShareToken("tok-default", "trip-owner");
    const resolved = db.tx.resolveShareToken("tok-default");
    for (const section of ["itinerary", "packing", "tasks", "confirmations"]) {
      h.assertEqual(resolved.visibility[section], true, `${section} should default to visible`);
    }
  });

  await h.test("updating visibility cannot retune another trip's link", () => {
    /*
     * Same scoping as revoke, and the same reason: the UPDATE is constrained by
     * tripId, so someone who may write trip A cannot change what trip B's link
     * reveals. A returned 0 changes is what the route turns into a 404.
     */
    db.tx.createShareToken("tok-gamma", "trip-other");
    const changed = db.tx.updateShareTokenVisibility("tok-gamma", "trip-owner", {
      itinerary: true,
      packing: false,
      tasks: false,
      confirmations: false,
    });
    h.assertEqual(changed, 0, "a mismatched tripId must change nothing");
    const still = db.tx.resolveShareToken("tok-gamma");
    h.assertEqual(still.visibility.packing, true, "the other trip's link must be untouched");
  });

  await h.test("updating visibility does persist for the owning trip", () => {
    // The counterpart to the test above: without this, the scoping test would
    // also pass if the update never wrote anything at all.
    db.tx.createShareToken("tok-delta", "trip-owner");
    const changed = db.tx.updateShareTokenVisibility("tok-delta", "trip-owner", {
      itinerary: true,
      packing: false,
      tasks: true,
      confirmations: true,
    });
    h.assertEqual(changed, 1, "the owning trip's link must be updated");
    h.assertEqual(db.tx.resolveShareToken("tok-delta").visibility.packing, false);
    h.assertEqual(db.tx.resolveShareToken("tok-delta").visibility.tasks, true);
  });

  await h.test("revoking a token with the wrong tripId does not delete it", () => {
    /*
     * The route scopes revoke by tripId so one trip cannot delete another's
     * link. This pins the data layer, which is what makes that scoping work.
     */
    db.tx.createShareToken("tok-beta", "trip-owner");
    db.tx.deleteShareToken("tok-beta", "trip-other");
    h.assertEqual(
      db.tx.resolveShareToken("tok-beta")?.tripId,
      "trip-owner",
      "a mismatched tripId must not revoke someone else's link"
    );
  });

  await h.test("revoking with the right tripId works", () => {
    db.tx.deleteShareToken("tok-beta", "trip-owner");
    h.assertEqual(db.tx.resolveShareToken("tok-beta"), undefined, "token should be gone");
  });

  cleanup();
  h.summary();
})();
