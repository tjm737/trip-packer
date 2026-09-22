/*
 * Delete-my-account, on the profile screen.
 *
 * App Store guideline 5.1.1(v) requires that an account created in the app can
 * be deleted in the app. Before this, the only way out was `npm run
 * delete-account` on the server, which is not something a user can do.
 *
 * Three things make this safe rather than merely present:
 *
 * 1. CONFIRMATION BY TYPING. A single tap is too easy to reach for something
 *    irreversible, and this deletes every trip the account owns as well. The
 *    button stays disabled until the required word is typed, which forces the
 *    user to read the sentence containing the trip count.
 *
 * 2. THE LAST-ACCOUNT RULE, MIRRORED FROM THE SERVER. The API refuses to delete
 *    the final account ("Cannot delete the last user"), because an instance
 *    with no accounts has no UI path back in. The client applies the same rule
 *    so the user sees a reason instead of a failed request.
 *
 * 3. THE TRIP CONSEQUENCE IS NAMED. db.ts cascades trips on user delete, so the
 *    account going takes its itineraries with it. The count is shown because
 *    "delete account" does not obviously imply "delete trips".
 *
 * The deleted user's session is revoked server-side (the route calls
 * deleteSessionsForUser), so there is no need to sign out here — but the client
 * does redirect, because staying on a profile screen for an account that no
 * longer exists is a dead end.
 */

"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
 * The word the user must type. Deliberately not the account name or email: this
 * component only receives an id, and reading the name would mean trusting
 * client state for an irreversible confirmation. A fixed word is unforgeable
 * and needs no extra data.
 */
const CONFIRM_WORD = "DELETE";

export function DangerZone({
  userId,
  ownedTripCount,
}: {
  userId: string;
  ownedTripCount: number;
}) {
  const { state, user, clearError, error } = useApp();

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Mirrors the server's last-account guard. Also true when this is the only
  // account in the instance, which is the common single-user case.
  const isLastAccount = state.users.length <= 1;

  const confirmed = typed.trim().toUpperCase() === CONFIRM_WORD;
  const canDelete = confirmed && !busy && !isLastAccount;

  async function destroy() {
    if (!canDelete) return;
    setBusy(true);
    setFailed(null);
    clearError();
    try {
      await user.delete(userId);
      /*
       * Full document navigation, NOT router.replace().
       *
       * The server revoked this account's session as part of the delete, so a
       * client-side transition re-renders through the App Router while the
       * client still holds state for a user that no longer exists — the RSC
       * fetch races the cookie teardown and lands on Next's "This page couldn't
       * load" fallback. Confirmed by testing: router.replace() produced that
       * error page, a normal navigation to /login renders correctly.
       *
       * assign() also discards every in-memory trace of the deleted account
       * (its trips, its user record, its cached state), which is the behaviour
       * a sign-out-after-delete actually wants.
       */
      window.location.assign("/login");
      return;
    } catch (err) {
      /*
       * Surfaced inline AND left set. The context error is shown higher up the
       * page, but a user whose eyes are on the confirm field needs the message
       * next to it — and a silent failure here would read as "nothing
       * happened", which is the worst possible outcome for a destructive
       * action that did not take effect.
       */
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Could not delete the account.";
      setFailed(message);
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <section className="mt-5 rounded-xl border border-red-500/25 bg-red-500/[0.04] p-5">
      <h2 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-300/80">
        <AlertTriangle className="h-3 w-3" />
        Danger zone
      </h2>

      <p className="mt-2 text-xs text-zinc-400">
        Deleting your account signs you out and cannot be undone.
        {ownedTripCount > 0 && (
          <>
            {" "}
            <span className="text-red-300/90">
              It also permanently deletes {ownedTripCount}{" "}
              {ownedTripCount === 1 ? "trip" : "trips"} you own
            </span>
            , including their bookings and any share links you have created.
          </>
        )}
      </p>

      {isLastAccount ? (
        /*
         * No button at all when the rule forbids it. A disabled button invites
         * the user to keep trying; a sentence tells them why there is nothing
         * here, which for a single-account instance is simply the truth.
         */
        <p className="mt-3 text-[11px] text-zinc-500">
          This is the only account on this instance, so it cannot be deleted.
        </p>
      ) : !open ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          title="Delete your account"
          className="mt-3 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
        >
          Delete my account
        </Button>
      ) : (
        <div className="mt-3">
          <label
            htmlFor="confirm-delete"
            className="text-[11px] text-zinc-400"
          >
            Type <span className="font-semibold text-red-300">{CONFIRM_WORD}</span>{" "}
            to confirm.
          </label>
          <Input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void destroy();
              if (e.key === "Escape") {
                setOpen(false);
                setTyped("");
              }
            }}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            className="mt-1.5 bg-zinc-800 border-zinc-600 text-zinc-100"
          />

          <div className="mt-3 flex items-center gap-3">
            <Button
              type="button"
              onClick={() => void destroy()}
              disabled={!canDelete}
              title={
                confirmed
                  ? "Permanently delete your account"
                  : `Type ${CONFIRM_WORD} to enable`
              }
              className="bg-red-600 hover:bg-red-700 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Permanently delete"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setFailed(null);
              }}
              disabled={busy}
              title="Keep my account"
              className="rounded px-1 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300 focus-ring disabled:opacity-40"
            >
              Cancel
            </button>
          </div>

          {failed && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {failed}
            </p>
          )}

          {error && !failed && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
