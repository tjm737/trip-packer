"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

/*
 * Toolbar for the printable itinerary.
 *
 * The only client component on the page, because `window.print()` needs a
 * browser. Everything else about the document is server-rendered.
 *
 * The whole toolbar is hidden under @media print (see `.print-toolbar` in
 * globals.css), so none of this reaches paper.
 */
export function PrintNowButton({
  auto,
  tripId,
  tripName,
}: {
  /** True when the URL carried ?autoprint=1, from the in-app Print button. */
  auto: boolean;
  tripId: string;
  tripName: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    /*
     * Auto-print once, and only once.
     *
     * Deliberately NOT immediately on mount: on iOS Safari (and inside the
     * Capacitor shell) the print dialog invoked before layout and fonts have
     * settled can produce a blank or single-page document. Waiting for the
     * window `load` event plus a paint gives the browser a complete layout to
     * print. The `auto` flag is read from the URL rather than from state so this
     * effect cannot re-fire and re-open the dialog after the user dismisses it.
     */
    if (!auto) return;

    let cancelled = false;
    const fire = () => {
      if (cancelled) return;
      // One frame after load, so the layout that was just completed is the one
      // the print engine sees.
      requestAnimationFrame(() => window.print());
    };

    if (document.readyState === "complete") {
      fire();
    } else {
      window.addEventListener("load", fire, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", fire);
    };
  }, [auto]);

  return (
    <div className="print-toolbar">
      <Link
        href={`/trips/${encodeURIComponent(tripId)}`}
        className="print-toolbar-btn"
        // The back link should return to the trip, not the print view.
        title="Back to the trip"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <span className="print-toolbar-title">{tripName}</span>

      <button
        type="button"
        onClick={() => window.print()}
        className="print-toolbar-btn print-toolbar-primary"
        title="Open the print dialog"
        // Disabled until hydrated: before that the onClick does not exist, and a
        // dead-looking button is better than one that silently does nothing.
        disabled={!ready}
      >
        <Printer className="h-4 w-4" />
        Print
      </button>
    </div>
  );
}
