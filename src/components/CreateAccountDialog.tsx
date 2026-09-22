"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/apiUrl";
import { AVATAR_COLORS } from "@/lib/storage";
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from "lucide-react";

/**
 * Create-account dialog — the web equivalent of `npm run create-account`.
 *
 * INVITE-ONLY, not open signup. This dialog is only reachable by an owner, and
 * the server independently refuses any non-owner that posts to /api/accounts
 * regardless of what the UI shows. The client-side gate is presentation; the
 * route's check is the permission. Both exist, and only the second is trusted.
 *
 * The password field is a STARTING password the owner hands over out-of-band.
 * There is no invite-email flow: this app has no mail transport, and pretending
 * otherwise in the copy would be worse than saying nothing. The success state
 * says so explicitly so the owner knows they have to pass the password on.
 */

/** Shape of the endpoint's error body, narrowed at the boundary. */
type ApiError = { error?: string };

/** Matches the server's rule, so the two cannot disagree about what is valid. */
const MIN_PASSWORD = 8;

export function CreateAccountDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create, so the caller can refresh state. */
  onCreated?: (user: { id: string; name: string; email: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[1]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);

  /*
   * Reset on every open. Without this, reopening the dialog shows the previous
   * person's details and, worse, a stale password already typed into the field.
   */
  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setPassword("");
      setAvatarColor(AVATAR_COLORS[1]);
      setError(null);
      setCreated(null);
      const t = setTimeout(() => nameRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (!name.trim() || !email.trim()) {
      setError("A name and an email address are both required.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`The password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/accounts"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          avatarColor,
        }),
      });

      if (res.ok) {
        const body = (await res.json()) as {
          user: { id: string; name: string; email: string };
        };
        // Never keep the password in state once it has served its purpose.
        setPassword("");
        setCreated({ name: body.user.name, email: body.user.email });
        onCreated?.(body.user);
        return;
      }

      let message = "Could not create the account. Try again.";
      if (res.status === 403) {
        message = "Only the account owner can create accounts.";
      } else {
        try {
          const body = (await res.json()) as ApiError;
          if (body.error) message = body.error;
        } catch {
          // Non-JSON body (proxy error page). Keep the generic message rather
          // than surfacing raw HTML to the user.
        }
      }
      setError(message);
      setPassword("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 border-zinc-700 bg-[var(--surface-2)] p-0 sm:max-w-[440px]"
        title="Create an account"
      >
        <DialogHeader className="border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
              <UserPlus className="h-4 w-4 text-emerald-950" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold tracking-tight text-zinc-100">
                Create an account
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Give someone their own login. Their trips stay private to them.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {created ? (
          /* Success state. Replaces the form rather than sitting above it, so
             there is no half-filled form inviting a duplicate submit. */
          <div className="px-5 py-4">
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
              <div className="min-w-0 text-[11px] leading-snug text-emerald-200">
                <p className="font-semibold">
                  {created.name} can now sign in.
                </p>
                <p className="mt-0.5 text-emerald-300/80">{created.email}</p>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-snug text-zinc-400">
              They sign in at this site with the password you set. There is no
              invitation email — pass it on yourself, and have them change it
              once they are in.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                title="Create another account"
                onClick={() => {
                  setCreated(null);
                  setEmail("");
                  setName("");
                  setAvatarColor(AVATAR_COLORS[1]);
                  setTimeout(() => nameRef.current?.focus(), 40);
                }}
                className="h-8 bg-transparent px-3 text-xs font-semibold text-zinc-300 hover:bg-white/5"
              >
                Create another
              </Button>
              <Button
                type="button"
                size="sm"
                title="Close and finish"
                onClick={() => onOpenChange(false)}
                className="h-8 bg-emerald-600 px-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-500"
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="new-account-name"
                  className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                >
                  Name
                </Label>
                <Input
                  id="new-account-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  disabled={busy}
                  className="h-9 bg-[var(--surface-1)] text-sm"
                  placeholder="Their name"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="new-account-email"
                  className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                >
                  Email
                </Label>
                <Input
                  id="new-account-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                  className="h-9 bg-[var(--surface-1)] text-sm"
                  placeholder="them@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="new-account-password"
                  className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                >
                  Starting password
                </Label>
                <Input
                  id="new-account-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                  className="h-9 bg-[var(--surface-1)] text-sm"
                  placeholder={`At least ${MIN_PASSWORD} characters`}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  Avatar colour
                </Label>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Avatar colour">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={avatarColor === color}
                      aria-label={color.replace("bg-", "").replace("-500", "")}
                      title={color.replace("bg-", "").replace("-500", "")}
                      onClick={() => setAvatarColor(color)}
                      disabled={busy}
                      className={`h-6 w-6 rounded-full ${color} transition-transform hover:scale-110 focus-ring ${
                        avatarColor === color
                          ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[var(--surface-2)]"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
                <span className="text-[11px] leading-snug text-red-300">
                  {error}
                </span>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-snug text-zinc-500">
                New accounts can plan trips but cannot manage other people&apos;s
                accounts.
              </p>
              <Button
                type="submit"
                size="sm"
                disabled={busy}
                title="Create this account"
                className="h-8 flex-shrink-0 bg-emerald-600 px-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-500"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    Creating
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
