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
import {
  isAppleSignInAvailable,
  signInWithApple,
} from "@/lib/appleSignIn";
import { AlertCircle, Apple, Loader2, Lock } from "lucide-react";

/**
 * Sign-in dialog.
 *
 * There is no self-service sign-up here by design: accounts are created by an
 * existing owner, either from their sidebar or with `npm run create-account` on
 * the server. Closed registration is a deliberate property of an app for a
 * known handful of people, so the UI should not imply a door that is not there.
 *
 * The dialog never reports WHY a sign-in failed. The server returns a single
 * `Invalid email or password` for both an unknown email and a wrong password so
 * that the response cannot be used to enumerate accounts, and the UI must not
 * undo that by guessing at the difference.
 */

/** Shape of the login endpoint's error body, narrowed at the boundary. */
type ApiError = { error?: string };

export function LoginDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (user: { id: string; name: string; isOwner: boolean }) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Whether the native Sign in with Apple sheet can be presented. Resolved once
   * when the dialog opens, not on mount, because the answer depends on the
   * Capacitor bridge being ready and the dialog is the first thing that needs
   * it.
   *
   * Starts `false` so the button does not flash on the web, where it can never
   * work. The cost is that on iOS the button appears a beat after the dialog;
   * the alternative is offering a control that fails for most visitors.
   */
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Focus the email field when the dialog opens, so the form is usable from the
  // keyboard immediately. A dialog that opens with focus on the close button
  // makes the first Tab land somewhere useless.
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setError(null);
      // A short delay lets the dialog finish mounting before focusing, otherwise
      // the focus is stolen by the portal's own initial-focus handling.
      const t = setTimeout(() => emailRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void isAppleSignInAvailable().then((report) => {
      // Guard the late resolve: the dialog may have closed while the bridge was
      // answering, and setting state after that is a no-op at best.
      if (!cancelled) setAppleAvailable(report.available);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Run Sign in with Apple.
   *
   * Cancelling resolves rather than rejects, so it is handled by simply doing
   * nothing: the user dismissed the sheet and the form is still there. Showing
   * an error for a deliberate cancellation would be wrong.
   */
  async function submitApple() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithApple();
      if (outcome.ok) {
        // `isOwner` is not in the Apple response. The server owns that decision
        // and the shell re-reads it from /api/state on load, so an Apple
        // sign-in reports `false` here rather than guessing — a guess that
        // defaulted to true would be a privilege escalation in the UI.
        onSuccess({ id: outcome.user.id, name: outcome.user.name, isOwner: false });
        onOpenChange(false);
        return;
      }
      if ("cancelled" in outcome && outcome.cancelled) return;
      setError("error" in outcome ? outcome.error : "Sign in with Apple failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Guard the empty case client-side so a blank submit does not burn one of
    // the five failed attempts the server allows before locking out.
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.ok) {
        const body = (await res.json()) as {
          user: { id: string; name: string; isOwner: boolean };
        };
        setPassword("");
        onSuccess(body.user);
        onOpenChange(false);
        return;
      }

      let message = "Sign-in failed. Try again.";
      if (res.status === 429) {
        message = "Too many attempts. Wait a few minutes and try again.";
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
        className="gap-0 border-zinc-700 bg-[var(--surface-2)] p-0 sm:max-w-[420px]"
        title="Sign in"
      >
        <DialogHeader className="border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
              <Lock className="h-4 w-4 text-emerald-950" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold tracking-tight text-zinc-100">
                Sign in
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Your trips are private to your account.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Native Sign in with Apple, when the platform can present it. */}
        {appleAvailable ? (
          <div className="border-b border-white/8 px-5 py-4">
            <button
              type="button"
              onClick={submitApple}
              disabled={busy}
              title="Sign in with Apple"
              aria-label="Sign in with Apple"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60 focus-ring"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Apple className="h-4 w-4" />
              )}
              Sign in with Apple
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="px-5 py-4">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="login-email"
                className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
              >
                Email
              </Label>
              {/*
                ref works here because React 19 threads `ref` as an ordinary
                prop: Input's props type is React.ComponentProps<"input">, which
                includes it, and it is spread onto the Base UI primitive. This
                is NOT the React 18 forwardRef pattern, and if this code is ever
                moved to a pre-19 version the autofocus below will silently stop
                working rather than erroring.
              */}
              <Input
                id="login-email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                className="h-9 bg-[var(--surface-1)] text-sm"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="login-password"
                className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
              >
                Password
              </Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
                className="h-9 bg-[var(--surface-1)] text-sm"
              />
            </div>
          </div>

          {/*
            role="alert" so a screen reader announces a failed sign-in. The
            container reserves no height, so the form does not jump when the
            message appears — the dialog simply grows.
          */}
          {error ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="text-[11px] leading-snug text-red-300">{error}</span>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[10px] leading-snug text-zinc-500">
              Accounts are created by the trip owner from their sidebar.
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              title="Sign in to your account"
              className="h-8 flex-shrink-0 bg-emerald-600 px-3 text-xs font-semibold text-emerald-50 hover:bg-emerald-500"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Signing in
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sidebar entry that opens the sign-in dialog.
 *
 * `data-keep-drawer-open` is required for the same reason AboutButton needs it:
 * MobileSidebar closes on any button click, and since the dialog is rendered
 * inside the drawer body, that close would unmount the dialog in the same tick
 * — it would flash and disappear on a phone.
 */
export function SignInButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-keep-drawer-open
      title="Sign in to your account"
      aria-label="Sign in"
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-ring"
    >
      <Lock className="h-4 w-4" />
    </button>
  );
}
