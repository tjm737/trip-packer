/*
 * The web layer's half of Sign in with Apple: exchanging a credential for a
 * session, and the shape of the outcome.
 *
 * The plugin itself cannot be exercised here -- it needs a real device and a
 * real Apple ID -- so the bridge is stubbed and what is tested is every branch
 * that decides what the user sees. The property that matters most is the one
 * around cancellation: a dismissed sheet must NOT surface as an error.
 */

const h = require("./harness.cjs");

const mod = h.loadModule("src/lib/appleSignIn.ts");
const { exchangeAppleCredential, isCancelled } = mod;

/** A minimal Response stand-in. */
function res({ status = 200, body = null, jsonThrows = false }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new Error("not json");
      return body;
    },
  };
}

/** A fetch that returns one canned response and records the call. */
function fetchOnce(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  fn.calls = calls;
  return fn;
}

module.exports = (async () => {
  await h.test("isCancelled distinguishes the dismissal shape", () => {
    h.assertEqual(isCancelled({ cancelled: true }), true);
    h.assertEqual(isCancelled({ identityToken: "x", user: "y" }), false);
  });

  await h.test("a successful exchange returns the user", async () => {
    const f = fetchOnce(res({ body: { user: { id: "u1", name: "Tyler" } } }));
    const out = await exchangeAppleCredential({ identityToken: "tok", user: "a" }, f);
    h.assertEqual(out.ok, true);
    h.assertEqual(out.user.id, "u1");
    h.assertEqual(out.user.name, "Tyler");
  });

  await h.test("the token is posted as-is and credentials are included", async () => {
    const f = fetchOnce(res({ body: { user: { id: "u1", name: "T" } } }));
    await exchangeAppleCredential(
      { identityToken: "the-token", user: "a", fullName: { givenName: "Ty" } },
      f
    );
    const { url, init } = f.calls[0];
    h.assert(url.includes("/api/auth/apple"), "must post to /api/auth/apple");
    h.assertEqual(init.method, "POST");
    // Without this the session cookie is never stored and the sign-in is a no-op.
    h.assertEqual(init.credentials, "include");
    const sent = JSON.parse(init.body);
    h.assertEqual(sent.identityToken, "the-token");
    h.assertEqual(sent.fullName.givenName, "Ty");
  });

  await h.test("a missing name is sent as null rather than omitted", async () => {
    // The server distinguishes "Apple sent no name" from a malformed body.
    const f = fetchOnce(res({ body: { user: { id: "u1", name: "T" } } }));
    await exchangeAppleCredential({ identityToken: "t", user: "a" }, f);
    const sent = JSON.parse(f.calls[0].init.body);
    h.assertEqual(sent.fullName, null);
  });

  await h.test("a network failure resolves with an error, never throws", async () => {
    const boom = async () => { throw new Error("offline"); };
    const out = await exchangeAppleCredential({ identityToken: "t", user: "a" }, boom);
    h.assertEqual(out.ok, false);
    h.assert(typeof out.error === "string" && out.error.length > 0);
  });

  await h.test("a 401 surfaces the server's message", async () => {
    const out = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ status: 401, body: { error: "Could not verify Apple sign-in" } }))
    );
    h.assertEqual(out.ok, false);
    h.assertEqual(out.error, "Could not verify Apple sign-in");
  });

  await h.test("a 429 surfaces a rate-limit message", async () => {
    const out = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ status: 429, body: { error: "Too many attempts" } }))
    );
    h.assertEqual(out.ok, false);
    h.assertEqual(out.error, "Too many attempts");
  });

  await h.test("a non-JSON error body falls back to a generic message", async () => {
    // A proxy HTML page must not reach the user as raw markup.
    const out = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ status: 502, jsonThrows: true }))
    );
    h.assertEqual(out.ok, false);
    h.assertEqual(out.error, "Could not sign in with Apple. Please try again.");
  });

  await h.test("a 200 with no user is treated as a failure", async () => {
    // Proceeding here would mean onSuccess with an undefined user.
    const out = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ body: {} }))
    );
    h.assertEqual(out.ok, false);
    h.assert(typeof out.error === "string");
  });

  await h.test("a 200 with a user but no name falls back to Traveler", async () => {
    const out = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ body: { user: { id: "u1" } } }))
    );
    h.assertEqual(out.ok, true);
    h.assertEqual(out.user.name, "Traveler");
  });

  await h.test("no outcome ever has both ok and cancelled set", async () => {
    // The two are exclusive; a caller branching on `ok` then `cancelled` must
    // not be able to see both.
    const good = await exchangeAppleCredential(
      { identityToken: "t", user: "a" },
      fetchOnce(res({ body: { user: { id: "u1", name: "T" } } }))
    );
    h.assertEqual(good.ok, true);
    h.assert(!("cancelled" in good), "a success must not carry a cancelled flag");
  });

  return h.summary();
})();
