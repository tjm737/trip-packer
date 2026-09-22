/*
 * The account-deletion permission boundary.
 *
 * user.delete was relaxed from admin to selfOrAdmin so a signed-in user can
 * delete their own account, which App Store guideline 5.1.1(v) requires. The
 * relaxation is narrow: the route resolves the TARGET and rejects it unless the
 * caller IS that user or an owner.
 *
 * The failure this guards against is the obvious one — that "anyone can delete
 * themselves" quietly becomes "anyone can delete anyone", by passing someone
 * else's id. That is a single `if`, and it is the whole security boundary, so it
 * gets tested from both sides. A test that only exercises the permitted path
 * would pass just as happily if the check were deleted.
 */
const path = require("path");
const h = require("./harness.cjs");

const SRC = path.join(__dirname, "..", "src", "lib", "opPermissions.ts");
const ROUTE = path.join(__dirname, "..", "src", "app", "api", "mutate", "route.ts");

(async () => {
  const perms = await h.loadModule(SRC);

  await h.test("user.delete is selfOrAdmin, not admin", () => {
    // The exact relaxation 5.1.1(v) depends on. If this reverts to admin, a
    // non-owner has NO way to delete their account in the app at all.
    h.assertEqual(perms.OP_PERMISSIONS["user.delete"].kind, "selfOrAdmin");
  });

  await h.test("user.add stays admin, so deleting yourself cannot mint accounts", () => {
    // Relaxing delete must not have dragged add/add-adjacent ops with it.
    h.assertEqual(perms.OP_PERMISSIONS["user.add"].kind, "admin");
    h.assertEqual(perms.OP_PERMISSIONS["state.replace"].kind, "admin");
  });

  const routeSrc = require("fs").readFileSync(ROUTE, "utf8");

  await h.test("the route resolves the delete target rather than trusting the caller", () => {
    /*
     * Without this the permission is decorative: selfOrAdmin on user.delete
     * would pass for every signed-in user, and nothing downstream would notice
     * that the id belonged to someone else.
     */
    const resolves = /body\.op === "user\.update"\s*\|\|\s*body\.op === "user\.delete"\s*\?\s*body\.id/;
    h.assertEqual(
      resolves.test(routeSrc),
      true,
      "user.delete must be included in the selfOrAdmin target resolution"
    );
  });

  await h.test("the selfOrAdmin branch still refuses a foreign target for non-owners", () => {
    // The actual boundary line. Asserted on source because the check is a
    // guard clause, and a missing guard is invisible at runtime until abused.
    const guard = /targetUserId !== actor\.id && !actor\.isOwner/;
    h.assertEqual(
      guard.test(routeSrc),
      true,
      "non-owners must be refused when the target is not themselves"
    );
  });

  await h.test("the last-account guard survives the relaxation", () => {
    /*
     * The dangerous interaction: a user is now allowed to delete, so the only
     * thing standing between a one-account instance and an unrecoverable state
     * is this guard. It must still exist AND still be evaluated before the
     * delete, not after.
     */
    const guardIdx = routeSrc.indexOf("Cannot delete the last user");
    const deleteIdx = routeSrc.indexOf("t.deleteUser(body.id)");
    h.assertEqual(guardIdx > -1, true, "last-user guard must exist");
    h.assertEqual(deleteIdx > -1, true, "delete must exist");
    h.assertEqual(
      guardIdx < deleteIdx,
      true,
      "guard must run BEFORE the delete, or it prevents nothing"
    );
  });

  await h.test("deleting an account still revokes its sessions", () => {
    // A deleted user holding a live cookie is still logged in. This was true
    // before the relaxation and must remain true after it.
    const idx = routeSrc.indexOf("t.deleteSessionsForUser(body.id)");
    h.assertEqual(idx > -1, true, "delete must cascade to sessions");
  });

  h.summary();
})();
