/*
 * Tests for the Foundation Models bridge's DEGRADATION behaviour.
 *
 * Why this is the important half: most of the time the plugin is not there.
 * The web app runs in a browser, on Android, on old iOS -- in all of those
 * `Capacitor.Plugins.FoundationModels` is missing. If `checkAvailability()`
 * rejected in that situation, every caller would need a try/catch around a
 * completely ordinary state, and the first one that forgot would show an error
 * screen to a user on Chrome.
 *
 * So the contract under test is: on any platform, with or without a native
 * bridge, these functions RESOLVE with a report and never throw. The UI can
 * then gate on `available === false` alone.
 *
 * This deliberately does NOT test the native side. What the Swift plugin does
 * is verified by compiling and running it against the iOS SDK; what this file
 * pins down is that the web layer behaves when that Swift code is absent.
 */

const h = require("./harness.cjs");
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "src", "lib", "foundationModels.ts");

/**
 * Load the module with `@capacitor/core` stubbed to behave like a browser:
 * `registerPlugin` returns a bare object with no methods, which is what the
 * real one does when no native implementation is registered.
 */
function loadWithoutNative() {
  const Module = require("module");
  const originalResolve = Module._resolveFilename;

  Module._resolveFilename = function (request, ...rest) {
    if (request === "@capacitor/core") return "@capacitor/core";
    return originalResolve.call(this, request, ...rest);
  };

  const corePath = require.resolve("@capacitor/core");
  const originalCore = require.cache[corePath];

  require.cache[corePath] = {
    id: corePath,
    filename: corePath,
    loaded: true,
    exports: {
      /* A browser has no native layer, so the real registerPlugin returns a
       * proxy with no methods on it. This mirrors that exactly. */
      registerPlugin: () => ({}),
    },
  };

  const h2 = { loadModule: h.loadModule };
  delete require.cache[require.resolve(SRC)];
  const mod = h2.loadModule("src/lib/foundationModels.ts");

  if (originalCore) require.cache[corePath] = originalCore;
  else delete require.cache[corePath];
  Module._resolveFilename = originalResolve;

  return mod;
}

async function run() {
  const fm = loadWithoutNative();

  await h.test("checkAvailability resolves (does not throw) with no native bridge", async () => {
    const report = await fm.checkAvailability();
    h.assertEqual(report.available, false, "must report unavailable, not throw");
    h.assert(
      typeof report.reason === "string" && report.reason.length > 0,
      "must carry a machine-readable reason"
    );
    h.assert(
      typeof report.message === "string" && report.message.length > 0,
      "must carry a message safe to show a user"
    );
  });

  await h.test("generateText resolves null with no native bridge", async () => {
    const out = await fm.generateText("What should I pack?");
    h.assertEqual(out, null, "no suggestion is a normal state, not an error");
  });

  await h.test("generateObject resolves null with no native bridge", async () => {
    const out = await fm.generateObject("prompt", ["item", "reason"]);
    h.assertEqual(out, null);
  });

  await h.test("a throwing bridge is contained, not propagated", async () => {
    /* A malformed native call throws inside Capacitor. Callers must still get
     * a usable answer rather than an unhandled rejection. */
    const Module = require("module");
    const originalResolve = Module._resolveFilename;
    const corePath = require.resolve("@capacitor/core");
    const originalCore = require.cache[corePath];

    require.cache[corePath] = {
      id: corePath,
      filename: corePath,
      loaded: true,
      exports: {
        registerPlugin: () => ({
          isAvailable: () => { throw new Error("bridge exploded"); },
          generate: () => { throw new Error("bridge exploded"); },
          generateStructured: () => { throw new Error("bridge exploded"); },
        }),
      },
    };

    delete require.cache[require.resolve(SRC)];
    const broken = h.loadModule("src/lib/foundationModels.ts");

    const report = await broken.checkAvailability();
    h.assertEqual(report.available, false, "a broken bridge must read as unavailable");
    h.assertEqual(await broken.generateText("x"), null);
    h.assertEqual(await broken.generateObject("x", ["a"]), null);

    if (originalCore) require.cache[corePath] = originalCore;
    else delete require.cache[corePath];
    Module._resolveFilename = originalResolve;
  });

  await h.test("a rejecting bridge is contained too", async () => {
    const corePath = require.resolve("@capacitor/core");
    const originalCore = require.cache[corePath];

    require.cache[corePath] = {
      id: corePath,
      filename: corePath,
      loaded: true,
      exports: {
        registerPlugin: () => ({
          isAvailable: async () => { throw new Error("async boom"); },
          generate: async () => { throw new Error("async boom"); },
          generateStructured: async () => { throw new Error("async boom"); },
        }),
      },
    };

    delete require.cache[require.resolve(SRC)];
    const broken = h.loadModule("src/lib/foundationModels.ts");

    /* If any of these reject, the awaits below propagate out of h.test and the
     * suite goes red -- which is what this case is asserting. A try/catch that
     * swallowed the rejection would make the test vacuous, so there isn't one. */
    const r = await broken.checkAvailability();
    h.assertEqual(r.available, false, "an async rejection must read as unavailable");
    h.assertEqual(await broken.generateText("x"), null);
    h.assertEqual(await broken.generateObject("x", ["a"]), null);

    if (originalCore) require.cache[corePath] = originalCore;
    else delete require.cache[corePath];
  });

  await h.test("a working bridge passes values through", async () => {
    const corePath = require.resolve("@capacitor/core");
    const originalCore = require.cache[corePath];

    require.cache[corePath] = {
      id: corePath,
      filename: corePath,
      loaded: true,
      exports: {
        registerPlugin: () => ({
          isAvailable: async () => ({
            available: true,
            reason: "available",
            message: "Ready.",
          }),
          generate: async ({ prompt }) => ({ text: `  echo:${prompt}  ` }),
          generateStructured: async () => ({
            text: '```json\n{"item":"Boots"}\n```',
            schema: "{}",
            fields: ["item"],
          }),
        }),
      },
    };

    delete require.cache[require.resolve(SRC)];
    const ok = h.loadModule("src/lib/foundationModels.ts");

    const report = await ok.checkAvailability();
    h.assertEqual(report.available, true);
    h.assertEqual(report.reason, "available");

    /* Whitespace must be trimmed -- models pad output with newlines. */
    h.assertEqual(await ok.generateText("hi"), "echo:hi");

    const obj = await ok.generateObject("p", ["item"]);
    h.assertEqual(obj.item, "Boots", "a fenced reply must still parse");

    if (originalCore) require.cache[corePath] = originalCore;
    else delete require.cache[corePath];
  });
}

(async function main() {
  await run();
  h.summary();
})();
