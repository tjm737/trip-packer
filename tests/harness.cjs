/*
 * Zero-dependency test harness.
 *
 * The repo has no test runner installed and package installs are not available
 * in this environment, so tests run on plain Node using the project's own
 * TypeScript compiler to transpile the REAL source modules.
 *
 * Why transpile the real source rather than re-implementing logic in the test:
 * hand-transcribed copies have repeatedly hidden real bugs in this project. The
 * tests must exercise the shipped code.
 *
 * Why the TypeScript compiler API rather than a plain require(): the source
 * modules use ESM imports, type-only syntax, and the `@/` path alias, none of
 * which Node can resolve directly. We transpile each module to CommonJS with
 * `ts.transpileModule`, strip types, and resolve relative / `@/` imports
 * ourselves via a tiny loader, so the real files run unmodified.
 *
 * This makes `typescript` a RUNTIME dependency, not a dev one. scripts/
 * create-account.cjs loads this harness to reach the real db.ts and auth.ts, and
 * that CLI runs in production on the server. Keeping typescript in
 * devDependencies meant `npm prune --omit=dev` removed it and the CLI died with
 * "Cannot find module 'typescript'" -- so it lives in dependencies now. Do not
 * move it back to devDependencies.
 */

const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

/** Resolves an import specifier from an importing file to an absolute path. */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) {
    base = path.join(SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare package import — let Node handle it
  }

  // Try the file itself, then common extensions, then /index.
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return base;
}

const compileCache = new Map();

/** Transpiles one source file to CommonJS source text (types stripped). */
function compile(file) {
  if (compileCache.has(file)) return compileCache.get(file);

  const source = fs.readFileSync(file, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      // Skip type checking here (tsc --noEmit is run separately); this only
      // has to produce runnable JS.
      isolatedModules: true,
    },
    fileName: file,
  }).outputText;

  compileCache.set(file, out);
  return out;
}

/**
 * Loads a real source module into a fresh CommonJS module with its relative and
 * `@/` imports resolved to the real files (recursively transpiled).
 */
function loadModule(file, parentCache = new Map()) {
  if (parentCache.has(file)) return parentCache.get(file).exports;

  const mod = { exports: {} };
  parentCache.set(file, mod);

  const localRequire = (spec) => {
    const resolved = resolveSpecifier(spec, file);
    if (resolved && fs.existsSync(resolved)) {
      return loadModule(resolved, parentCache);
    }
    return require(spec);
  };

  // `require` needs to be a dependency of the compiled module. Wrap the
  // transpiled CommonJS source in a function that receives our require, so we
  // control resolution without touching the global loader.
  const wrapped = new Function("require", "module", "exports", "__dirname", "__filename", compile(file));
  wrapped(localRequire, mod, mod.exports, path.dirname(file), file);

  return mod.exports;
}

/* --------------------------------------------------------------- assertions */

let passed = 0;
let failed = 0;
let registeredTests = 0;
const failures = [];

function test(name, fn) {
  registeredTests++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  PASS  ${name}`);
    })
    .catch((err) => {
      failed++;
      failures.push({ name, err });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${err && err.message ? err.message : err}`);
    });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || "not equal"}\n     expected: ${e}\n     actual:   ${a}`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  assertEqual(actual, expected, msg);
}

/* ------------------------------------------------------------------ runner */

function summary() {
  console.log("");
  console.log(`  ${passed} passed, ${failed} failed`);

  /*
   * Guard against the top-level-summary trap.
   *
   * `test()` is async, so calling `summary()` synchronously at module top level
   * runs it BEFORE any test has completed: it prints "0 passed, 0 failed" and
   * leaves process.exitCode untouched, so a suite with real failures exits 0
   * and run.cjs counts it as passing. That is a silent-loss failure — the tests
   * look green forever while asserting nothing.
   *
   * Zero completed tests is only ever legitimate if no test was registered.
   * If tests were registered but none finished, the caller forgot to await.
   */
  const registered = passed + failed;
  if (registered === 0 && registeredTests > 0) {
    console.log("");
    console.log(
      `  HARNESS ERROR: ${registeredTests} test(s) registered but 0 completed.`
    );
    console.log(
      "  summary() was called before the tests finished — wrap the suite in an"
    );
    console.log("  async IIFE and `await h.test(...)` each case.");
    process.exitCode = 1;
    return;
  }

  if (failed > 0) {
    console.log("");
    for (const f of failures) {
      console.log(`  FAILED: ${f.name}`);
    }
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT,
  SRC,
  loadModule,
  resolveSpecifier,
  test,
  assert,
  assertEqual,
  assertDeepEqual,
  summary,
};
