/*
 * Tests for the native share-sheet helper (shareLink).
 *
 * The behaviour that matters most here is not "does it open a sheet" — that is
 * the OS's job and cannot be asserted in Node. It is the CANCELLATION path.
 * Dismissing the iOS share sheet rejects the promise, and if that were treated
 * as a failure the helper would fall through to the clipboard and overwrite
 * whatever the user had copied, while the caller showed an error for an action
 * the user chose deliberately. Every browser proxy below therefore exercises
 * cancellation explicitly, because it is the regression that would ship.
 *
 * The helper reaches for @capacitor/core and @capacitor/share through dynamic
 * import(). Node resolves those as real bare packages, so on the test machine
 * Capacitor.getPlatform() reports "web" and the native branch is skipped
 * cleanly — which is itself the desktop-browser behaviour we want to pin. The
 * web and clipboard branches are driven through stubbed globals, following the
 * same install/teardown pattern as storage.test.cjs.
 */

const h = require("./harness.cjs");
const path = require("node:path");

const sharePath = path.join(h.SRC, "lib", "nativeShare.ts");

/* ----------------------------------------------------------- test doubles */

/**
 * Installs a fake `navigator` (and clears any previous one). Returns handles to
 * the recording arrays so a test can assert what was called.
 */
function installNavigator({ share, clipboard = true } = {}) {
  const calls = { share: [], writeText: [] };

  const nav = {};

  if (share) {
    nav.share = async (data) => {
      calls.share.push(data);
      if (typeof share === "function") return share(data);
      if (share instanceof Error) throw share;
    };
  }

  if (clipboard) {
    nav.clipboard = {
      writeText: async (text) => {
        calls.writeText.push(text);
        if (typeof clipboard === "function") return clipboard(text);
        if (clipboard instanceof Error) throw clipboard;
      },
    };
  }

  globalThis.navigator = nav;
  return calls;
}

/** Removes the browser globals the helper probes. */
function teardown() {
  delete globalThis.navigator;
  delete globalThis.window;
}

/** A fresh module instance so module-level state (none today) cannot leak. */
function freshShare() {
  return h.loadModule(sharePath, new Map());
}

/** An AbortError the way the Web Share API actually reports a dismissal. */
function abortError() {
  const err = new Error("Share canceled");
  err.name = "AbortError";
  return err;
}

/* ------------------------------------------------------------------ suite */

(async () => {
  console.log("nativeShare");

  await h.test("SSR-safety: importing with no window/navigator does not throw", () => {
    /*
     * Next.js renders client components on the server, and this module is
     * imported at the top of such a component. A top-level `window` access
     * would therefore crash the server render, so the module body must be
     * inert. loadModule runs the real module source; if it touched a browser
     * global at import time this test would throw before the assertion.
     */
    delete globalThis.navigator;
    delete globalThis.window;
    const mod = freshShare();
    h.assertEqual(typeof mod.shareLink, "function");
  });

  await h.test("SSR-safety: calling it with no browser globals returns ok:false", async () => {
    // On the server none of the three layers exist; the honest answer is
    // "none", not a thrown TypeError.
    delete globalThis.navigator;
    delete globalThis.window;
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res, { ok: false, method: "none" });
  });

  await h.test("uses web share when navigator.share exists", async () => {
    const calls = installNavigator({ share: true, clipboard: false });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Japan", text: "come along", url: "https://x.example.com/t/1" });
    h.assertEqual(res, { ok: true, method: "web" });
    h.assertEqual(calls.share.length, 1, "navigator.share must be called once");
    h.assertEqual(calls.share[0].url, "https://x.example.com/t/1");
    teardown();
  });

  await h.test("cancelling the web share sheet does NOT use the clipboard", async () => {
    /*
     * The headline regression. navigator.share rejects with AbortError when the
     * sheet is dismissed; the helper must stop there, report a cancellation and
     * leave the clipboard untouched.
     */
    const calls = installNavigator({ share: abortError(), clipboard: true });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res.ok, false);
    h.assertEqual(res.method, "web");
    h.assertEqual(res.canceled, true, "must be flagged as a user cancellation");
    h.assertEqual(calls.writeText.length, 0, "cancelling must NOT fall through to the clipboard");
    teardown();
  });

  await h.test("cancellation via a 'Share canceled' message is also recognised", async () => {
    // @capacitor/share rejects with a plain Error whose message is
    // "Share canceled" and sets no name, so the check cannot key off name
    // alone.
    const err = new Error("Share canceled");
    const calls = installNavigator({ share: err, clipboard: true });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res.canceled, true);
    h.assertEqual(calls.writeText.length, 0);
    teardown();
  });

  await h.test("a real web-share failure DOES fall through to the clipboard", async () => {
    // Distinguishing these two is the whole point: a genuine error is not a
    // cancellation and should still try to salvage the share.
    const calls = installNavigator({
      share: new Error("InvalidStateError: no transient activation"),
      clipboard: true,
    });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res, { ok: true, method: "clipboard" });
    h.assertEqual(calls.writeText.length, 1);
    h.assertEqual(calls.writeText[0], "https://x.example.com/t/1");
    teardown();
  });

  await h.test("copies to the clipboard when nothing else is available", async () => {
    const calls = installNavigator({ clipboard: true });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res, { ok: true, method: "clipboard" });
    h.assertEqual(calls.writeText[0], "https://x.example.com/t/1");
    teardown();
  });

  await h.test("reports ok:false when the clipboard write rejects", async () => {
    // A rejected clipboard write (permission denied on an insecure origin) is a
    // genuine failure, and the message should survive for the caller to log.
    installNavigator({ clipboard: new Error("NotAllowedError: denied") });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res.ok, false);
    h.assertEqual(res.method, "clipboard");
    h.assertEqual(res.error, "NotAllowedError: denied");
    teardown();
  });

  await h.test("returns ok:false with method 'none' when no layer exists", async () => {
    // An old browser or an insecure origin: no share, no clipboard. This must
    // be a returned result, never a throw.
    installNavigator({ clipboard: false });
    const { shareLink } = freshShare();
    const res = await shareLink({ title: "Trip", url: "https://x.example.com/t/1" });
    h.assertEqual(res, { ok: false, method: "none" });
    teardown();
  });

  h.summary();
})();
