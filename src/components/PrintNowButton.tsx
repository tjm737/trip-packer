"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import type { PrintSection } from "@/lib/itineraryLayout";
import { togglePrintSection } from "@/lib/itineraryLayout";

/*
 * Toolbar for the printable itinerary.
 *
 * The only client component on the page, because `window.print()` and the
 * section toggles both need a browser. Everything else about the document is
 * server-rendered.
 *
 * The whole toolbar is hidden under @media print (see `.print-toolbar` in
 * globals.css), so none of this reaches paper.
 */

const SECTION_LABEL: Record<PrintSection, string> = {
  itinerary: "Itinerary",
  actions: "Actions",
  packing: "Packing list",
};

export function PrintNowButton({
  auto,
  tripId,
  tripName,
  selected,
  allSections,
}: {
  /** True when the URL carried ?autoprint=1, from the in-app Print button. */
  auto: boolean;
  tripId: string;
  tripName: string;
  /**
   * Sections currently on the sheet. OMITTED for single-purpose sheets (the bag
   * claim) that have no selectable sections — the toggle group is then not
   * rendered at all, rather than offering checkboxes for lists that page does
   * not contain.
   */
  selected?: readonly PrintSection[];
  /** Every selectable section, in print order. Required iff `selected` is. */
  allSections?: readonly PrintSection[];
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  // A sheet with no sections to choose from shows Print and Back only.
  const canChooseSections = selected !== undefined && allSections !== undefined;

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

  /*
   * Selection lives in the URL, so toggling navigates rather than setting local
   * state. That is what makes the page re-render server-side without the
   * selected lists, and it means a chosen subset is shareable and survives a
   * refresh. `replace` (not `push`) so toggling a few sections does not stack
   * entries the Back button has to walk through.
   *
   * `autoprint` is deliberately dropped when toggling: arriving at this page
   * from the app's Print button and then adjusting the sections should not
   * re-open the print dialog mid-adjustment.
   */
  const toggle = (section: PrintSection) => {
    if (!canChooseSections) return;
    const next = togglePrintSection(selected, section);
    // togglePrintSection is a pure toggle and returns [] if the last section is
    // switched off. The checkbox for that case is disabled below, so this is
    // unreachable through the UI — but navigating to an empty sheet would be a
    // confusing dead end, so refuse it here as well rather than trust the
    // disabled attribute to have held.
    if (next.length === 0) return;
    const params = new URLSearchParams({ parts: next.join(",") });
    router.replace(`/trips/${encodeURIComponent(tripId)}/print?${params.toString()}`);
  };

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

      {/*
       * Section toggles. A checkbox group, because this is choosing what to
       * include in one document, not switching between views. Not rendered for
       * single-purpose sheets (the bag claim), which have no selectable parts.
       */}
      {canChooseSections && (
        <div className="print-toolbar-sections" role="group" aria-label="Sections to print">
          {allSections.map((section) => {
            const isOn = selected.includes(section);
            // Refuse to switch off the last remaining section rather than letting
            // the user navigate to an empty sheet.
            const isLast = isOn && selected.length === 1;
            return (
              <label
                key={section}
                className="print-toolbar-check"
                title={
                  isLast
                    ? "At least one section must be selected"
                    : `${isOn ? "Hide" : "Show"} the ${SECTION_LABEL[section].toLowerCase()}`
                }
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(section)}
                  disabled={!ready || isLast}
                />
                {SECTION_LABEL[section]}
              </label>
            );
          })}
        </div>
      )}

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
