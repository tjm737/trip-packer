"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiUrl";
import { ApiError } from "@/lib/storage";
import { shareLink } from "@/lib/nativeShare";
import {
  SHAREABLE_SECTIONS,
  SHARE_SECTION_LABELS,
  normalizeVisibility,
  type ShareSection,
  type ShareVisibility,
} from "@/lib/shareVisibility";
import {
  AlertCircle,
  Check,
  Copy,
  EyeOff,
  Loader2,
  Link2,
  Plus,
  Share2,
  Trash2,
} from "lucide-react";

/*
 * Share-link manager for one trip.
 *
 * Talks to /api/share, which is NOT part of /api/mutate: that endpoint returns
 * the whole app state and must never be reachable with a share token, so share
 * links get their own route. The response shapes here are read straight from
 * the route — `{ tokens }` on a list/create/revoke, `{ token, tokens }` on a
 * create — and matched exactly rather than guessed.
 *
 * Why this does not go through AppContext: share tokens are not part of
 * AppState. The provider mirrors state so an optimistic mutation can be rolled
 * back; there is nothing here to mirror, because a link lives only in the
 * share_tokens table and is never rendered outside this dialog. A local fetch
 * is therefore the honest shape, and it must surface its own failures rather
 * than pretending a link was minted.
 *
 * Authorization is the server's call, not ours. `canShare` only decides whether
 * to *offer* the create button; if the user's role changed under us the server
 * answers 403 and we show that message instead of a broken button.
 */

/**
 * A link row as returned by tx.listShareTokens — `token`, ISO `createdAt`, and
 * the parsed `visibility` record. Always normalised server-side, so the toggles
 * below never have to cope with a null.
 */
type ShareToken = { token: string; createdAt: string; visibility: ShareVisibility };

/** The route's error body, narrowed at the boundary. */
type ApiErrorBody = { error?: string };

/**
 * Whether the copy affordance has just been used for a given token.
 *
 * Per-token rather than a single boolean so copying one link does not flash a
 * tick on every row at once.
 */
const COPY_FEEDBACK_MS = 2000;

/** Format an ISO timestamp as a short local date, or "" if it is unusable. */
function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Build the absolute public URL for a token.
 *
 * Absolute on purpose: the share page is reached by pasting the link into a
 * message, and a root-relative "/share/<token>" would be useless outside this
 * origin. `window.location.origin` is the same base apiUrl() trusts for the
 * Capacitor deep-link case. The guard keeps SSR (no window) from producing
 * "undefined/share/..." — the caller renders this only client-side, but the
 * helper must not fabricate a URL it cannot stand behind.
 */
function shareUrlFor(token: string): string {
  if (typeof window === "undefined" || !window.location?.origin) return "";
  return `${window.location.origin}/share/${token}`;
}

export function ShareDialog({
  tripId,
  canShare,
  open,
  onOpenChange,
  tripName,
}: {
  tripId: string;
  canShare: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Trip name, used as the share sheet's title and message body.
   *
   * Optional so the dialog still works if a caller omits it — the fallbacks
   * inside shareViaSheet cover that — but worth passing, because a shared link
   * arriving as "Trip itinerary" is far less useful in a text message than one
   * arriving as "Iceland 2026 — itinerary".
   */
  tripName?: string;
}) {
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Token currently being revoked, so only its row shows a spinner. */
  const [revoking, setRevoking] = useState<string | null>(null);
  /** Token just copied, driving the Copy -> Check swap. */
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  /*
   * Which token was just sent via the OS share sheet, for the transient
   * "Shared" confirmation. Kept separate from copiedToken because the two mean
   * different things to the user: "Copied" and "Shared" are not the same
   * outcome, and collapsing them would make the button's label lie about
   * whichever action was not taken.
   */
  const [sharedToken, setSharedToken] = useState<string | null>(null);
  /** "token:section" currently saving, so only that toggle shows a pending state. */
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read the current links.
   *
   * A signed-out session gets a 401 from the route. That is not a bug to
   * surface as a red error banner on a trip the user is already looking at —
   * it is the honest answer to "may I manage links", so it collapses to the
   * same read-only explanation as a viewer grant. Anything else (403, 500,
   * unreachable) is a real failure and is shown.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/share?tripId=${encodeURIComponent(tripId)}`));
      if (res.status === 401 || res.status === 403) {
        setTokens([]);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(body.error ?? `Could not load share links (${res.status})`, res.status);
      }
      const body = (await res.json()) as { tokens: ShareToken[] };
      setTokens(body.tokens ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server to load share links."
      );
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  // Fetch on open, and clear per-open transient state so a stale "Copied" tick
  // or a previous trip's error does not bleed into the next opening.
  useEffect(() => {
    if (!open) return;
    setCopiedToken(null);
    setError(null);
    if (canShare) void load();
  }, [open, canShare, load]);

  // Copy feedback is a timer, not a state the user set; clear it on unmount so
  // a closed dialog cannot set state after teardown.
  useEffect(() => {
    if (!copiedToken) return;
    const t = setTimeout(() => setCopiedToken(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [copiedToken]);

  // Same transient-feedback timer for the share sheet confirmation.
  useEffect(() => {
    if (!sharedToken) return;
    const t = setTimeout(() => setSharedToken(null), COPY_FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [sharedToken]);

  async function createLink() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/share"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId }),
      });
      if (res.status === 401) {
        // Session expired between opening the dialog and clicking. Say so
        // plainly rather than rendering a link we were never given.
        throw new ApiError("You need to sign in to share this trip.", 401);
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(body.error ?? `Could not create a share link (${res.status})`, res.status);
      }
      // The route returns the new token AND the refreshed list; use the list so
      // this dialog cannot drift from what the server actually holds.
      const body = (await res.json()) as { token: string; tokens: ShareToken[] };
      setTokens(body.tokens ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server to create a link."
      );
    } finally {
      setCreating(false);
    }
  }

  async function revokeLink(token: string) {
    if (revoking) return;
    setRevoking(token);
    setError(null);
    try {
      const res = await fetch(
        apiUrl(`/api/share?tripId=${encodeURIComponent(tripId)}&token=${encodeURIComponent(token)}`),
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(body.error ?? `Could not revoke the link (${res.status})`, res.status);
      }
      const body = (await res.json()) as { tokens: ShareToken[] };
      setTokens(body.tokens ?? []);
      // A revoked link must not still claim to be copied.
      if (copiedToken === token) setCopiedToken(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server to revoke the link."
      );
    } finally {
      setRevoking(null);
    }
  }

  /**
   * Change one section on one link.
   *
   * Optimistic: the checkbox flips immediately because waiting on a round trip
   * per tick feels broken. The previous record is kept so a failed save can put
   * the toggle back — a checkbox that stays ticked after the server rejected the
   * change is the one outcome worth extra code to avoid, since the owner would
   * otherwise believe a section is hidden when it is not.
   *
   * The request is not debounced. Toggling four sections quickly sends four
   * small PATCHes, each of which is idempotent and sets the whole visibility
   * record, so the last one to land wins with a complete, correct value. A
   * debounce would add a window where the dialog and the server disagree.
   */
  async function setSection(token: string, section: ShareSection, next: boolean) {
    const before = tokens.find((t) => t.token === token);
    if (!before) return;

    const updated = normalizeVisibility({ ...before.visibility, [section]: next });
    setTokens((prev) =>
      prev.map((t) => (t.token === token ? { ...t, visibility: updated } : t))
    );
    setSavingSection(`${token}:${section}`);
    setError(null);

    try {
      const res = await fetch(apiUrl("/api/share"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, token, visibility: updated }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        throw new ApiError(
          body.error ?? `Could not update what this link shows (${res.status})`,
          res.status
        );
      }
      const body = (await res.json()) as { tokens: ShareToken[] };
      setTokens(body.tokens ?? []);
    } catch (err) {
      // Roll back to what the server still holds, so the dialog never shows a
      // setting that was not saved.
      setTokens((prev) => prev.map((t) => (t.token === token ? before : t)));
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server to update the link."
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function copyLink(token: string) {
    const url = shareUrlFor(token);
    if (!url) {
      // No origin to build against — refuse rather than copy a broken URL.
      setError("Could not build the link on this device.");
      return;
    }
    /*
     * navigator.clipboard is only defined in a secure context. That covers
     * https:// and localhost, but NOT a plain-http LAN address — which is
     * exactly how this app gets opened on a phone during development
     * (http://192.168.x.x:4000). So the modern API is the preferred path, not
     * the only one: without the fallback, Copy is dead on the device that
     * matters most.
     *
     * The fallback writes through a temporary textarea. It is deprecated but it
     * works in an insecure context, and it reports success honestly, so we never
     * show "Copied" for a write that did not happen.
     */
    const legacyCopy = (): boolean => {
      try {
        const el = document.createElement("textarea");
        el.value = url;
        // Keep it out of the layout and off-screen without scrolling the page.
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.top = "0";
        el.style.left = "0";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        el.setSelectionRange(0, url.length); // iOS Safari ignores select() alone
        const ok = document.execCommand("copy");
        document.body.removeChild(el);
        return ok;
      } catch {
        return false;
      }
    };

    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Denied or unavailable — fall through to the legacy path rather than
        // giving up, since a permission rejection here does not mean the
        // deprecated path will also fail.
        copied = legacyCopy();
      }
    } else {
      copied = legacyCopy();
    }

    if (copied) {
      setCopiedToken(token);
      setError(null);
    } else {
      // Never pretend it worked.
      setError("Could not copy automatically — open the link to copy it from the address bar.");
    }
  }

  /*
   * Send the link through the OS share sheet.
   *
   * This is the action people actually want on a phone — the link usually needs
   * to go into a text message or an email, and "Copy" then paste is three steps
   * where the share sheet is one. It is also the feature App Review expects a
   * travel app to have natively rather than through a wrapped website.
   *
   * shareLink() already owns the three-layer fallback (native plugin -> Web
   * Share API -> clipboard) and the cancellation semantics, so this function
   * only has to map the result onto feedback. Note the deliberate asymmetry
   * with copyLink: a CANCELLED share shows nothing at all. The user closed the
   * sheet on purpose; telling them "Couldn't share" would be reporting their own
   * choice back to them as a failure.
   */
  async function shareViaSheet(token: string) {
    const url = shareUrlFor(token);
    if (!url) {
      setError("Could not build the link on this device.");
      return;
    }

    const result = await shareLink({
      title: tripName || "Trip itinerary",
      text: tripName ? `${tripName} — itinerary` : "Trip itinerary",
      url,
    });

    if (result.ok) {
      setSharedToken(token);
      setError(null);
      return;
    }

    if (result.canceled) {
      // Their choice, not a failure. Stay silent.
      return;
    }

    /*
     * Anything other than an explicit share-sheet failure defers to copyLink.
     *
     * shareLink()'s clipboard layer is a bare modern-API write, so a DENIED
     * permission (very common: no transient activation, or a headless/automated
     * browser, or an insecure origin) surfaces as ok:false with a raw
     * DOMException message like "Failed to execute 'writeText' on 'Clipboard'".
     * Showing that string to a traveller is meaningless.
     *
     * copyLink is the function that already knows how to degrade — it falls back
     * to the deprecated textarea write — so hand off to it rather than repeat
     * that logic. The user asked to share, could not, and still ends up with the
     * link on their clipboard, which is the useful outcome. Only if copyLink
     * also fails does it set its own honest "could not copy" error.
     */
    await copyLink(token);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] gap-0 overflow-y-auto border-zinc-700 bg-[var(--surface-2)] p-0 sm:max-w-[480px] scrollbar-thin"
        title="Share this trip"
      >
        <DialogHeader className="border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
              <Share2 className="h-4 w-4 text-emerald-950" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold tracking-tight text-zinc-100">
                Share this trip
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                {canShare
                  ? "Anyone with a link can view the itinerary read-only."
                  : "Share links for this trip are managed by its owner."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          {/* Read-only explanation for viewers / signed-out sessions. Shown
              instead of the create + list controls, never alongside them. */}
          {!canShare ? (
            <p className="text-[11px] leading-relaxed text-zinc-400">
              You have view access to this trip, so you cannot create or revoke
              its share links. A viewer is deliberately not able to re-share a
              trip — that would grant access to third parties without the
              owner knowing. The owner or an editor can manage links here.
            </p>
          ) : (
            <>
              {/* Create */}
              <section aria-labelledby="share-create">
                <h3
                  id="share-create"
                  className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                >
                  Create a link
                </h3>
                <Button
                  onClick={createLink}
                  disabled={creating}
                  title="Create a new read-only share link"
                  className="h-11 w-full bg-emerald-600 font-semibold text-emerald-50 hover:bg-emerald-500 focus-ring sm:h-9"
                >
                  {creating ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      Creating link
                    </>
                  ) : (
                    <>
                      <Plus className="mr-1.5 h-4 w-4" />
                      Create share link
                    </>
                  )}
                </Button>
                <p className="mt-1.5 text-[11px] text-zinc-400">
                  Each link is independent — revoke one without affecting the others.
                </p>
              </section>

              {/* Active links */}
              <section aria-labelledby="share-links" className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3
                    id="share-links"
                    className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                  >
                    Active links
                  </h3>
                  {tokens.length > 0 && (
                    <span className="text-[10px] text-zinc-600 tnum">{tokens.length}</span>
                  )}
                </div>

                {loading ? (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-800/60 surface-inset px-3 py-3">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Loading links…</span>
                  </div>
                ) : tokens.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800/60 surface-inset px-3 py-3">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      No links yet. Create one above and it will appear here — you
                      can copy or revoke it at any time.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {tokens.map((t) => {
                      const url = shareUrlFor(t.token);
                      const copied = copiedToken === t.token;
                      const isRevoking = revoking === t.token;
                      return (
                        <li
                          key={t.token}
                          className="rounded-lg border border-zinc-800/60 surface-inset px-3 py-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                              {url || `/share/${t.token}`}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="truncate text-[10px] text-zinc-500">
                              {formatCreated(t.createdAt)
                                ? `Created ${formatCreated(t.createdAt)}`
                                : "Active link"}
                            </span>
                            <div className="flex flex-shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => copyLink(t.token)}
                                title={copied ? "Link copied" : "Copy this link"}
                                aria-label={copied ? "Link copied" : "Copy this link"}
                                className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-emerald-500 bg-emerald-500/20 px-2.5 text-[11px] text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-200 focus-ring sm:h-8"
                              >
                                {copied ? (
                                  <>
                                    <Check className="h-4 w-4 sm:h-3.5 sm:w-3.5" strokeWidth={3} />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                    <span>Copy</span>
                                  </>
                                )}
                              </button>
                              {/*
                                * Share, between Copy and Revoke.
                                *
                                * Sits in the middle deliberately: Copy and
                                * Share are both "send this link" actions, so
                                * grouping them keeps Revoke — which is
                                * destructive — at the edge and away from the
                                * button a thumb reaches for by default.
                                *
                                * The label swaps to "Shared" only on a
                                * confirmed share, and a cancelled sheet leaves
                                * it unchanged, so the button never claims an
                                * action the user aborted.
                                */}
                              <button
                                type="button"
                                onClick={() => void shareViaSheet(t.token)}
                                title={
                                  sharedToken === t.token
                                    ? "Link shared"
                                    : "Share this link"
                                }
                                aria-label={
                                  sharedToken === t.token
                                    ? "Link shared"
                                    : "Share this link"
                                }
                                className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-zinc-600 bg-white/5 px-2.5 text-[11px] text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-white/10 focus-ring sm:h-8"
                              >
                                {sharedToken === t.token ? (
                                  <>
                                    <Check
                                      className="h-4 w-4 sm:h-3.5 sm:w-3.5"
                                      strokeWidth={3}
                                    />
                                    <span>Shared</span>
                                  </>
                                ) : (
                                  <>
                                    <Share2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                    <span>Share</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => revokeLink(t.token)}
                                disabled={isRevoking}
                                title="Revoke this link"
                                aria-label="Revoke this link"
                                className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-white/5 px-2.5 text-[11px] text-zinc-300 transition-colors hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300 focus-ring disabled:opacity-50 sm:h-8"
                              >
                                {isRevoking ? (
                                  <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" />
                                ) : (
                                  <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                                )}
                                <span>Revoke</span>
                              </button>
                            </div>
                          </div>

                          {/*
                            Per-link visibility. Each link can show a different
                            subset, which is the reason the setting lives on the
                            token row: a companion gets the packing list, a
                            housesitter gets only the dates.
                          */}
                          <div className="mt-2.5 border-t border-white/8 pt-2.5">
                            <h4 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                              <EyeOff className="h-3 w-3" />
                              This link shows
                            </h4>
                            <ul className="space-y-1">
                              {SHAREABLE_SECTIONS.map((section) => {
                                const on = t.visibility[section] !== false;
                                const isSaving = savingSection === `${t.token}:${section}`;
                                return (
                                  <li key={section}>
                                    <label
                                      title={
                                        on
                                          ? `Hide the ${SHARE_SECTION_LABELS[section].toLowerCase()} from this link`
                                          : `Show the ${SHARE_SECTION_LABELS[section].toLowerCase()} on this link`
                                      }
                                      className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded px-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/5"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={isSaving}
                                        onChange={(e) =>
                                          void setSection(t.token, section, e.target.checked)
                                        }
                                        className="h-3.5 w-3.5 flex-shrink-0 accent-emerald-500 focus-ring disabled:opacity-50"
                                      />
                                      <span className={on ? "" : "text-zinc-500"}>
                                        {SHARE_SECTION_LABELS[section]}
                                      </span>
                                      {isSaving && (
                                        <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                                      )}
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                            {/*
                              Stated because it is not guessable from the
                              checkboxes: the itinerary itself has no toggle, and
                              the confirmation-number toggle blanks a field
                              within each booking rather than removing bookings.
                            */}
                            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
                              The itinerary itself always shows. Booking
                              confirmation numbers can be added or hidden
                              separately.
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}

          {/* Errors are always visible — never swallowed. role="alert" so a
              screen reader announces a failed create/revoke/copy. */}
          {error ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="text-[11px] leading-snug text-red-300">{error}</span>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
