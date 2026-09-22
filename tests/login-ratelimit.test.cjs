/*
 * Tests for the per-IP login rate limiter.
 *
 * The per-email lockout (already covered in auth.test.cjs) stops a targeted
 * brute force. This limiter exists for the gap that leaves open: SPRAYING —
 * one guess each across thousands of addresses, where every address has its own
 * fresh counter and nothing caps the total volume.
 *
 * These tests concentrate on the ways a token bucket is written WRONGLY while
 * still passing a happy-path test:
 *
 *   - a bucket that never refills          -> permanent lockout after one burst
 *   - a bucket that refills without a cap  -> tokens bank up, then release as a
 *                                             flood, which is worse than none
 *   - shared state across keys             -> one attacker locks out everyone
 *   - a clock that moves backwards         -> tokens go negative and stay there
 *   - spoofable IP selection               -> attacker picks a fresh bucket per
 *                                             request and bypasses it entirely
 *
 * Time is injected everywhere, so none of this sleeps for real.
 */

const h = require("./harness.cjs");
const path = require("node:path");

const auth = h.loadModule(path.join(h.SRC, "lib", "auth.ts"));

const IP = "203.0.113.7";
const OTHER = "198.51.100.9";
const T0 = Date.parse("2026-01-01T00:00:00.000Z");

/** Drain a bucket and return how many requests it allowed. */
function drain(key, at) {
  let allowed = 0;
  // Well past the burst size, so the count is the real capacity.
  for (let i = 0; i < auth.LOGIN_BURST * 4; i++) {
    if (auth.takeLoginToken(key, at)) allowed++;
  }
  return allowed;
}

(async () => {
  /* ------------------------------------------------------------ capacity */

  await h.test("a fresh key allows exactly LOGIN_BURST requests", () => {
    auth.resetLoginBuckets();
    const allowed = drain(IP, T0);
    h.assertEqual(
      allowed,
      auth.LOGIN_BURST,
      "a new bucket must hold exactly the burst size, no more"
    );
  });

  await h.test("the request after the burst is refused", () => {
    auth.resetLoginBuckets();
    drain(IP, T0);
    h.assert(
      auth.takeLoginToken(IP, T0) === false,
      "an exhausted bucket must refuse the next request"
    );
  });

  /* ------------------------------------------------------------- refill */

  await h.test("a bucket refills over time", () => {
    auth.resetLoginBuckets();
    drain(IP, T0);
    h.assert(
      auth.takeLoginToken(IP, T0) === false,
      "precondition: bucket is empty"
    );
    // One refill interval is worth exactly one token.
    h.assert(
      auth.takeLoginToken(IP, T0 + auth.LOGIN_REFILL_MS) === true,
      "one full interval must restore one token"
    );
  });

  await h.test("a partially elapsed interval does not grant a whole token", () => {
    auth.resetLoginBuckets();
    drain(IP, T0);
    h.assert(
      auth.takeLoginToken(IP, T0 + auth.LOGIN_REFILL_MS / 2) === false,
      "half an interval must not yet be a token"
    );
  });

  await h.test("idle tokens do NOT bank above the burst size", () => {
    /**
     * The failure this catches is subtle and worse than having no limiter: if
     * tokens accumulate while idle, an attacker makes one request per hour for
     * a week and then spends a week's worth of tokens as a single flood. The
     * cap must be the burst size regardless of how long the bucket sat full.
     */
    auth.resetLoginBuckets();
    drain(IP, T0);
    // Idle for a very long time — enough for thousands of tokens unbounded.
    const muchLater = T0 + auth.LOGIN_REFILL_MS * 10_000;
    const allowed = drain(IP, muchLater);
    h.assertEqual(
      allowed,
      auth.LOGIN_BURST,
      "a long idle period must still cap at the burst size, not bank tokens"
    );
  });

  /* ---------------------------------------------------------- isolation */

  await h.test("one exhausted key does not affect another", () => {
    /**
     * The failure this catches is a single shared bucket. If every request
     * drew from one global counter, any attacker could lock out every user by
     * flooding once — turning the mitigation into the vulnerability.
     */
    auth.resetLoginBuckets();
    drain(IP, T0);
    h.assert(
      auth.takeLoginToken(OTHER, T0) === true,
      "an untouched key must still have its full allowance"
    );
  });

  /* ------------------------------------------------------- clock safety */

  await h.test("a backwards clock does not corrupt the bucket", () => {
    /**
     * Date.now() is not monotonic; NTP can step it backwards. A naive
     * implementation computes a negative elapsed time and either grants tokens
     * it should not or drives the count negative permanently. Neither may
     * happen: going backwards must simply not refill.
     */
    auth.resetLoginBuckets();
    drain(IP, T0);
    // Ask for a token at a time BEFORE the last update.
    h.assert(
      auth.takeLoginToken(IP, T0 - 60_000) === false,
      "a backwards clock must not refill the bucket"
    );
    // And the bucket must still work normally once time moves forward again.
    h.assert(
      auth.takeLoginToken(IP, T0 + auth.LOGIN_REFILL_MS) === true,
      "the bucket must recover after a backwards step"
    );
  });

  /* -------------------------------------------------------- retry-after */

  await h.test("retryAfterSeconds is 0 when a token is available", () => {
    auth.resetLoginBuckets();
    h.assertEqual(
      auth.retryAfterSeconds(IP, T0),
      0,
      "a fresh key needs no wait"
    );
  });

  await h.test("retryAfterSeconds is positive for an exhausted key", () => {
    auth.resetLoginBuckets();
    drain(IP, T0);
    const retry = auth.retryAfterSeconds(IP, T0);
    h.assert(retry > 0, "an exhausted key must advertise a wait");
    h.assert(
      retry <= Math.ceil(auth.LOGIN_REFILL_MS / 1000) + 1,
      "the wait must not exceed one refill interval by more than a rounding second"
    );
  });

  await h.test("a key with no bucket at all reports no wait", () => {
    auth.resetLoginBuckets();
    h.assertEqual(
      auth.retryAfterSeconds("never-seen", T0),
      0,
      "an unknown key must not be told to wait"
    );
  });

  /* ------------------------------------------------------ IP resolution */

  await h.test("clientIpFrom takes the RIGHTMOST forwarded address", () => {
    /**
     * nginx APPENDS the address it saw, so a client that forges the header
     * produces "forged, real". Taking the leftmost value would let an attacker
     * choose a new bucket key per request and bypass the limiter completely,
     * so the rightmost — the one the proxy added — is the only safe choice.
     */
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 203.0.113.7",
    });
    h.assertEqual(
      auth.clientIpFrom(headers),
      "203.0.113.7",
      "the proxy-appended address is the rightmost entry"
    );
  });

  await h.test("clientIpFrom ignores attacker padding on the left", () => {
    auth.resetLoginBuckets();
    // Two requests, each forging a DIFFERENT leftmost value while the proxy
    // appends the same real address. They must land in one bucket, or the
    // limiter is trivially bypassed by rotating a fake header.
    const a = auth.clientIpFrom(
      new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })
    );
    const b = auth.clientIpFrom(
      new Headers({ "x-forwarded-for": "8.8.8.8, 203.0.113.7" })
    );
    h.assertEqual(a, b, "forging the leftmost entry must not change the key");
  });

  await h.test("clientIpFrom handles a single address", () => {
    h.assertEqual(
      auth.clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7" })),
      "203.0.113.7",
      "a lone address is used as-is"
    );
  });

  await h.test("clientIpFrom falls back to x-real-ip", () => {
    h.assertEqual(
      auth.clientIpFrom(new Headers({ "x-real-ip": "203.0.113.7" })),
      "203.0.113.7",
      "x-real-ip is honoured when there is no forwarded chain"
    );
  });

  await h.test("clientIpFrom returns a shared bucket when headers are absent", () => {
    /**
     * Returning null/empty here would make every header-less request its own
     * key, which is an unlimited bypass. A sentinel keeps them pooled.
     */
    const withNone = auth.clientIpFrom(new Headers());
    h.assert(
      typeof withNone === "string" && withNone.length > 0,
      "a missing header must still produce a key"
    );
    h.assertEqual(
      withNone,
      auth.clientIpFrom(new Headers({ "x-forwarded-for": "   " })),
      "a blank header must pool with the absent one, not create a new key"
    );
  });

  /* ------------------------------------------------------------- limits */

  await h.test("a burst of LOGIN_BURST is allowed within one second", () => {
    /**
     * Regression guard on the human side: a legitimate person who mistypes
     * their password a few times must not be shut out during normal use.
     */
    auth.resetLoginBuckets();
    let allowed = 0;
    for (let i = 0; i < auth.LOGIN_BURST; i++) {
      if (auth.takeLoginToken(IP, T0 + i)) allowed++;
    }
    h.assertEqual(
      allowed,
      auth.LOGIN_BURST,
      "a normal person must be able to use the full burst immediately"
    );
  });

  await h.test("sustained hammering is throttled to the refill rate", () => {
    /**
     * The point of the feature. Over a minute an attacker gets the initial
     * burst plus one token per interval — nowhere near enough to run a
     * wordlist, which is the whole reason this exists.
     */
    auth.resetLoginBuckets();
    const oneMinute = 60_000;
    let allowed = 0;
    // One attempt every 100ms for a minute: 600 attempts.
    for (let t = 0; t < oneMinute; t += 100) {
      if (auth.takeLoginToken(IP, T0 + t)) allowed++;
    }
    const ceiling =
      auth.LOGIN_BURST + Math.ceil(oneMinute / auth.LOGIN_REFILL_MS) + 1;
    h.assert(
      allowed <= ceiling,
      `600 attempts in a minute must be capped near ${ceiling}, got ${allowed}`
    );
    h.assert(
      allowed < 60,
      `the cap must be far below the 600 attempts made, got ${allowed}`
    );
  });

  h.summary();
})();
