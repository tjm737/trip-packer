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
import { AlertCircle, Check, Copy, Loader2, Link2, Plus, Share2, Trash2 } from "lucide-react";

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

/** A link row as returned by tx.listShareTokens — `token` + ISO `createdAt`. */
type ShareToken = { token: string; createdAt: string };

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
}: {
  tripId: string;
  canShare: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  /** Token currently being revoked, so only its row shows a spinner. */
  const [revoking, setRevoking] = useState<string | null>(null);
  /** Token just copied, driving the Copy -> Check swap. */
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
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
                          <div className="mt-2 flex items-center justify-between gap-2">
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
