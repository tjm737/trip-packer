"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { installUnloadFlush, trackPageView } from "@/lib/track";

/*
 * Records a page view per navigation and installs the unload flush.
 *
 * A component rather than a call inside AppShell for two reasons: `usePathname`
 * makes this a hook consumer, and keeping the effect in its own file means the
 * tracking concern is visible in one place instead of hidden among the shell's
 * markup.
 *
 * Mounted once, in AppShell, so it covers every authenticated screen including
 * the dashboard at "/". Public routes (the landing page, /share/[token]) do not
 * get it — the landing page has no shell, so a logged-out visitor is not
 * counted at all. That is a deliberate limit of this first pass: the funnel's
 * top is missing, and adding it means mounting a tracker in the root layout,
 * which is a change to public routing rather than a line in the shell.
 *
 * Renders nothing. It has no visual presence by design — an invisible
 * instrumentation component that renders DOM would be a layout bug waiting to
 * happen.
 */
export function PageViewTracker() {
  const pathname = usePathname();

  /*
   * Unload handlers are installed once for the lifetime of the app, not per
   * navigation. The effect has no dependency array on purpose: `installUnloadFlush`
   * is idempotent, and re-running it is cheaper than reasoning about whether a
   * navigation could strand a listener.
   */
  useEffect(() => {
    installUnloadFlush();
  }, []);

  useEffect(() => {
    if (!pathname) return;
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
