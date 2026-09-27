"use client";

import { useEffect, useRef, useState } from "react";
import type { NativeFrame } from "@/lib/nativeScreens";

/*
 * Measures the tab panel a native screen should draw into.
 *
 * WHY A SELECTOR RATHER THAN A REF
 *
 * The panel is rendered by the shared `Tabs` component, which is used by the
 * trip page and has no idea native screens exist -- threading a ref through its
 * API would make every tab consumer aware of a concern only one of them has.
 *
 * `role="tabpanel"` is not a styling hook that can drift: it is load-bearing for
 * the WAI-ARIA tabs pattern the component implements, and the component already
 * sets it on the panel element. So it is a stable anchor, and there is at most
 * one such panel on the trip page at a time (panels are unmounted when inactive
 * rather than hidden, so a second one never exists to be confused with).
 *
 * WHY RE-MEASURE RATHER THAN MEASURE ONCE
 *
 * The frame moves: the page scrolls, the browser chrome collapses, the keyboard
 * opens, the device rotates. A frame measured at mount and reused is wrong the
 * moment anything above it changes -- and it would be wrong silently, as an
 * overlap or a gap. The ResizeObserver and the scroll listener below keep it
 * current while the native screen is up. Rotating the device is the case that
 * makes this necessary rather than nice-to-have.
 *
 * Returns null until a usable measurement exists, so callers can decline to
 * present rather than presenting into a collapsed region.
 */
export function useNativePresentationFrame(active: boolean): NativeFrame | null {
  const [frame, setFrame] = useState<NativeFrame | null>(null);

  /*
   * Held in a ref so the measurement function is stable: it is called from three
   * different listeners below, and re-creating it on every render would mean
   * tearing down and re-adding all three each time.
   */
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!active) {
      setFrame(null);
      return;
    }

    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
      // Imported lazily so this module stays free of the Capacitor import
      // chain: the frame hook is used in render paths that also run on web.
      void import("@/lib/nativeScreens").then(({ measurePresentationFrame }) => {
        if (cancelled) return;
        setFrame(measurePresentationFrame(panel));
      });
    };

    measureRef.current = measure;

    /*
     * The panel may not be laid out on the first frame -- it is rendered as part
     * of a tab switch, and fonts and images above it can still be settling. An
     * immediate measurement would frequently catch a zero-height rect and be
     * discarded as unusable.
     *
     * Measuring on the next frame catches the settled layout in the common case,
     * and the observers below catch anything that moves afterwards.
     */
    const raf = requestAnimationFrame(measure);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });

    /*
     * The observers only exist if the browser has them, which is every browser
     * this app ships to -- but a missing ResizeObserver must degrade to "measure
     * on resize only" rather than throw and take the tab down with it.
     */
    let ro: ResizeObserver | null = null;
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
    if (panel && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(panel);
      if (panel.parentElement) ro.observe(panel.parentElement);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [active]);

  /*
   * Focus changes matter because the keyboard does: a focused input inside the
   * panel shrinks the visual viewport, and the frame has to follow or the native
   * screen sits under the keyboard. Deferred by a frame so the browser has
   * applied the new viewport metrics before measuring.
   */
  useEffect(() => {
    if (!active) return;
    const onFocusChange = () => requestAnimationFrame(() => measureRef.current());
    window.addEventListener("focusin", onFocusChange);
    window.addEventListener("focusout", onFocusChange);
    return () => {
      window.removeEventListener("focusin", onFocusChange);
      window.removeEventListener("focusout", onFocusChange);
    };
  }, [active]);

  return frame;
}
