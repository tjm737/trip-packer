/*
 * Account resolution for Sign in with Apple.
 *
 * Given a VERIFIED Apple payload and the current account table, decide which
 * account the session belongs to. Kept pure and separate from the route so the
 * linking rules can be tested exhaustively — this is where account-takeover
 * bugs live, and they are not the kind of thing to reason about by reading a
 * request handler.
 *
 * The linking rule, stated once:
 *
 *   1. An account already bound to this Apple `sub` wins, always. `sub` is the
 *      stable identifier and is the only thing Apple guarantees is unchanged.
 *   2. Otherwise, an account with the SAME email is linked — but ONLY when
 *      Apple says the email is verified.
 *   3. Otherwise, a new account is created.
 *
 * Rule 2 is the dangerous one. Without the verified check, anyone who can get
 * Apple to emit a token carrying someone else's address would be handed that
 * person's trips. Apple does not let you set an arbitrary email, but private
 * relay addresses and unverified claims make "the email in the token is
 * trustworthy" a claim worth checking rather than assuming. The tests cover it.
 *
 * A deliberate asymmetry: we never match on email when the existing account
 * has NO password AND no Apple binding. Such a profile is an unclaimed
 * placeholder from the old switchable list; letting a token claim it by email
 * would let an attacker absorb a profile's data by guessing its address. The
 * user can still be reached via rule 3 with a fresh account.
 */

/**
 * The subset of an account row the resolver needs.
 *
 * `email` is `string | null | undefined` because the two callers disagree by
 * accident of history: the database row types say `null`, while the
 * server-side `UserWithSecret` shape omits the field entirely rather than
 * setting it to null. Accepting both here is deliberate — the resolver only
 * ever tests the email for equality to a normalised string, so `undefined` and
 * `null` behave identically, and widening the input is better than forcing a
 * lossy conversion at one of the two call sites.
 */
export type AccountLike = {
  id: string;
  name: string;
  email?: string | null;
  passwordHash?: string | null;
  appleUserId?: string | null;
  isOwner?: number | boolean;
};

export type ResolveOutcome =
  /** An existing account matched; sign in as it. */
  | { action: "sign-in"; account: AccountLike; via: "apple-sub" | "verified-email" }
  /** No match; create an account with these fields. */
  | { action: "create"; name: string; email: string | null; appleUserId: string }
  /** The request is well-formed but must not be honoured. */
  | { action: "reject"; reason: string };

/** Fallback display name when Apple withholds a name on later authorisations. */
export const DEFAULT_APPLE_NAME = "Traveler";

export function resolveAccount(
  accounts: AccountLike[],
  appleUserId: string,
  email: string | null,
  emailVerified: boolean,
  fullName: string | null
): ResolveOutcome {
  if (!appleUserId) return { action: "reject", reason: "missing subject" };

  // 1. Exact Apple binding. Unambiguous, so it goes first.
  const bound = accounts.find((a) => a.appleUserId === appleUserId);
  if (bound) return { action: "sign-in", account: bound, via: "apple-sub" };

  // 2. Email link, verified only.
  if (email && emailVerified) {
    const normalized = email.trim().toLowerCase();
    const match = accounts.find((a) => a.email?.toLowerCase() === normalized);

    if (match) {
      /*
       * Only link to an account that the owner can already authenticate as.
       * A row with neither a password nor an Apple binding is an unclaimed
       * placeholder; claiming it by email alone would hand over its trips.
       */
      if (match.passwordHash || match.appleUserId) {
        return { action: "sign-in", account: match, via: "verified-email" };
      }
      // Placeholder: fall through to create a fresh account rather than reject,
      // so the person is not locked out by the existence of a stale row.
    }
  }

  // 3. New account.
  const name = (fullName ?? "").trim() || (email ? email.split("@")[0] : "") || DEFAULT_APPLE_NAME;
  return {
    action: "create",
    name,
    email: email ? email.trim().toLowerCase() : null,
    appleUserId,
  };
}

/**
 * Apple sends the name ONLY on the very first authorisation for a given
 * app+user pair. Every subsequent sign-in omits it. So a create that happens
 * to have a name is the one chance to record it — and a later attempt must not
 * blank an existing name with a fallback.
 *
 * Returns the name to persist, given what we already have.
 */
export function nameForExistingAccount(existing: string | null, incoming: string | null): string | null {
  const trimmed = (incoming ?? "").trim();
  if (trimmed) return trimmed;
  return existing;
}
