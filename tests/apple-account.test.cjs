/*
 * Account resolution for Sign in with Apple.
 *
 * These tests exist because linking-by-email is where account takeover lives.
 * The dangerous shape is: attacker obtains a token carrying victim@example.com
 * and is silently handed the victim's trips. The cases below pin down exactly
 * when a link is allowed and, just as importantly, when it is refused.
 */

const h = require("./harness.cjs");

const { resolveAccount, nameForExistingAccount, DEFAULT_APPLE_NAME } = h.loadModule(
  "src/lib/appleAccount.ts"
);

const SUB = "001234.abcdef.0012";

function account(overrides = {}) {
  return {
    id: "u1",
    name: "Tyler",
    email: null,
    passwordHash: null,
    appleUserId: null,
    ...overrides,
  };
}

module.exports = (async () => {
  /* ------------------------------------------------------------ rule 1: sub */

  await h.test("an account already bound to this Apple sub signs in", () => {
    const existing = account({ id: "u7", appleUserId: SUB, email: "tyler@example.com" });
    const result = resolveAccount([existing], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.via, "apple-sub");
    h.assertEqual(result.account.id, "u7");
  });

  await h.test("the sub wins even when the email has CHANGED", () => {
    // Apple lets a user change the address associated with their Apple ID.
    // `sub` is stable; email is not. The binding must survive the change.
    const existing = account({ id: "u7", appleUserId: SUB, email: "old@example.com" });
    const result = resolveAccount([existing], SUB, "brand-new@example.com", true, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.via, "apple-sub");
    h.assertEqual(result.account.id, "u7");
  });

  await h.test("the sub wins even when the email arrives UNVERIFIED", () => {
    const existing = account({ id: "u7", appleUserId: SUB });
    const result = resolveAccount([existing], SUB, "whatever@example.com", false, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.via, "apple-sub");
  });

  /* -------------------------------------------------- rule 2: verified link */

  await h.test("a VERIFIED email links to an existing password account", () => {
    const existing = account({ id: "u2", email: "tyler@example.com", passwordHash: "pbkdf2$..." });
    const result = resolveAccount([existing], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.via, "verified-email");
    h.assertEqual(result.account.id, "u2");
  });

  await h.test("email matching is case-insensitive and trimmed", () => {
    const existing = account({ id: "u2", email: "tyler@example.com", passwordHash: "h" });
    const result = resolveAccount([existing], SUB, "  TYLER@Example.COM  ", true, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.account.id, "u2");
  });

  await h.test("an UNVERIFIED email does NOT link — it creates a new account instead", () => {
    // The takeover case. An unverified address must never absorb an existing
    // account, no matter how well it matches.
    const existing = account({ id: "u2", email: "tyler@example.com", passwordHash: "h" });
    const result = resolveAccount([existing], SUB, "tyler@example.com", false, null);
    h.assertEqual(result.action, "create");
    h.assertEqual(result.appleUserId, SUB);
  });

  await h.test("a verified email does NOT claim a passwordless placeholder profile", () => {
    // Old switchable-list profiles have no credentials. Absorbing one by email
    // would hand over its trips to whoever controls that address.
    const placeholder = account({ id: "u3", email: "tyler@example.com", passwordHash: null, appleUserId: null });
    const result = resolveAccount([placeholder], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.action, "create");
    h.assert(result.action !== "sign-in", "must not sign in as the placeholder");
  });

  await h.test("a verified email DOES link to an account already bound to Apple", () => {
    // Bound to a DIFFERENT sub — e.g. the same person on a second Apple ID.
    const existing = account({ id: "u4", email: "tyler@example.com", appleUserId: "other-sub" });
    const result = resolveAccount([existing], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.action, "sign-in");
    h.assertEqual(result.via, "verified-email");
  });

  await h.test("the sub-path is preferred over an email link when both exist", () => {
    const bySub = account({ id: "sub-account", appleUserId: SUB, email: "other@example.com" });
    const byEmail = account({ id: "email-account", email: "tyler@example.com", passwordHash: "h" });
    const result = resolveAccount([byEmail, bySub], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.account.id, "sub-account");
  });

  /* --------------------------------------------------------- rule 3: create */

  await h.test("an unknown user creates an account carrying the sub", () => {
    const result = resolveAccount([], SUB, "new@example.com", true, "Tyler Morgan");
    h.assertEqual(result.action, "create");
    h.assertEqual(result.name, "Tyler Morgan");
    h.assertEqual(result.email, "new@example.com");
    h.assertEqual(result.appleUserId, SUB);
  });

  await h.test("a private relay address is stored as-is", () => {
    const relay = "abc123@privaterelay.appleid.com";
    const result = resolveAccount([], SUB, relay, true, null);
    h.assertEqual(result.action, "create");
    h.assertEqual(result.email, relay);
  });

  await h.test("a create with no name falls back to the email local part", () => {
    const result = resolveAccount([], SUB, "tyler@example.com", true, null);
    h.assertEqual(result.action, "create");
    h.assertEqual(result.name, "tyler");
  });

  await h.test("a create with neither name nor email uses the default", () => {
    const result = resolveAccount([], SUB, null, false, null);
    h.assertEqual(result.action, "create");
    h.assertEqual(result.name, DEFAULT_APPLE_NAME);
    h.assertEqual(result.email, null);
  });

  await h.test("a blank name is treated as absent, not stored", () => {
    const result = resolveAccount([], SUB, "tyler@example.com", true, "   ");
    h.assertEqual(result.name, "tyler");
  });

  await h.test("a created email is normalised to lowercase", () => {
    const result = resolveAccount([], SUB, "  Tyler@Example.COM ", true, null);
    h.assertEqual(result.email, "tyler@example.com");
  });

  /* --------------------------------------------------------------- reject */

  await h.test("a missing sub is rejected outright", () => {
    for (const bad of ["", null, undefined]) {
      const result = resolveAccount([], bad, "a@b.com", true, null);
      h.assertEqual(result.action, "reject");
    }
  });

  /* ----------------------------------------------------------- name rules */

  await h.test("Apple's one-time name is used when present", () => {
    h.assertEqual(nameForExistingAccount("Old", "Tyler Morgan"), "Tyler Morgan");
  });

  await h.test("a later sign-in WITHOUT a name does not blank the stored one", () => {
    // Apple sends the name only on first authorisation. Returning null here
    // would overwrite a real name with nothing on every subsequent login.
    h.assertEqual(nameForExistingAccount("Tyler Morgan", null), "Tyler Morgan");
    h.assertEqual(nameForExistingAccount("Tyler Morgan", ""), "Tyler Morgan");
    h.assertEqual(nameForExistingAccount("Tyler Morgan", "   "), "Tyler Morgan");
  });

  await h.test("a missing name stays missing when there is nothing to preserve", () => {
    h.assertEqual(nameForExistingAccount(null, null), null);
    h.assertEqual(nameForExistingAccount(null, ""), null);
  });

  return h.summary();
})();
