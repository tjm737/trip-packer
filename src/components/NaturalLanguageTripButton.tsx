"use client";

/*
 * Type a sentence, get a prefilled trip.
 *
 * Placed on the dashboard beside "New Trip" rather than inside the create
 * dialog, because the whole point is to skip the form. It opens its own small
 * dialog, extracts, and then hands the result to the SAME create dialog the
 * user would otherwise have filled in by hand -- so validation, icon choice and
 * bag import all keep working, and nothing can be written without the user
 * seeing the fields first.
 *
 * Availability is checked on mount, like PackingSuggestions. On the web, on
 * iOS 17-25, or with Apple Intelligence off, the trigger renders disabled with
 * a tooltip rather than disappearing: a control that silently vanishes reads as
 * a bug, and the tooltip is where the reason lives.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import {
  checkAvailability,
  generateObject,
  type AvailabilityReport,
} from "@/lib/foundationModels";
import {
  buildExtractionPrompt,
  normaliseTripDraft,
  isUsefulDraft,
  TRIP_FIELDS,
  type TripDraft,
} from "@/lib/naturalLanguageTrip";

/** Local yyyy-mm-dd. Deliberately not toISOString(), which is UTC and rolls
 *  the day backwards for anyone west of Greenwich in the evening — the exact
 *  bug the create flow documents having already been bitten by. */
function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const EXAMPLES = [
  "Lisbon next Friday to Sunday, hotel on Avenida da Liberdade",
  "Ski trip to the Alps in February",
  "Beach week in Bali sometime in March",
];

export function NaturalLanguageTripButton({
  onExtracted,
  className,
  variant = "button",
}: {
  /** Receives a draft the user has confirmed. */
  onExtracted: (draft: TripDraft) => void;
  className?: string;
  /*
   * "button" is the compact header trigger; "card" is the full-width dashboard
   * card. Both share every piece of behaviour below -- the availability probe,
   * the dialog, the extraction -- so they are one component with two faces
   * rather than two components that would drift apart.
   */
  variant?: "button" | "card";
}) {
  const [availability, setAvailability] = useState<AvailabilityReport | null>(null);
  const [checking, setChecking] = useState(true);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let alive = true;
    checkAvailability()
      .then((report) => {
        if (alive) setAvailability(report);
      })
      .catch(() => {
        if (alive) {
          setAvailability({
            available: false,
            reason: "unknown",
            message: "On-device trip entry is unavailable.",
          });
        }
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const available = Boolean(availability?.available);

  /*
   * Reset on close so a second visit does not show the previous sentence's
   * error, and so the textarea is empty and focused when reopened.
   */
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setInput("");
      setError(null);
      setBusy(false);
    }
  }, []);

  const handleExtract = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    setBusy(true);
    setError(null);
    try {
      const prompt = buildExtractionPrompt(text, todayLocal());
      const raw = await generateObject<Record<string, unknown>>(
        prompt,
        [...TRIP_FIELDS]
      );
      const draft = normaliseTripDraft(raw, text);

      /*
       * An empty extraction is a normal outcome, not an exception: the model
       * may have found nothing, or may have failed entirely and returned null.
       * Both arrive here as a draft with no destination and no date, and the
       * honest response is to say so rather than open a blank form and imply
       * it worked.
       */
      if (!isUsefulDraft(draft)) {
        setError(
          raw
            ? "Couldn't find a destination or date in that. Try naming the place, and when."
            : "On-device suggestions didn't return anything. Try rephrasing."
        );
        return;
      }

      onExtracted(draft);
      handleOpenChange(false);
    } catch {
      setError("Something went wrong reading that. Try rephrasing.");
    } finally {
      setBusy(false);
    }
  }, [input, onExtracted, handleOpenChange]);

  /*
   * The tooltip wraps a span, not the button: a disabled element fires no
   * pointer events, so a tooltip attached directly to it never shows. Same
   * reason as PackingSuggestions.
   */
  const hint = checking
    ? "Checking on-device availability…"
    : available
      ? "Describe a trip in a sentence and we'll fill in the details"
      : (availability?.message ?? "On-device trip entry is unavailable.");

  return (
    <>
      {variant === "card" ? (
        /*
         * The card face. Deliberately reuses StatCard's visual grammar -- same
         * border/radius/`surface-stat` fill, the same w-8 h-8 icon tile, the same
         * label treatment and sub-line -- so it reads as one of the dashboard's
         * own cards rather than a stray button that grew.
         *
         * The whole card is the button, so the hit target is the full width
         * rather than a ~44px pill, which is the point of moving it down here.
         *
         * The explanation is always visible rather than tooltip-only: on a phone
         * a tooltip cannot be reached without a hover, and this control is often
         * legitimately unavailable (it is a native iOS 26 capability).
         */
        <div className={cn("flex flex-col gap-1.5", className)}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={checking || !available}
            title={hint}
            aria-label="Describe a trip"
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left",
              "transition-colors focus-ring",
              checking || !available
                ? "cursor-not-allowed border-dashed border-zinc-800 bg-transparent"
                : "border-zinc-700/60 surface-stat hover:border-emerald-600/60"
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                checking || !available
                  ? "bg-zinc-800/60 text-zinc-600"
                  : "bg-emerald-500/15 text-emerald-400"
              )}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div
                className={cn(
                  "text-sm font-semibold",
                  checking || !available ? "text-zinc-600" : "text-zinc-50"
                )}
              >
                Describe a trip
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[11px] leading-snug",
                  checking || !available ? "text-zinc-600" : "text-zinc-400"
                )}
              >
                {hint}
              </div>
            </div>
          </button>
        </div>
      ) : !available && !checking ? (
        <div className={cn("flex flex-col items-stretch gap-1.5", className)}>
          <Button
            variant="outline"
            disabled
            className="focus-ring border-dashed border-zinc-800 bg-transparent text-zinc-600"
          >
            <Wand2 className="mr-1.5 h-4 w-4" />
            Describe a trip
          </Button>
          <p className="max-w-[16rem] text-[11px] leading-snug text-zinc-500">
            {hint}
          </p>
        </div>
      ) : (
        <Tooltip label={hint}>
          <span className={className}>
            {/*
             * The disabled treatment is explicit rather than the Button's default
             * opacity, which at 0.5 still read as an ordinary secondary button in
             * review — a control that looks pressable but is not. Dimming the
             * border and text, and dropping the fill entirely, makes "not
             * available here" legible at a glance.
             */}
            <Button
              variant="outline"
              onClick={() => setOpen(true)}
              disabled={checking || !available}
              title={hint}
              className={
                checking || !available
                  ? "focus-ring border-dashed border-zinc-800 bg-transparent text-zinc-600"
                  : "focus-ring"
              }
            >
              <Wand2 className="mr-1.5 h-4 w-4" />
              Describe a trip
            </Button>
          </span>
        </Tooltip>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[520px] bg-zinc-900 border-zinc-700">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              Describe Your Trip
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              One sentence is enough. Nothing is saved until you confirm it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="nl-trip-input"
                className="text-[10px] uppercase tracking-[0.08em] text-zinc-500"
              >
                Your trip
              </label>
              <Textarea
                id="nl-trip-input"
                ref={areaRef}
                autoFocus
                rows={3}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter submits, Shift+Enter is a newline: a one-sentence box
                  // should not require reaching for the mouse.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy && input.trim()) void handleExtract();
                  }
                }}
                placeholder="e.g. Lisbon next Friday to Sunday, hotel on Avenida da Liberdade"
                className="mt-1.5 bg-zinc-800 border-zinc-600 text-white placeholder:text-zinc-500"
              />
            </div>

            {/* Only while the box is empty: examples are a starting point, not
                clutter once the user is already typing. */}
            {!input.trim() && (
              <div className="space-y-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setInput(example);
                      areaRef.current?.focus();
                    }}
                    title="Use this example"
                    className="focus-ring block w-full truncate rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-2 text-left text-xs text-zinc-400 transition-all hover:border-zinc-600 hover:bg-zinc-700/50 hover:text-zinc-300"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="text-xs text-amber-400" role="status">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
              title="Close without extracting"
              className="focus-ring"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleExtract()}
              disabled={busy || !input.trim()}
              title="Read this and fill in the trip details"
              className="focus-ring bg-primary font-medium text-white hover:bg-emerald-700"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Reading…
                </>
              ) : (
                <>
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  Fill in details
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
