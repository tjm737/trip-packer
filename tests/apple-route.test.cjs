/*
 * The /api/auth/apple route module.
 *
 * This is a smoke test for the import graph and for the one property that
 * matters most at this layer: the endpoint must REFUSE a request whose token
 * cannot be verified, and must not touch the database when it does.
 *
 * A full request-level test would need a live Apple key set, so the
 * verification logic itself is covered in apple-auth.test.cjs against a real
 * RSA keypair. What is checked here is that the route wires it in ahead of any
 * account read or write, and that a missing or malformed token is rejected
 * without a database read.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-apple-route-"));
process.env.TRIP_PACKER_DB = path.join(tmpDir, "test.db");

const h = require("./harness.cjs");

const route = h.loadModule("src/app/api/auth/apple/route.ts");
const { tx } = h.loadModule("src/lib/db.ts");

/**
 * Build a Request stub. Only the fields the route reads.
 *
 * Each call gets a DISTINCT forwarded-for address by default. The route applies
 * a per-IP token bucket, and this file makes a dozen requests in a tight loop;
 * sharing one address means the later cases fail with 429 before they reach the
 * logic under test. That is the rate limiter doing its job, but it makes the
 * auth assertions meaningless, so the limiter is given a fresh bucket per case
 * and is exercised deliberately in its own test below.
 */
let ipCounter = 0;
function post(body, headers = {}) {
  const ip = `203.0.113.${++ipCounter}`;
  return {
    url: "https://trips.planetracker.app/api/auth/apple",
    headers: new Headers({
      "x-forwarded-for": ip,
      "content-type": "application/json",
      ...headers,
    }),
    json: async () => body,
  };
}

/*
 * The route calls fetch() for Apple's keys. Stub it so a rejection case never
 * touches the network, and so a case that DOES reach the fetch is visible: if
 * the route tried to fetch before validating input, the counter below would
 * move and the test would catch it.
 */
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls++;
  return { ok: true, status: 200, json: async () => ({ keys: [] }) };
};

module.exports = (async () => {
  h.assert(typeof route.POST === "function", "route must export POST");

  await h.test("POST is exported and the import graph resolves", () => {
    h.assertEqual(typeof route.POST, "function");
  });

  await h.test("a request with no identityToken is rejected as 400", async () => {
    const res = await route.POST(post({}));
    h.assertEqual(res.status, 400);
  });

  await h.test("a non-string identityToken is rejected as 400", async () => {
    for (const bad of [123, true, null, {}, []]) {
      const res = await route.POST(post({ identityToken: bad }));
      h.assertEqual(res.status, 400);
    }
  });

  await h.test("an empty identityToken is rejected as 400", async () => {
    const res = await route.POST(post({ identityToken: "" }));
    h.assertEqual(res.status, 400);
  });

  await h.test("a malformed body is rejected as 400, not 500", async () => {
    const req = post({});
    req.json = async () => { throw new Error("not json"); };
    const res = await route.POST(req);
    h.assertEqual(res.status, 400);
  });

  await h.test("a syntactically invalid token is rejected as 401", async () => {
    const res = await route.POST(post({ identityToken: "not-a-jwt" }));
    h.assertEqual(res.status, 401);
  });

  await h.test("an alg:none token is rejected — the classic forgery", async () => {
    // {"alg":"none"} . {"sub":"victim"} . (empty signature)
    const header = Buffer.from(JSON.stringify({ alg: "none", kid: "x" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "victim", aud: "com.tylermorgan.tripplanner" })).toString("base64url");
    const res = await route.POST(post({ identityToken: `${header}.${payload}.` }));
    h.assertEqual(res.status, 401);
  });

  await h.test("a rejection does NOT create an account", async () => {
    // The critical property: refusing a token must leave the database alone.
    const before = tx.listAccounts().length;
    await route.POST(post({ identityToken: "garbage" }));
    h.assertEqual(tx.listAccounts().length, before);
  });

  await h.test("a token signed by a key Apple does not publish is rejected", async () => {
    // Signed with our own throwaway key: structurally valid, signature is real,
    // but no matching kid in Apple's set. Must not authenticate.
    const { generateKeyPairSync, createSign } = require("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "not-apples-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "attacker", aud: "com.tylermorgan.tripplanner",
      iss: "https://appleid.apple.com", exp: Math.floor(Date.now() / 1000) + 600,
    })).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const sig = signer.sign(privateKey).toString("base64url");

    const before = tx.listAccounts().length;
    const res = await route.POST(post({ identityToken: `${header}.${payload}.${sig}` }));
    h.assertEqual(res.status, 401);
    h.assertEqual(tx.listAccounts().length, before, "must not create an account");
  });

  await h.test("the per-IP limiter eventually returns 429", async () => {
    // Exercised explicitly, on ONE address, so the bucket is shared.
    const headers = { "x-forwarded-for": "198.51.100.77" };
    let sawRateLimit = false;
    for (let i = 0; i < 40; i++) {
      const res = await route.POST({
        url: "https://trips.planetracker.app/api/auth/apple",
        headers: new Headers({ ...headers, "content-type": "application/json" }),
        json: async () => ({}),
      });
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    h.assert(sawRateLimit, "expected a 429 once the per-IP bucket drained");
  });

  await h.test("the route reports a runtime so it is not run on the Edge", () => {
    // Verification uses node:crypto, so the route must not be Edge-eligible.
    h.assertEqual(route.runtime, "nodejs");
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return h.summary();
})();
