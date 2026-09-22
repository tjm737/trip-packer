import { NextResponse } from "next/server";

import { tx } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { getActingUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/*
 * POST /api/accounts — create a login-capable account.
 *
 * Invite-only by design. This is the web equivalent of
 * `npm run create-account`, not an open signup endpoint: the caller must
 * already hold an owner session. See the note in create-account.cjs ("registration
 * is closed") and scripts/check-useradd-escalation.cjs for why.
 *
 * Three things this endpoint is responsible for, mirroring the CLI:
 *
 * 1. Credentials are minted SERVER-SIDE. The client sends a plaintext password
 *    which is hashed here; it can never send a `passwordHash` or an `isOwner`
 *    flag. Those are the two escalations the guard test covers — a client that
 *    could set either would be minting itself (or someone else) an admin login.
 *    The new account is therefore always isOwner: false, unconditionally.
 *
 * 2. Owner-gating is enforced here and not merely hidden in the UI. Hiding the
 *    button is presentation; this check is the actual permission. A non-owner
 *    posting directly to this route gets 403.
 *
 * 3. The password rules match the CLI exactly (>= 8 chars) so the two paths
 *    cannot drift into disagreeing about what a valid account is.
 */

/** Mirrors the CLI's deliberately lenient check: catch typos, not deliverability. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: {
    email?: unknown;
    name?: unknown;
    password?: unknown;
    avatarColor?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  try {
    const actor = await getActingUser();
    if (!actor) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    /*
     * The real gate. Deliberately checked after authentication so an anonymous
     * probe gets 401 (nothing to learn) while a signed-in non-owner gets 403
     * (the permission is the problem, not the identity).
     */
    if (!actor.isOwner) {
      return NextResponse.json(
        { error: "Only the account owner can create accounts" },
        { status: 403 }
      );
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const avatarColor =
      typeof body.avatarColor === "string" && body.avatarColor
        ? body.avatarColor
        : "bg-emerald-500";

    if (!email || !name) {
      return NextResponse.json(
        { error: "Email and name are required" },
        { status: 400 }
      );
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "That does not look like an email address" },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Checked before hashing: PBKDF2 is expensive, and there is no reason to
    // pay for it to then reject the insert.
    const existing = tx.getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: "An account with that email already exists" },
        { status: 409 }
      );
    }

    const hash = hashPassword(password);
    if (!hash) {
      return NextResponse.json(
        { error: "Failed to hash the password" },
        { status: 500 }
      );
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      avatarColor,
      createdAt: new Date().toISOString(),
      email,
      passwordHash: hash,
      /*
       * Never taken from the request. New accounts are never owners; the first
       * account on a fresh install is promoted by the CLI, not from here.
       */
      isOwner: false,
      /*
       * insertAccount's INSERT does not write this column, so SQLite applies its
       * default and `toUser` resolves the real value on read. Passed here only
       * to satisfy User, which requires the field; it is not persisted from
       * this object. Keep in step with the column default in db.ts.
       */
      theme: "dark" as const,
    };

    tx.insertAccount(user);

    /*
     * Read back rather than trusting the in-memory object. This proves the
     * credential columns actually landed — the same check the CLI performs,
     * and the one that would have caught insertUser silently dropping them.
     */
    const stored = tx.getUserByEmail(email);
    if (!stored || !stored.passwordHash) {
      return NextResponse.json(
        { error: "Account was not created" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: { id: stored.id, name: stored.name, email: stored.email },
    });
  } catch (err) {
    console.error("[api/accounts] failed:", err);
    return NextResponse.json(
      { error: "Could not create the account" },
      { status: 500 }
    );
  }
}
