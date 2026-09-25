"use client";

/*
 * Client half of the sign-in page.
 *
 * The page itself is a server component so it can redirect an already-signed-in
 * visitor before any HTML is sent. Everything interactive lives here, because
 * LoginDialog is a controlled component.
 *
 * The dialog is rendered permanently open rather than behind a trigger button:
 * a visitor who typed /login has already asked for the form, so making them
 * click "Sign in" again would be a step for its own sake. Dismissing it sends
 * them back to the landing page, which is a sensible place to land rather than
 * stranding them on a blank route.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plane, ArrowLeft } from "lucide-react";
import { LoginDialog } from "@/components/LoginDialog";

/*
 * Only same-origin, path-only destinations are honoured.
 *
 * The `from` param is attacker-influencable: anyone can send a victim a link to
 * /login?from=https://evil.example. Redirecting to it after a successful sign-in
 * would be an open redirect — a phishing pattern that looks like it came from a
 * site the victim just logged into. Requiring the value to start with a single
 * "/" and rejecting "//" (protocol-relative, which browsers treat as another
 * origin) keeps redirects on this site.
 */
function safeDestination(from: string | null): string {
  if (!from) return "/";
  if (!from.startsWith("/")) return "/";
  if (from.startsWith("//")) return "/";
  return from;
}

export function SignInClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeDestination(searchParams.get("from"));
  // Drives the dialog's open state. Dismissing navigates away, so this only
  // ever goes true -> false on the way out.
  const [open, setOpen] = useState(true);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-0)]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="focus-ring flex items-center gap-2.5 rounded-lg"
          title="Back to the TripPlanner home page"
        >
          <Plane className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
            TripPlanner
          </span>
        </Link>
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-[var(--surface-2)] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back
        </Link>
      </header>

      {/*
        A quiet placeholder behind the dialog. The dialog is the only thing the
        visitor needs here, but an empty page behind it reads as broken, so the
        product name and a one-line explanation sit underneath.
      */}
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
            Sign in to TripPlanner
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Your trips are private to your account.
          </p>
          {/*
            Accounts are created by the owner, not through a public form, so a
            visitor with no account has no obvious next step -- and a dead end
            reads as a broken app rather than a deliberate one. Saying so here
            is also what stops an App Store reviewer concluding the app is
            unreviewable: they are told the situation and pointed at support
            instead of being left to guess.
          */}
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            TripPlanner is invite-only. If you do not have an account yet,{" "}
            <Link
              href="/support"
              className="focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
            >
              get in touch
            </Link>{" "}
            and we will set one up for you.
          </p>
        </div>
      </main>

      <LoginDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) router.push("/");
        }}
        onSuccess={() => {
          // A full navigation is deliberate, matching the dashboard. Signing in
          // changes which account every client-side cache belongs to, and a page
          // load is the only way to guarantee no data from the previous session
          // survives in a store. See SidebarContent.tsx.
          //
          // location.assign rather than router.push, because the caches that
          // need clearing live outside the router (service worker, in-memory
          // stores). `destination` was validated by safeDestination().
          window.location.assign(destination);
        }}
      />
    </div>
  );
}
