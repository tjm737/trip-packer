"use client";

/*
 * Talking to the service worker.
 *
 * The trap this module exists to close: on a first-ever visit the worker
 * registers but does not control the page yet, so `navigator.serviceWorker
 * .controller` is null and any postMessage sent now is silently dropped. The
 * worker is *active* before the page is *claimed*, so awaiting `ready` does not
 * help either -- it resolves too early and the message still goes nowhere.
 *
 * The failure mode is nasty because nothing errors: the warm-up simply never
 * happens, and the bug only shows up as a blank map or a lost page the first
 * time someone opens the app with no signal -- which is exactly the situation
 * offline support exists for, and the hardest one to reproduce.
 *
 * `controllerchange` is the only reliable signal that the page is controlled.
 *
 * Subtlety worth stating, because getting it wrong reintroduces the bug: the
 * caller usually re-renders several times while it waits (stops resolve one
 * geocode at a time). If the listener were attached and detached per render,
 * a teardown landing in the same tick as `controllerchange` would drop the
 * event entirely and the warm-up would be lost. So the listener is attached
 * once and kept, while the payload it sends is swapped through a ref.
 */

import { useEffect, useRef } from "react";

/**
 * Run `send` as soon as a postMessage is guaranteed to reach the worker, and
 * again whenever `send`'s identity changes while still uncontrolled.
 *
 * `deps` behaves like a normal effect dependency list: the callback is only
 * re-invoked when one of them changes. The listener itself survives re-renders.
 */
export function useWhenServiceWorkerReady(
  send: () => void,
  deps: unknown[]
): void {
  // Latest callback, so the long-lived listener never closes over stale data.
  const sendRef = useRef(send);
  sendRef.current = send;

  // Whether a send is still owed. Once we have sent with a live controller we
  // stop, so a later re-render does not re-post the same payload.
  const sentRef = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // A new payload arrived; it needs sending.
    sentRef.current = false;

    const attempt = () => {
      if (sentRef.current) return;
      if (!navigator.serviceWorker.controller) return;
      sentRef.current = true;
      sendRef.current();
    };

    // Already controlled: send straight away.
    attempt();

    const onChange = () => attempt();
    navigator.serviceWorker.addEventListener("controllerchange", onChange);

    /*
     * Safety net for a worker that is already active and never re-claims this
     * page -- `controllerchange` would never fire and the warm-up would be
     * lost. `attempt` is idempotent via sentRef, so racing this against the
     * controllerchange path is harmless.
     */
    navigator.serviceWorker.ready.then(attempt).catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
