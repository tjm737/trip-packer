/*
 * Apple identity-token verification.
 *
 * The point of these tests is that NOTHING about an unverified token may be
 * trusted. Each rejection case below is a real attack, not a hypothetical:
 *
 *   forged signature   -> claim to be any user id you like
 *   alg: none          -> the classic JWT downgrade
 *   wrong audience     -> reuse a token minted for a different app
 *   expired            -> replay an old token
 *   wrong issuer       -> accept a token from somewhere that is not Apple
 *
 * A real signature is produced with a throwaway RSA keypair so the happy path
 * exercises actual crypto rather than a stub that always returns true.
 */

const { createSign, generateKeyPairSync } = require("crypto");
const h = require("./harness.cjs");

const { verifyIdentityToken, decodeJwt, claimIsTrue, APPLE_ISSUER } = h.loadModule(
  "src/lib/appleAuth.ts"
);

const AUDIENCE = "com.tylermorgan.tripplanner";

/* A throwaway keypair, generated once for this file. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const KID = "test-key-1";
const KEYS = [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }];

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

/** Mint a token. Overrides let each test break exactly one thing. */
function mint(payloadOverrides = {}, headerOverrides = {}, signWith = privateKey) {
  const header = { alg: "RS256", kid: KID, typ: "JWT", ...headerOverrides };
  const payload = {
    iss: APPLE_ISSUER,
    aud: AUDIENCE,
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    sub: "001234.abcdef.0012",
    email: "tyler@example.com",
    email_verified: true,
    ...payloadOverrides,
  };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(signWith);
  return `${signingInput}.${signature.toString("base64url")}`;
}

module.exports = (async () => {
  /* ---------------------------------------------------------------- happy */

  await h.test("a valid token verifies and returns its payload", () => {
    const result = verifyIdentityToken(mint(), KEYS, AUDIENCE);
    h.assert(result.ok, "expected ok", result);
    h.assertEqual(result.payload.sub, "001234.abcdef.0012");
    h.assertEqual(result.payload.email, "tyler@example.com");
  });

  /* ------------------------------------------------------------ signature */

  await h.test("a token signed by a DIFFERENT key is rejected", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = mint({}, {}, other.privateKey);
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "signature mismatch");
  });

  await h.test("a tampered payload invalidates the signature", () => {
    const token = mint();
    const [head, , sig] = token.split(".");
    // Re-encode a payload claiming a different subject, keeping the signature.
    const forgedPayload = b64url({
      iss: APPLE_ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: "999999.someone.else",
    });
    const result = verifyIdentityToken(`${head}.${forgedPayload}.${sig}`, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "signature mismatch");
  });

  /* ------------------------------------------------------------------ alg */

  await h.test("alg:none is rejected even though there is no signature to check", () => {
    const header = b64url({ alg: "none", kid: KID, typ: "JWT" });
    const payload = b64url({
      iss: APPLE_ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: "001234.abcdef.0012",
    });
    const result = verifyIdentityToken(`${header}.${payload}.`, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "unexpected alg");
  });

  await h.test("alg:HS256 (symmetric) is rejected", () => {
    const token = mint({}, { alg: "HS256" });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "unexpected alg");
  });

  /* ------------------------------------------------------------------ kid */

  await h.test("an unknown kid is rejected rather than falling back", () => {
    const token = mint({}, { kid: "no-such-key" });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "unknown key id");
  });

  await h.test("a missing kid is rejected", () => {
    const token = mint({}, { kid: undefined });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "missing kid");
  });

  /* --------------------------------------------------------------- claims */

  await h.test("a wrong audience is rejected (token minted for another app)", () => {
    const token = mint({ aud: "com.someone.else.app" });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "bad audience");
  });

  await h.test("a wrong issuer is rejected", () => {
    const token = mint({ iss: "https://evil.example.com" });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "bad issuer");
  });

  await h.test("an expired token is rejected", () => {
    const token = mint({ exp: Math.floor(Date.now() / 1000) - 1 });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "token expired");
  });

  await h.test("expiry is checked against the injected clock", () => {
    // Valid for another 10 minutes; assert it is dead an hour later.
    const token = mint();
    const later = Date.now() + 3600 * 1000;
    h.assertEqual(verifyIdentityToken(token, KEYS, AUDIENCE, later).ok, false);
  });

  await h.test("a missing exp is rejected rather than treated as non-expiring", () => {
    const token = mint({ exp: undefined });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "missing exp");
  });

  await h.test("a missing sub is rejected", () => {
    const token = mint({ sub: undefined });
    const result = verifyIdentityToken(token, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
    h.assertEqual(result.reason, "missing sub");
  });

  /* ------------------------------------------------------------ malformed */

  await h.test("structurally invalid tokens are rejected, not thrown", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "....", "not a jwt at all"]) {
      const result = verifyIdentityToken(bad, KEYS, AUDIENCE);
      h.assertEqual(result.ok, false, `expected reject for ${JSON.stringify(bad)}`);
    }
  });

  await h.test("a non-string token is rejected", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      h.assertEqual(verifyIdentityToken(bad, KEYS, AUDIENCE).ok, false);
    }
  });

  await h.test("a token with a non-JSON payload is rejected", () => {
    const header = b64url({ alg: "RS256", kid: KID });
    const result = verifyIdentityToken(`${header}.bm90anNvbg.sig`, KEYS, AUDIENCE);
    h.assertEqual(result.ok, false);
  });

  /* --------------------------------------------------------- key material */

  await h.test("keys missing n/e/kid are skipped, not coerced", () => {
    const token = mint();
    h.assertEqual(verifyIdentityToken(token, [{ kid: KID, kty: "RSA" }], AUDIENCE).ok, false);
    h.assertEqual(verifyIdentityToken(token, [], AUDIENCE).ok, false);
  });

  await h.test("a non-RSA key with a matching kid does not verify", () => {
    const token = mint();
    const result = verifyIdentityToken(
      token,
      [{ kty: "EC", kid: KID, n: "abc", e: "AQAB" }],
      AUDIENCE
    );
    h.assertEqual(result.ok, false);
  });

  /* -------------------------------------------------------------- helpers */

  await h.test("decodeJwt returns header and payload without trusting them", () => {
    const decoded = decodeJwt(mint());
    h.assert(decoded !== null, "expected a decode");
    h.assertEqual(decoded.header.alg, "RS256");
    h.assertEqual(decoded.payload.sub, "001234.abcdef.0012");
  });

  await h.test("claimIsTrue does not treat the STRING 'false' as true", () => {
    // The bug this guards: "false" is truthy in JS, so a naive `if (value)`
    // would mark an unverified relay address as verified.
    h.assertEqual(claimIsTrue("false"), false);
    h.assertEqual(claimIsTrue(false), false);
    h.assertEqual(claimIsTrue(undefined), false);
    h.assertEqual(claimIsTrue("true"), true);
    h.assertEqual(claimIsTrue(true), true);
  });

  return h.summary();
})();
