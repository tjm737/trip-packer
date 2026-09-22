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
 * Every `case "x.y":` label in the route's switch.
 *
 * The union and the switch must agree. An op in the switch but not the union is
 * dead code; an op in the union but not the switch falls through to the
 * `default` 400. Both are bugs worth failing on.
 */
function casesInRouteSource() {
  const src = fs.readFileSync(ROUTE, "utf8");
  const found = new Set();
  const re = /case\s+"([a-zA-Z]+\.[a-zA-Z]+)":/g;
  let m;
  while ((m = re.exec(src)) !== null) found.add(m[1]);
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

  await h.test("no op is accidentally left permissive", () => {
    // Every kind must be one of the known ones. A typo like kind:"admin " or a
    // future kind nobody enforces would otherwise silently pass.
    const known = new Set(["create", "byId", "admin", "self", "session"]);
    for (const op of perms.ALL_OPS) {
      const p = perms.permissionFor(op);
      h.assert(p !== null, `${op} must have a permission`);
      h.assert(
        known.has(p.kind),
        `${op} has unknown permission kind "${p.kind}" which nothing enforces`
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

  await h.test("destructive ops are not reachable by a plain member", () => {
    // Spot-check the highest-consequence ops. state.replace rewrites all data.
    const sr = perms.permissionFor("state.replace");
    h.assertEqual(sr.kind, "admin", "state.replace must be admin-only");

    // Account ops are admin-only: closed registration, owner-created accounts.
    for (const op of ["user.add", "user.update", "user.delete"]) {
      h.assertEqual(
        perms.permissionFor(op).kind,
        "admin",
        `${op} must be admin-only`
      );
    }
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
