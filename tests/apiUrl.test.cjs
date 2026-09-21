/*
 * Tests for the absolute-URL helper.
 *
 * The bug this guards against: a RELATIVE `fetch("/api/state")` resolves
 * against the document base URL. In the Capacitor iOS WebView on a deep path
 * (/trips/<id>) that base is the path's directory, so the request goes to a URL
 * that does not exist and the page hangs on "Loading trip...". apiUrl() must
 * pin the request to the page origin.
 */

const h = require("./harness.cjs");

const apiUrlPath = require("node:path").join(h.SRC, "lib", "apiUrl.ts");

function withWindow(origin, fn) {
  const hadWindow = "window" in globalThis;
  const prev = globalThis.window;
  globalThis.window = origin === undefined ? undefined : { location: { origin } };
  try {
    return fn();
  } finally {
    if (hadWindow) globalThis.window = prev;
    else delete globalThis.window;
  }
}

(async () => {
  console.log("apiUrl");

  const { apiUrl } = h.loadModule(apiUrlPath);

  await h.test("resolves /api/state against the page origin", () => {
    withWindow("http://localhost:4000", () => {
      h.assertEqual(apiUrl("/api/state"), "http://localhost:4000/api/state");
    });
  });

  await h.test("resolves /api/mutate against the page origin", () => {
    withWindow("http://localhost:4000", () => {
      h.assertEqual(apiUrl("/api/mutate"), "http://localhost:4000/api/mutate");
    });
  });

  await h.test("deep path does NOT leak into the resolved url (the iOS hang)", () => {
    // Simulate a page at a deep path: with a relative fetch the browser would
    // resolve "/api/state" against the directory of this URL. apiUrl must
    // produce an origin-rooted URL regardless.
    withWindow("capacitor://localhost", () => {
      h.assertEqual(apiUrl("/api/state"), "capacitor://localhost/api/state");
    });
  });

  await h.test("honours a non-standard origin (file-style custom scheme)", () => {
    withWindow("https://example.com", () => {
      h.assertEqual(apiUrl("/api/geo"), "https://example.com/api/geo");
    });
  });

  await h.test("returns the path unchanged when there is no window (SSR/Node)", () => {
    withWindow(undefined, () => {
      h.assertEqual(apiUrl("/api/state"), "/api/state");
    });
  });

  await h.test("returns the path unchanged when window has no origin", () => {
    withWindow("", () => {
      h.assertEqual(apiUrl("/api/state"), "/api/state");
    });
  });

  h.summary();
})();
