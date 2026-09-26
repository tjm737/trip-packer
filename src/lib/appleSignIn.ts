import { registerPlugin } from "@capacitor/core";

import { apiUrl } from "./apiUrl";

/*
 * TypeScript surface for the AppleSignIn Capacitor plugin.
 *
 * The rest of the app talks to this module, never to Capacitor directly, so
 * there is one typed entry point and one place to change if the bridge moves.
 *
 * The division of labour is the important part:
 *
 *   - the plugin runs the native sheet and returns an identity token;
 *   - THIS module posts that token to /api/auth/apple and reads the response;
 *   - the SERVER verifies the token and decides which account it belongs to.
 *
 * The token is treated as an opaque string throughout. Nothing here inspects or
 * decodes it, and nothing here is trusted for an auth decision -- a client can
 * lie about everything it sends, so the only judgement that counts happens on
 * the server. See src/lib/appleAuth.ts for the verification.
 *
 * Failure modes resolve rather than throw wherever the outcome is a normal user
 * experience (cancelling the sheet, the plugin being absent on the web), and
 * reject only when something genuinely went wrong. Callers therefore need no
 * try/catch for a cancellation.
 */

/** When sign-in cannot be offered at all. */
export interface AppleAvailability {
  available: boolean;
  message: string;
}

/** The name Apple hands over on first authorisation. */
export interface AppleFullName {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  namePrefix?: string;
  nameSuffix?: string;
  nickname?: string;
}

/** A credential returned by a successful native flow. */
export interface AppleCredential {
  identityToken: string;
  /** Apple's stable subject id. Not used for auth here; the server re-derives it. */
  user: string;
  authorizationCode?: string;
  /** Present only on the FIRST authorisation. */
  fullName?: AppleFullName;
  /** Present only on the FIRST authorisation, and only if the user shared it. */
  email?: string;
}

/** The plugin resolves this shape when the user dismisses the sheet. */
export interface AppleCancelled {
  cancelled: true;
}

export type AppleSignInResult = AppleCredential | AppleCancelled;

export function isCancelled(result: AppleSignInResult): result is AppleCancelled {
  return (result as AppleCancelled).cancelled === true;
}

interface AppleSignInPlugin {
  isAvailable(): Promise<AppleAvailability>;
  signIn(): Promise<AppleSignInResult>;
}

/*
 * The web implementation is not a no-op.
 *
 * Capacitor resolves a plugin's implementation lazily, per call, from the second
 * argument to `registerPlugin`. Registering with no second argument leaves it
 * empty, so every method throws CapacitorException("... is not implemented on
 * web") before our own logic runs. Declaring the implementation makes "this
 * platform cannot present the native sheet" an explicit, inspectable fact.
 *
 * `available: false` is the honest answer: the app is also a web app, and in a
 * browser there is no ASAuthorizationController to present. The UI uses this to
 * hide the button rather than offering a control that cannot work.
 */
const Plugin = registerPlugin<AppleSignInPlugin>("AppleSignIn", {
  web: () =>
    Promise.resolve({
      isAvailable: async (): Promise<AppleAvailability> => ({
        available: false,
        message: "Sign in with Apple is available in the iOS app.",
      }),
      signIn: async (): Promise<AppleSignInResult> => {
        throw new Error("Sign in with Apple is unavailable on the web");
      },
    }),
});

/** Whether the native sheet can be offered on this platform. */
export async function isAppleSignInAvailable(): Promise<AppleAvailability> {
  try {
    if (!Plugin?.isAvailable) {
      return { available: false, message: "Sign in with Apple is unavailable." };
    }
    return await Plugin.isAvailable();
  } catch {
    // A bridge failure is indistinguishable from "not available" as far as the
    // UI is concerned, and hiding the button is the safe response either way.
    return { available: false, message: "Sign in with Apple is unavailable." };
  }
}

/* --------------------------------------------------- the server exchange */

export type AppleAuthOutcome =
  | { ok: true; user: { id: string; name: string } }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

type AuthResponseBody = { user?: { id?: string; name?: string }; error?: string };

/**
 * Exchange an Apple credential for a session.
 *
 * Split out from `signInWithApple` so the two halves can be reasoned about (and
 * tested) separately: this function is pure I/O against our own server and does
 * not touch the Capacitor bridge at all.
 *
 * The response body is read defensively. A non-JSON body from any hop -- a
 * proxy error page, an HTML 502 -- would otherwise surface as an unhandled
 * rejection, so the parse failure is turned into a generic message.
 */
export async function exchangeAppleCredential(
  credential: AppleCredential,
  fetchImpl: typeof fetch = fetch
): Promise<AppleAuthOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(apiUrl("/api/auth/apple"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Cookies must ride along: the server answers with the session cookie and
      // that cookie IS the sign-in.
      credentials: "include",
      body: JSON.stringify({
        identityToken: credential.identityToken,
        fullName: credential.fullName ?? null,
      }),
    });
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }

  /*
   * Annotated separately rather than as `let body: T | null`. `res.json()`
   * returns `any`, and assigning `any` into a `T | null` slot leaves the
   * declared type in place while the catch block's `null` narrows the whole
   * thing to `never` at the reads below. Keeping the parsed value as `unknown`
   * and checking its shape is both type-correct and honest about not trusting
   * the response.
   */
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const body = (parsed ?? {}) as AuthResponseBody;

  if (!res.ok) {
    return {
      ok: false,
      error: body.error ?? "Could not sign in with Apple. Please try again.",
    };
  }

  const userId = body.user?.id;
  if (!userId) {
    // A 2xx with no user means the contract was broken somewhere; failing is
    // better than proceeding with an undefined session.
    return { ok: false, error: "Sign in did not complete. Please try again." };
  }

  return { ok: true, user: { id: userId, name: body.user?.name ?? "Traveler" } };
}

/**
 * Run the full Sign in with Apple flow: present the sheet, then exchange.
 *
 * The platform check happens first so that on the web this fails with a clear
 * message rather than a bridge exception.
 */
export async function signInWithApple(
  fetchImpl: typeof fetch = fetch
): Promise<AppleAuthOutcome> {
  const availability = await isAppleSignInAvailable();
  if (!availability.available) {
    return { ok: false, error: availability.message };
  }

  let result: AppleSignInResult;
  try {
    result = await Plugin.signIn();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign in with Apple failed.";
    return { ok: false, error: message };
  }

  if (isCancelled(result)) {
    return { ok: false, cancelled: true };
  }

  return exchangeAppleCredential(result, fetchImpl);
}
