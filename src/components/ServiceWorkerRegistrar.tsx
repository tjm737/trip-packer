"use client";

import { useEffect } from "react";

/*
 * Registers the service worker.
 *
 * Production only. In dev, Next.js serves its own HMR plumbing and a caching
 * worker gets in the way — it would serve a stale shell over live edits and
 * make every change look like it did nothing. The worker is still installed in
 * `next start` / deployed builds, which is where offline actually matters.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // Registration can fail on unsupported/insecure origins. Offline is
          // an enhancement; the app must still work without it.
        });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
