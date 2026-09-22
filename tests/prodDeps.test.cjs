/*
 * Tests for production-runtime dependency coverage.
 *
 * The bug this guards against: `deploy.sh` runs `npm prune --omit=dev` on the
 * server, so anything reachable at runtime but declared only in
 * devDependencies disappears in production. That failure is invisible locally,
 * where every package is installed, and shows up as a "Cannot find module"
 * crash on the VPS at the worst moment.
 *
 * It happened with `typescript`: tests/harness.cjs requires it at load time to
 * transpile the real TS sources, scripts/create-account.cjs requires the harness
 * to reach the real db.ts and auth.ts, and that CLI is run in production. With
 * typescript in devDependencies the prune removed it and account creation broke
 * on a freshly deployed box.
 *
 * The rule enforced here: every bare module specifier reachable from the
 * production entrypoints must appear in `dependencies`.
 *
 * Deliberately NOT checked: tests/*.test.cjs and devDependencies used only by
 * the test runner itself (eslint, @types/*). Those are not reachable in
 * production, so requiring them would force pointless production installs.
 */

const h = require("./harness.cjs");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");

const ROOT = path.join(h.SRC, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const deps = new Set(Object.keys(pkg.dependencies || {}));
const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

/*
 * Node's own modules are supplied by the runtime, so they are correctly absent
 * from package.json and there is nothing to install or prune. Asking Node for
 * the list rather than hardcoding it means a newly imported builtin (os,
 * crypto, child_process, ...) is excluded automatically instead of showing up
 * as a phantom "undeclared package".
 */
const builtins = new Set(builtinModules);

/** Bare specifiers: not relative, not absolute, not a Node builtin. */
function isBare(spec) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return false;
  return !builtins.has(packageOf(spec));
}

/** "better-sqlite3/lib/x" and "@scope/pkg/sub" both reduce to the package name. */
function packageOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Strip comments so prose cannot masquerade as an import.
 *
 * Without this, a doc comment reading ...imports X from "this
 * account has no trips yet"... produces a bogus specifier. Only comments are
 * removed; string literals must stay, because require("x") is a string.
 */
function stripComments(src) {
  // Line comments, then block comments. Order matters: doing block comments
  // first would let a `//` inside a block comment swallow the rest of a line.
  return src
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Collect bare requires/imports from a file.
 *
 * Textual rather than AST-based on purpose: this runs over .cjs entrypoints and
 * TS sources that the harness would otherwise have to transpile first, and a
 * missed dynamic import here is a far smaller problem than a false failure.
 */
function bareSpecifiersIn(file) {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const out = new Set();
  // Anchored to statement position so a specifier must look like a real import,
  // and `@/` alias imports are excluded since they resolve inside src/.
  const patterns = [
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,        // CJS
    /^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm, // ESM import ... from
    /^\s*export\s[^;]*?from\s+["']([^"']+)["']/gm, // ESM re-export
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,         // dynamic import
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (spec.startsWith("@/")) continue; // project-internal path alias
      if (isBare(spec)) out.add(packageOf(spec));
    }
  }
  return out;
}

/**
 * Files that run in production.
 *
 * tests/harness.cjs is included because scripts/create-account.cjs requires it
 * at module load, which is exactly the edge that broke. src/lib/*.ts is included
 * because the harness loads those files at runtime in production.
 */
function productionEntrypoints() {
  const files = [];

  const scriptsDir = path.join(ROOT, "scripts");
  for (const f of fs.readdirSync(scriptsDir)) {
    if (f.endsWith(".cjs")) files.push(path.join(scriptsDir, f));
  }

  files.push(path.join(ROOT, "tests", "harness.cjs"));

  const libDir = path.join(h.SRC, "lib");
  for (const f of fs.readdirSync(libDir)) {
    if (f.endsWith(".ts") && !f.endsWith(".test.ts")) files.push(path.join(libDir, f));
  }

  return files;
}

(async () => {
  console.log("prodDeps");

  const files = productionEntrypoints();

  // Guard the guard: if the file discovery silently finds nothing (a moved
  // directory, a rename), every assertion below would pass vacuously.
  await h.test("found production entrypoints to check", () => {
    h.assert(files.length >= 3, `expected >=3 entrypoints, found ${files.length}`);
  });

  await h.test("harness.cjs is among them (the file that broke)", () => {
    const harness = path.join(ROOT, "tests", "harness.cjs");
    h.assert(
      files.includes(harness),
      "tests/harness.cjs must be scanned; it is required by create-account.cjs"
    );
  });

  const offenders = [];
  for (const file of files) {
    for (const dep of bareSpecifiersIn(file)) {
      if (deps.has(dep)) continue;              // declared, fine
      if (!devDeps.has(dep) && dep !== "server-only") {
        // Not declared anywhere. server-only is injected by Next's bundler and
        // is not a real package, so it would not resolve at install time anyway.
        offenders.push({ file: path.relative(ROOT, file), dep, why: "undeclared" });
        continue;
      }
      offenders.push({ file: path.relative(ROOT, file), dep, why: "devDependency" });
    }
  }

  await h.test("no production entrypoint imports a devDependency", () => {
    const bad = offenders.filter((o) => o.why === "devDependency");
    h.assertEqual(
      bad.map((o) => `${o.file} -> ${o.dep}`),
      [],
      "these are reachable in production but pruned by `npm prune --omit=dev`"
    );
  });

  await h.test("no production entrypoint imports an undeclared package", () => {
    const bad = offenders.filter((o) => o.why === "undeclared");
    h.assertEqual(
      bad.map((o) => `${o.file} -> ${o.dep}`),
      [],
      "these resolve locally by accident but are not in package.json at all"
    );
  });

  await h.test("typescript is a runtime dependency, not a dev one", () => {
    // Called out individually because it is the specific package that broke, and
    // an explicit assertion survives someone tidying it back into devDeps.
    h.assert(
      deps.has("typescript"),
      "typescript must be in dependencies: harness.cjs requires it at load time"
    );
  });

  h.summary();
})();
