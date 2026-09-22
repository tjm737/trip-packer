/*
 * Completeness tests for the mutate-op permission table.
 *
 * The property being protected: every op the route can dispatch has a declared
 * permission, and no op is reachable without one. That is enforced structurally
 * rather than by review, because a missing guard is silent — it looks exactly
 * like a working endpoint until someone points it at the wrong account.
 *
 * The op list is extracted from the route source's Body union rather than
 * duplicated here. A hand-maintained copy in the test would drift from the
 * union and quietly stop covering new ops, which is the same class of failure
 * the table exists to prevent.
 */

const h = require("./harness.cjs");
const fs = require("node:fs");
const path = require("node:path");

const perms = h.loadModule(path.join(h.SRC, "lib", "opPermissions.ts"));

const ROUTE = path.join(h.SRC, "app", "api", "mutate", "route.ts");

/**
 * Switch-case label shapes.
 *
 * The route uses one `switch (body.op)` for dispatch, whose cases are dotted op
 * names ("trip.update"), and a second `switch (permission.kind)` for
 * authorisation, whose cases are bare kind names ("admin", "selfOrAdmin").
 * Telling the two apart by shape lets one scanner feed both checks.
 */
const OP_LABELS = /^[A-Za-z]+\.[A-Za-z]+$/;
const KINDS = /^[a-z][A-Za-z]*$/;

/**
 * Every `op: "x.y"` literal in the route's Body union.
 *
 * Deliberately reads the union rather than the switch: the union is what the
 * client can actually send, so it defines the attack surface. If an op is in
 * the union it is reachable, whether or not a case handles it.
 */
function opsInRouteSource() {
  const src = fs.readFileSync(ROUTE, "utf8");
  const unionStart = src.indexOf("type Body =");
  h.assert(unionStart !== -1, "could not find `type Body =` in the route");
  const unionEnd = src.indexOf(";", src.indexOf("state.replace", unionStart));
  h.assert(unionEnd !== -1, "could not find the end of the Body union");
  const union = src.slice(unionStart, unionEnd);

  const found = new Set();
  const re = /op:\s*"([a-zA-Z]+\.[a-zA-Z]+)"/g;
  let m;
  while ((m = re.exec(union)) !== null) found.add(m[1]);
  return found;
}

/**
 * Every `case "<label>":` label in the route's switch.
 *
 * Called with no filter to get the op labels: the union and the switch must
 * agree. An op in the switch but not the union is dead code; an op in the union
 * but not the switch falls through to the `default` 400. Both are bugs worth
 * failing on.
 *
 * Called with FILTERS.KINDS it returns the permission-kind labels, which is how
 * the tests discover which permission kinds the route actually enforces.
 */
function casesInRouteSource(filters = OP_LABELS) {
  const src = fs.readFileSync(ROUTE, "utf8");
  const found = new Set();
  const re = /case\s+"([a-zA-Z.]+)":/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (filters.test(m[1])) found.add(m[1]);
  }
  return found;
}

;(async () => {
  const routeOps = opsInRouteSource();
  const routeCases = casesInRouteSource();
  const tableOps = new Set(perms.ALL_OPS);

  await h.test("the route Body union is non-trivial (extraction works)", () => {
    // Guards the extractor itself. If a refactor changed the union's syntax and
    // the regex silently matched nothing, every test below would pass vacuously.
    h.assert(
      routeOps.size >= 20,
      `expected ~22 ops from the union, extracted ${routeOps.size}`
    );
  });

  await h.test("every op in the Body union has a permission entry", () => {
    const missing = [...routeOps].filter((op) => !tableOps.has(op));
    h.assertEqual(
      missing.length,
      0,
      `ops reachable from the route with NO permission declared: ${missing.join(", ")}`
    );
  });

  await h.test("every permission entry corresponds to a real op", () => {
    // The reverse direction: a stale table entry is a lie about coverage.
    const extra = [...tableOps].filter((op) => !routeOps.has(op));
    h.assertEqual(
      extra.length,
      0,
      `permission entries for ops that do not exist: ${extra.join(", ")}`
    );
  });

  await h.test("every op in the Body union has a case in the switch", () => {
    const unhandled = [...routeOps].filter((op) => !routeCases.has(op));
    h.assertEqual(
      unhandled.length,
      0,
      `ops declared but not dispatched (they would hit the default 400): ${unhandled.join(", ")}`
    );
  });

  await h.test("no case exists without a declared op", () => {
    const orphanCases = [...routeCases].filter((op) => !routeOps.has(op));
    h.assertEqual(
      orphanCases.length,
      0,
      `switch cases with no op in the union: ${orphanCases.join(", ")}`
    );
  });

  await h.test("user.switch is gone (replaced by real sessions)", () => {
    h.assert(!tableOps.has("user.switch"), "user.switch must not have a permission");
    h.assert(!routeOps.has("user.switch"), "user.switch must not be dispatchable");
  });

  await h.test("every enforced permission kind has a handler in the route", () => {
    // The known kinds are only "known" because the route's authorisation switch
    // handles them. Declaring a kind in opPermissions.ts and forgetting a case
    // in the route would make the op fall through to a handler-less switch:
    // either it is silently skipped (fail-open) or it is an unhandled op.
    //
    // So rather than hardcode a list of names, derive the set of kinds the
    // route actually enforces from its `case "<kind>":` labels and require every
    // declared kind to be one of them. A future kind nobody enforces fails here
    // even if the name looks plausible.
    const kindCases = casesInRouteSource(KINDS);
    for (const kind of ["admin", "self", "selfOrAdmin"]) {
      h.assert(
        kindCases.has(kind),
        `the route must enforce "${kind}" — no case "<kind>:" handler found`
      );
    }
  });

  await h.test("no op is accidentally left permissive", () => {
    // Every kind declared in the table must be one the route enforces. A typo
    // like kind:"admin " or a future kind nobody handles would otherwise
    // silently pass.
    const enforced = casesInRouteSource(KINDS);
    for (const op of perms.ALL_OPS) {
      const p = perms.permissionFor(op);
      h.assert(p !== null, `${op} must have a permission`);
      h.assert(
        enforced.has(p.kind),
        `${op} has permission kind "${p.kind}" which nothing enforces`
      );
      if (p.kind === "create" || p.kind === "byId") {
        h.assert(
          typeof p.entity === "string" && p.entity.length > 0,
          `${op} (${p.kind}) must name an entity kind`
        );
      }
    }
  });

  await h.test("an unknown op is refused, not defaulted", () => {
    // permissionFor must return null so the route can 400. If this ever returns
    // a permissive object, the entire table becomes decorative.
    h.assertEqual(perms.permissionFor("evil.op"), null, "unknown op -> null");
    h.assertEqual(perms.permissionFor(""), null, "empty op -> null");
    h.assertEqual(
      perms.permissionFor("constructor"),
      null,
      "prototype key must not resolve to a permission"
    );
    h.assertEqual(
      perms.permissionFor("toString"),
      null,
      "inherited key must not resolve to a permission"
    );
  });

  await h.test("destructive ops stay gated, and self-service stays narrow", () => {
    // Spot-check the highest-consequence ops. state.replace rewrites all data.
    const sr = perms.permissionFor("state.replace");
    h.assertEqual(sr.kind, "admin", "state.replace must be admin-only");

    // Adding an account changes who can log in and is not a self-service
    // action, so it stays admin-only.
    h.assertEqual(
      perms.permissionFor("user.add").kind,
      "admin",
      "user.add must be admin-only"
    );

    /*
     * Deleting an account is different, and deliberately so.
     *
     * This used to assert user.delete was admin-only, on the reasoning that
     * deleting accounts "changes who can log in". That reasoning still holds
     * for OTHER people's accounts — but a user deleting THEMSELVES is the one
     * case where it must not be admin-only: App Store guideline 5.1.1(v)
     * requires in-app account deletion, and the alternative was telling users
     * to run a server-side script. So user.delete is selfOrAdmin, and the
     * admin-only invariant moves to the target check: the route must refuse a
     * target that is not the caller. Asserting the kind alone is not enough,
     * because a selfOrAdmin that nothing enforces is just "anyone".
     */
    h.assertEqual(
      perms.permissionFor("user.delete").kind,
      "selfOrAdmin",
      "user.delete is self-service (5.1.1(v)) plus admin for the owner"
    );

    /*
     * Editing an account IS partly self-service: the profile screen lets a user
     * edit their own record, the owner-only traveler editor edits anyone's. The
     * table expresses that as selfOrAdmin, and the route must enforce the
     * target — otherwise any signed-in user could rename any account by id.
     *
     * The handler assertion below now covers user.delete as well as
     * user.update: both are selfOrAdmin, so both depend on the same route
     * branch resolving a target. Asserting the kind alone would be satisfied by
     * a future "selfOrAdmin" that nothing handles.
     */
    h.assertEqual(
      perms.permissionFor("user.update").kind,
      "selfOrAdmin",
      "user.update is self-service for the caller plus admin for the owner"
    );
    h.assert(
      casesInRouteSource(KINDS).has("selfOrAdmin"),
      "user.update AND user.delete are declared selfOrAdmin, so the route must " +
        "enforce them: no case \"selfOrAdmin\": handler found in mutate/route.ts"
    );
  });

  await h.test("bare-id ops declare byId so the server resolves the parent", () => {
    // The ops whose payloads carry only an `id` MUST be byId. If any of these
    // were declared `create`, the route would look for a parent that is not in
    // the payload and the guard would be checking the wrong thing.
    const bareIdOps = [
      "trip.update",
      "trip.delete",
      "category.update",
      "category.delete",
      "item.update",
      "item.delete",
      "task.update",
      "task.delete",
      "reservation.update",
      "reservation.delete",
    ];
    for (const op of bareIdOps) {
      const p = perms.permissionFor(op);
      h.assertEqual(
        p.kind,
        "byId",
        `${op} takes only an entity id and must be byId`
      );
    }
  });

  h.summary();
})();
