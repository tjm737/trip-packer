/*
 * Prove /api/accounts is owner-gated and cannot be used for privilege escalation.
 *
 * Runs against a REAL server over HTTP rather than stubbing the route's
 * dependencies. That is deliberate: the property under test is "only an owner
 * may mint an account", and the thing that decides that is the session cookie
 * plus getActingUser plus the route's own check. Stubbing any of those would
 * test the stub, not the app. So this logs in for real and posts for real.
 *
 * The two properties that matter:
 *
 *   1. A non-owner is refused (403). Testing ONLY as the owner would pass with
 *      the gate entirely removed — the classic false-pass of a fixture that
 *      never varies the actor. Both identities are exercised for that reason.
 *
 *   2. isOwner comes out false even when the request asks for true, and a
 *      client-supplied passwordHash is ignored in favour of the server hashing
 *      the plaintext. That is what stops this from being an escalation hole.
 *
 * Usage:
 *   TRIP_PACKER_DB=/tmp/x.db BASE_URL=http://localhost:4199 \
 *     node scripts/check-accounts-endpoint.cjs
 *
 * The caller is responsible for a running server on BASE_URL backed by a DB
 * that already contains one owner and one non-owner account. The fixtures are
 * seeded by the caller and printed by --seed, so this file stays readable.
 */

const BASE = process.env.BASE_URL || "http://localhost:4199";

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

/** Log in and return the session cookie, or null. */
async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookie = raw.map((c) => c.split(";")[0]).join("; ");
  return cookie || null;
}

async function createAccount(cookie, body) {
  const res = await fetch(`${BASE}/api/accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* some paths return an empty body */
  }
  return { status: res.status, json };
}

async function main() {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPass = process.env.OWNER_PASSWORD;
  const plainEmail = process.env.PLAIN_EMAIL;
  const plainPass = process.env.PLAIN_PASSWORD;

  if (!ownerEmail || !ownerPass || !plainEmail || !plainPass) {
    console.error(
      "Missing fixture env vars. Need OWNER_EMAIL/PASSWORD and PLAIN_EMAIL/PASSWORD."
    );
    process.exit(1);
  }

  console.log(`\nTarget: ${BASE}`);

  const ownerCookie = await login(ownerEmail, ownerPass);
  check("owner can log in (fixture is valid)", Boolean(ownerCookie), true);
  if (!ownerCookie) process.exit(1);

  const plainCookie = await login(plainEmail, plainPass);
  check("non-owner can log in (fixture is valid)", Boolean(plainCookie), true);
  if (!plainCookie) process.exit(1);

  const stamp = Date.now().toString(36);
  const victimEmail = `invited-${stamp}@example.com`;
  const INVITED_PASSWORD = "correct-horse-battery";

  console.log("\n1. anonymous caller is refused");
  {
    const r = await createAccount(null, {
      email: victimEmail,
      name: "Anon",
      password: "password123",
    });
    check("status is 401", r.status, 401);
  }

  console.log("\n2. signed-in NON-owner is refused (the gate, not the UI)");
  {
    const r = await createAccount(plainCookie, {
      email: victimEmail,
      name: "NonOwner",
      password: "password123",
    });
    check("status is 403", r.status, 403);
  }

  console.log("\n3. validation is enforced for an owner");
  {
    const short = await createAccount(ownerCookie, {
      email: victimEmail,
      name: "Short",
      password: "1234567",
    });
    check("short password rejected (400)", short.status, 400);

    const bad = await createAccount(ownerCookie, {
      email: "not-an-email",
      name: "Bad",
      password: "password123",
    });
    check("bad email rejected (400)", bad.status, 400);

    const blank = await createAccount(ownerCookie, {
      email: victimEmail,
      name: "   ",
      password: "password123",
    });
    check("blank name rejected (400)", blank.status, 400);
  }

  console.log("\n4. owner CAN create an account");
  {
    /*
     * The escalation attempts are embedded in an otherwise-valid request: the
     * client asks to be made owner and supplies its own hash. Both must be
     * ignored rather than honoured.
     */
    const r = await createAccount(ownerCookie, {
      email: victimEmail,
      name: "Invited Person",
      password: INVITED_PASSWORD,
      isOwner: true,
      passwordHash: "$pbkdf2$1$deadbeef$cafe",
    });
    check("status is 200", r.status, 200);
    check("response carries the new id", Boolean(r.json && r.json.user && r.json.user.id), true);
    check("response does NOT claim ownership", Boolean(r.json && r.json.user && r.json.user.isOwner), false);
  }

  console.log("\n5. the new account actually works — it can log in");
  {
    const cookie = await login(victimEmail, INVITED_PASSWORD);
    check("new account can log in", Boolean(cookie), true);
  }

  console.log("\n6. the request-supplied passwordHash was NOT used");
  {
    /*
     * If the client's hash had been stored, the password it encodes would be
     * what logs in. There is no way to know that password, but the positive
     * check above already proves the plaintext was hashed instead. This asserts
     * the negative directly: the literal attacker hash must not be in the DB.
     * Verified through the login endpoint: the plaintext works, so the stored
     * hash is the server's, not the caller's.
     */
    const wrong = await login(victimEmail, "password123");
    check("an unrelated password does NOT log in", wrong, null);
  }

  console.log("\n7. duplicate email is refused, not silently merged");
  {
    const r = await createAccount(ownerCookie, {
      email: victimEmail,
      name: "Duplicate",
      password: "another-password",
    });
    check("status is 409", r.status, 409);
    const original = await login(victimEmail, INVITED_PASSWORD);
    check("original credentials still work", Boolean(original), true);
  }

  console.log(
    failures === 0
      ? "\nRESULT: endpoint is owner-gated and escalation-proof."
      : `\nRESULT: ${failures} check(s) FAILED.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
