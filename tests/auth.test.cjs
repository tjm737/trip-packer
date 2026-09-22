/*
 * Tests for password hashing, session tokens, cookies and lockout policy.
 *
 * The happy path here is trivial — hash a password, verify it, done. These
 * tests therefore concentrate on the paths where a WRONG implementation still
 * looks correct: an empty password, a malformed stored hash, a token containing
 * `=` padding, a lockout that never expires. Those are the cases that ship.
 */

const h = require("./harness.cjs");
const path = require("node:path");

const auth = h.loadModule(path.join(h.SRC, "lib", "auth.ts"));

;(async () => {
  /* ---------------------------------------------------------------- hashing */

  await h.test("a correct password verifies", () => {
    const hash = auth.hashPassword("correct horse battery staple");
    h.assert(hash !== null, "hash should be produced");
    h.assert(
      auth.verifyPassword("correct horse battery staple", hash) === true,
      "the same password must verify"
    );
  });

  await h.test("a wrong password does not verify", () => {
    const hash = auth.hashPassword("right-password");
    h.assert(
      auth.verifyPassword("wrong-password", hash) === false,
      "a different password must not verify"
    );
  });

  await h.test("the same password hashes differently each time (salted)", () => {
    const a = auth.hashPassword("same-password");
    const b = auth.hashPassword("same-password");
    h.assert(a !== b, "two hashes of one password must differ (random salt)");
    h.assert(auth.verifyPassword("same-password", a) === true, "a must verify");
    h.assert(auth.verifyPassword("same-password", b) === true, "b must verify");
  });

  await h.test("the raw password never appears in the stored hash", () => {
    const hash = auth.hashPassword("Hunter2Hunter2");
    h.assert(
      !hash.includes("Hunter2Hunter2"),
      "stored hash must not embed the plaintext"
    );
  });

  /*
   * Empty passwords. The failure being guarded against: if hashPassword("")
   * produced a valid hash, then an account created without a password would
   * authenticate against an empty login field — an instant auth bypass for
   * every unclaimed pre-auth profile.
   */
  await h.test("an empty password is refused, not hashed", () => {
    h.assert(auth.hashPassword("") === null, "empty password must yield null");
    h.assert(auth.verifyPassword("", null) === false, "empty vs null is false");
    h.assert(
      auth.verifyPassword("anything", null) === false,
      "a null stored hash never verifies"
    );
    h.assert(
      auth.verifyPassword("anything", "") === false,
      "an empty stored hash never verifies"
    );
  });

  await h.test("malformed stored hashes are refused without throwing", () => {
    const junk = [
      "not-a-hash",
      "pbkdf2$sha256$abc$salt$hash", // non-numeric iterations
      "pbkdf2$sha256$0$salt$hash", // zero iterations
      "pbkdf2$sha256$-5$salt$hash", // negative iterations
      "pbkdf2$md5$1000$salt$hash", // still parses, unknown digest handled
      "$$$$", // all empty
      "pbkdf2$sha256$600000$$", // empty salt and hash
      "argon2$id$19$m$t", // different scheme
    ];
    for (const stored of junk) {
      let threw = false;
      let result = null;
      try {
        result = auth.verifyPassword("password", stored);
      } catch (e) {
        threw = true;
      }
      h.assert(!threw, `verifyPassword threw on: ${stored}`);
      h.assert(result === false, `malformed hash must fail closed: ${stored}`);
    }
  });

  await h.test("the stored hash is self-describing (algo + iterations + salt)", () => {
    const hash = auth.hashPassword("x-password-y");
    const parts = hash.split("$");
    h.assertEqual(parts.length, 5, "expected 5 fields");
    h.assertEqual(parts[0], "pbkdf2");
    h.assertEqual(parts[1], "sha256");
    h.assert(Number(parts[2]) >= 600000, "iteration count at least OWASP floor");
    h.assert(parts[3].length > 0, "salt present");
    h.assert(parts[4].length > 0, "hash present");
  });

  /* --------------------------------------------------------------- sessions */

  await h.test("session tokens are unique and opaque", () => {
    const a = auth.createSessionToken();
    const b = auth.createSessionToken();
    h.assert(a.token !== b.token, "tokens must differ");
    h.assert(a.token.length >= 32, "token should be long");
    h.assert(
      a.tokenHash !== a.token,
      "the stored value must not be the raw token"
    );
    // base64url: no +, /, or = characters that would need cookie escaping.
    h.assert(
      /^[A-Za-z0-9_-]+$/.test(a.token),
      "token must be cookie-safe base64url"
    );
  });

  await h.test("hashing a token is deterministic and matches on lookup", () => {
    const { token, tokenHash } = auth.createSessionToken();
    h.assertEqual(
      auth.hashSessionToken(token),
      tokenHash,
      "re-hashing the token must reproduce the stored value"
    );
  });

  await h.test("session expiry is in the future and parses", () => {
    const iso = auth.sessionExpiry();
    h.assert(!Number.isNaN(Date.parse(iso)), "expiry must be valid ISO");
    h.assert(auth.isExpired(iso) === false, "a fresh session is not expired");
  });

  await h.test("an expired or unparseable session fails closed", () => {
    h.assert(
      auth.isExpired("2000-01-01T00:00:00.000Z") === true,
      "a past date is expired"
    );
    h.assert(auth.isExpired("not-a-date") === true, "garbage is expired");
    h.assert(auth.isExpired("") === true, "empty is expired");
  });

  /* ---------------------------------------------------------------- cookies */

  await h.test("cookie round-trips a token that contains padding", () => {
    // The trap: splitting the header on every '=' truncates a token that ends
    // in padding. Split on the FIRST '=' only.
    const token = "abc123==def456==";
    const cookie = auth.serializeSessionCookie(token, 3600, false);
    const parsed = auth.readCookie(cookie, auth.SESSION_COOKIE);
    h.assertEqual(parsed, token, "token must survive the round trip intact");
  });

  await h.test("cookie is HttpOnly and SameSite=Lax", () => {
    const cookie = auth.serializeSessionCookie("tok", 3600, true);
    h.assert(cookie.includes("HttpOnly"), "must be HttpOnly");
    h.assert(cookie.includes("SameSite=Lax"), "must be SameSite=Lax");
    h.assert(cookie.includes("Secure"), "must set Secure when asked");
  });

  await h.test("Secure is omitted on plain http so localhost login works", () => {
    const cookie = auth.serializeSessionCookie("tok", 3600, false);
    h.assert(
      !cookie.includes("Secure"),
      "Secure on http://localhost is dropped by the browser and breaks login"
    );
  });

  await h.test("clearing the cookie expires it", () => {
    const cleared = auth.clearSessionCookie(true);
    h.assert(cleared.includes("Max-Age=0"), "must expire the cookie");
    h.assert(auth.readCookie(cleared, auth.SESSION_COOKIE) === "", "value emptied");
  });

  await h.test("readCookie handles absence and malformed headers", () => {
    h.assertEqual(auth.readCookie(null, "tp_session"), null, "null header");
    h.assertEqual(auth.readCookie("", "tp_session"), null, "empty header");
    h.assertEqual(auth.readCookie("other=1", "tp_session"), null, "absent name");
    h.assertEqual(auth.readCookie("novalue", "tp_session"), null, "no equals sign");
    h.assertEqual(
      auth.readCookie("a=1; tp_session=xyz; b=2", "tp_session"),
      "xyz",
      "finds the cookie among others"
    );
  });

  /* ----------------------------------------------------------- lockout policy */

  await h.test("lockout triggers only after the maximum failures", () => {
    h.assert(auth.isLockedOut(0, new Date().toISOString()) === false, "0 fails");
    h.assert(
      auth.isLockedOut(4, new Date().toISOString()) === false,
      "below the max is not locked"
    );
    h.assert(
      auth.isLockedOut(5, new Date().toISOString()) === true,
      "at the max is locked"
    );
  });

  await h.test("lockout expires so it cannot deny an account forever", () => {
    const old = new Date(Date.now() - auth.ATTEMPT_WINDOW_MS - 1000).toISOString();
    h.assert(
      auth.isLockedOut(99, old) === false,
      "an old failure burst must not lock permanently"
    );
  });

  await h.test("failure counter resets after the window passes", () => {
    const old = new Date(Date.now() - auth.ATTEMPT_WINDOW_MS - 1000).toISOString();
    const next = auth.nextFailureState({
      failures: 4,
      firstFailedAt: old,
    });
    h.assertEqual(next.failures, 1, "a stale burst restarts the count at 1");
  });

  await h.test("failure counter accumulates within the window", () => {
    const now = new Date().toISOString();
    const next = auth.nextFailureState({ failures: 2, firstFailedAt: now });
    h.assertEqual(next.failures, 3, "should accumulate");
  });

  await h.test("first failure starts the counter at one", () => {
    const next = auth.nextFailureState(null);
    h.assertEqual(next.failures, 1, "first failure is 1");
    h.assert(
      !Number.isNaN(Date.parse(next.firstFailedAt)),
      "records when the burst started"
    );
  });

  h.summary();
})();
