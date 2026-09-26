"use client";

/*
 * Pull-to-refresh for the whole authenticated app.
 *
 * Mounted once in AppShell so every screen inside it gets the gesture, including
 * the dashboard at "/" which sits outside the (app) route group and wraps itself
 * in the same shell.
 *
 * WHY HAND-ROLLED rather than a library
 *
 * The app is a hosted shell around a production web build, so adding a native
 * gesture plugin would mean a new iOS build AND a web deploy to change a
 * behaviour that is entirely DOM. A touch handler is the smaller, single-repo
 * change, and it keeps working in Safari and in the installed PWA.
 *
 * WHY IT IS SUBTLE
 *
 * iOS already implements pull-to-refresh at the document level in Safari, and
 * `overscroll-behavior-y: contain` (set in globals.css) is what stops that
 * native control fighting this one. Without it the OS spinner runs underneath
 * our indicator and the page also bounces.
 *
 * The gesture is only ever tracked at scrollTop 0, never in a scrolled list, so
 * this cannot hijack normal scrolling. Every one of those conditions is a pure
 * function in src/lib/pullToRefresh.ts, which is where it is tested.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import {
  PULL_THRESHOLD,
  RESULT_DWELL_MS,
  canStartPull,
  phaseFor,
  pullLabel,
  pullProgress,
  resistPull,
  shouldBeginPull,
  type PullPhase,
} from "@/lib/pullToRefresh";

/** The indicator itself. Rendered inside the shell, above the content. */
function PullIndicator({
  phase,
  distance,
  result,
}: {
  phase: PullPhase;
  distance: number;
  result: "ok" | "failed" | null;
}) {
  const progress = pullProgress(distance);
  const busy = phase === "refreshing";

  /*
   * The indicator stays mounted at rest so its transform can animate back to
   * zero on release. Unmounting at distance 0 would snap it away instead.
   */
  return (
    <div
      aria-hidden={phase === "idle" && !result}
      className="pointer-events-none flex justify-center overflow-hidden"
      style={{
        height: busy || result ? 44 : distance,
        /*
         * Opacity rather than visibility: the element must keep occupying its
         * transition while hidden, or the collapse is not animatable.
         */
        opacity: distance > 0 || busy || result ? 1 : 0,
        transition: busy || result || distance === 0 ? "height 220ms ease, opacity 220ms ease" : "none",
      }}
    >
      <div className="flex items-center gap-2 pt-3 pb-1 text-xs font-medium text-zinc-400">
        {result === "ok" ? (
          <>
            <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <span className="text-emerald-400">Up to date</span>
          </>
        ) : result === "failed" ? (
          <>
            <AlertCircle className="h-4 w-4 text-amber-400" aria-hidden="true" />
            <span className="text-amber-400">Could not refresh — you may be offline</span>
          </>
        ) : (
          <>
            <RefreshCw
              className="h-4 w-4"
              aria-hidden="true"
              style={{
                transform: busy ? undefined : `rotate(${progress * 270}deg)`,
                /*
                 * Only spin while the request is actually in flight; before that
                 * the rotation is driven by the drag distance, so an animation
                 * here would fight the inline transform.
                 */
                animation: busy ? "ptr-spin 900ms linear infinite" : undefined,
              }}
            />
            <span>{pullLabel(phase)}</span>
          </>
        )}
      </div>
    </div>
  );
}

export function PullToRefresh() {
  const { refresh } = useApp();
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<"ok" | "failed" | null>(null);

  /*
   * Gesture state in refs, not state: touchmove fires continuously and each
   * update would otherwise re-render before the browser has a chance to paint,
   * which is what makes hand-rolled pull-to-refresh stutter. React state is
   * reserved for the values that the UI actually displays.
   */
  const startY = useRef(0);
  const startX = useRef(0);
  const tracking = useRef(false);
  const latched = useRef(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * Whether the touch started at the top of the page.
   *
   * Sampled once at touchstart and then re-checked in canStartPull on every
   * move, so a gesture that starts at the top and scrolls away is abandoned
   * rather than continuing to accumulate distance.
   */
  const eligible = useRef(false);

  /*
   * Mirror of `distance` for the handlers.
   *
   * The listeners deliberately do NOT depend on `distance`: it changes on every
   * touchmove, so a dependency would tear down and re-register four listeners
   * per frame, which is exactly the stutter real state is meant to avoid. The
   * handlers read the ref instead, and `distance` stays purely for rendering.
   */
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  const scrollTop = () =>
    window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

  const reset = useCallback(() => {
    tracking.current = false;
    latched.current = false;
    eligible.current = false;
    distanceRef.current = 0;
    setDistance(0);
  }, []);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      // A stale timer from a previous gesture must not clear this one's result.
      if (dwellTimer.current) {
        clearTimeout(dwellTimer.current);
        dwellTimer.current = null;
      }
      setResult(null);
      tracking.current = false;
      latched.current = false;

      eligible.current = canStartPull({
        scrollTop: scrollTop(),
        scrollLeft: window.scrollX,
        touches: e.touches.length,
        refreshing: refreshingRef.current,
      });
      if (!eligible.current) return;

      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current) return;

      /*
       * A finger was added or removed mid-gesture. Abandon the pull entirely
       * rather than measuring from a moving origin: continuing would compute a
       * distance against the wrong baseline and fire on a pinch.
       */
      if (e.touches.length > 1) {
        reset();
        eligible.current = false;
        return;
      }

      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;

      if (!shouldBeginPull({
        dy,
        dx,
        tracking: tracking.current,
        eligible: eligible.current,
      })) {
        return;
      }

      /*
       * Once tracking starts, re-verify the position on every move. Scrolling
       * away from the top mid-gesture ends the pull -- this is the check that
       * keeps the gesture from firing while the user is reading further down.
       */
      if (!canStartPull({
        scrollTop: scrollTop(),
        scrollLeft: window.scrollX,
        touches: e.touches.length,
        refreshing: refreshingRef.current,
      })) {
        reset();
        eligible.current = false;
        return;
      }

      tracking.current = true;
      latched.current = true;

      /*
       * Only a downward drag counts. Clamping at 0 means dragging up past the
       * origin leaves the indicator at rest instead of opening a gap.
       */
      const resisted = resistPull(Math.max(0, dy));

      /*
       * preventDefault stops the browser's own overscroll from running at the
       * same time. It is safe here precisely because this only executes once
       * the gesture has been classified as a pull; calling it on every move
       * would break normal scrolling.
       */
      if (resisted > 0 && e.cancelable) e.preventDefault();

      distanceRef.current = resisted;
      setDistance(resisted);
    };

    const settled = (ok: boolean) => {
      setRefreshing(false);
      refreshingRef.current = false;
      distanceRef.current = 0;
      setDistance(0);
      tracking.current = false;
      latched.current = false;
      eligible.current = false;

      /*
       * Holding the result on screen is the whole point: a refresh that ends
       * instantly is indistinguishable from one that never ran, and the user
       * cannot tell "nothing changed" from "it failed".
       */
      setResult(ok ? "ok" : "failed");
      dwellTimer.current = setTimeout(() => {
        setResult(null);
        dwellTimer.current = null;
      }, RESULT_DWELL_MS);
    };

    const onTouchEnd = () => {
      /*
       * `latched` rather than `tracking`: touchmove sets tracking, but a gesture
       * abandoned mid-way by the scroll check clears it. Latched records that a
       * pull actually happened, so an abandoned gesture cannot still refresh.
       */
      if (!latched.current) {
        reset();
        return;
      }

      const armed = distanceRef.current >= PULL_THRESHOLD;
      if (!armed) {
        // Not far enough. Collapse quietly; no request, no message.
        reset();
        return;
      }

      setRefreshing(true);
      refreshingRef.current = true;
      setDistance(PULL_THRESHOLD);
      distanceRef.current = PULL_THRESHOLD;
      latched.current = false;
      tracking.current = false;

      void refresh().then(settled);
    };

    const onTouchCancel = () => {
      // The system took the gesture (incoming call, Control Centre). Revert
      // without refreshing rather than leaving the indicator stuck open.
      reset();
      if (!refreshingRef.current) setResult(null);
    };

    /*
     * Non-passive on touchmove: preventDefault is required to suppress the
     * native overscroll, and a passive listener cannot call it. This is the one
     * place the app opts out of the default, and it is why the handler is so
     * careful to only preventDefault once the gesture is positively a pull.
     */
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      if (dwellTimer.current) clearTimeout(dwellTimer.current);
    };
    /*
     * `refreshing` is deliberately NOT a dependency. The handlers read
     * `refreshingRef` instead, so the listeners are registered once for the
     * life of the component rather than torn down and rebuilt on every state
     * change -- including on every touchmove, which is what a `distance`
     * dependency would have caused.
     */
  }, [refresh, reset]);

  return (
    <PullIndicator phase={phaseFor(distance, refreshing)} distance={distance} result={result} />
  );
}
