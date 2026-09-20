"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plane,
  BedDouble,
  Car,
  UtensilsCrossed,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useApp } from "@/lib/AppContext";
import type { ParsedItinerary } from "@/lib/itineraryImport";

type Preview = ParsedItinerary & { filename: string };

/**
 * Import a trip from a saved itinerary HTML file.
 *
 * Two steps on purpose: the file is parsed server-side first and shown back
 * for confirmation, and only then is the trip written. An import creates a
 * trip plus dozens of records, so it must never land silently on a misparse.
 */
export function ImportTripModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { trip } = useApp();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setPreview(null);
    setError("");
    setParsing(false);
    setImporting(false);
    setDragOver(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const readFile = async (file: File) => {
    setError("");
    setPreview(null);

    if (!/\.html?$/i.test(file.name)) {
      setError(`${file.name} is not an HTML file. Upload the exported itinerary page.`);
      return;
    }

    setParsing(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not read that file.");
        return;
      }
      setPreview(data as Preview);
    } catch (err) {
      setError(`Could not reach the server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setParsing(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setImporting(true);
    setError("");
    try {
      // Goes through the context action rather than calling the API
      // directly: the trip page renders "Trip not found" for any id missing
      // from context, so navigating before context knows about the new trip
      // showed an error even though the import had succeeded.
      const { tripId } = await trip.import(preview);
      handleClose(false);
      router.push(`/trips/${tripId}`);
    } catch (err) {
      // The trip may exist in part; showing the message lets the user decide
      // whether to clean it up rather than retrying and duplicating records.
      setError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  };

  const counts = preview
    ? {
        flight: preview.reservations.filter((r) => r.type === "flight").length,
        lodging: preview.reservations.filter((r) => r.type === "lodging").length,
        car: preview.reservations.filter((r) => r.type === "car").length,
        activity: preview.reservations.filter((r) => r.type === "activity").length,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[540px] bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-emerald-400" />
            Import an itinerary
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            {preview
              ? "Review what was found, then create the trip."
              : "Choose the saved itinerary page. Nothing is created until you confirm."}
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <div className="space-y-3">
            {/* The whole drop zone is the button, so a click anywhere opens the
                picker and keyboard users get a real focusable control. */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void readFile(f);
              }}
              disabled={parsing}
              className={`w-full rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors focus-ring ${
                dragOver
                  ? "border-emerald-500 bg-emerald-950/20"
                  : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/40"
              } ${parsing ? "opacity-60" : ""}`}
            >
              {parsing ? (
                <Loader2 className="w-7 h-7 mx-auto mb-3 text-emerald-400 animate-spin" />
              ) : (
                <FileText className="w-7 h-7 mx-auto mb-3 text-zinc-500" />
              )}
              <span className="block text-sm text-zinc-300">
                {parsing ? "Reading the itinerary…" : "Drop an HTML itinerary here"}
              </span>
              <span className="block text-xs text-zinc-500 mt-1">
                or click to choose a file
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </div>
        )}

        {preview && counts && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-4">
              <div className="text-white font-medium truncate">{preview.trip.name}</div>
              <div className="text-xs text-zinc-400 mt-0.5 truncate">
                {preview.trip.destination || "No destination found"}
                {preview.trip.startDate && (
                  <>
                    {" · "}
                    {preview.trip.startDate} → {preview.trip.endDate || preview.trip.startDate}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <CountRow icon={<Plane className="w-4 h-4" />} label="Flights" n={counts.flight} />
              <CountRow icon={<BedDouble className="w-4 h-4" />} label="Lodging" n={counts.lodging} />
              <CountRow icon={<Car className="w-4 h-4" />} label="Rental car" n={counts.car} />
              <CountRow
                icon={<UtensilsCrossed className="w-4 h-4" />}
                label="Dining & activities"
                n={counts.activity}
              />
            </div>

            {/* Day-by-day narrative and tasks have no count row of their own,
                so they are called out to show they are coming along. */}
            <div className="text-xs text-zinc-400 space-y-1">
              {preview.trip.notes && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  Day-by-day notes will be added to the trip
                </div>
              )}
              {preview.tasks.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  {preview.tasks.length} task{preview.tasks.length > 1 ? "s" : ""} will be added as to-dos
                </div>
              )}
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-800/60 bg-amber-950/20 p-3">
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-medium mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {preview.warnings.length} item{preview.warnings.length > 1 ? "s" : ""} need
                  {preview.warnings.length > 1 ? "" : "s"} a look
                </div>
                <ul className="text-[11px] text-amber-200/80 space-y-0.5 list-disc list-inside">
                  {preview.warnings.slice(0, 4).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {preview.warnings.length > 4 && (
                    <li>…and {preview.warnings.length - 4} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/30 p-3 text-xs text-red-300 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Tooltip label="Choose a different file" side="top">
                <Button
                  variant="ghost"
                  onClick={reset}
                  disabled={importing}
                  className="text-zinc-300 hover:text-white"
                >
                  Back
                </Button>
              </Tooltip>
              <Tooltip label="Create the trip and all its records" side="top">
                <Button
                  onClick={handleConfirm}
                  disabled={importing}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Create trip
                    </>
                  )}
                </Button>
              </Tooltip>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => handleClose(false)}
              className="text-zinc-300 hover:text-white"
            >
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CountRow({
  icon,
  label,
  n,
}: {
  icon: React.ReactNode;
  label: string;
  n: number;
}) {
  const empty = n === 0;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
        empty ? "border-zinc-800 bg-zinc-900/40" : "border-zinc-700 bg-zinc-800/40"
      }`}
    >
      <span className={empty ? "text-zinc-600" : "text-emerald-400"}>{icon}</span>
      <span className={`text-xs ${empty ? "text-zinc-600" : "text-zinc-300"}`}>{label}</span>
      <span className={`ml-auto text-sm font-medium ${empty ? "text-zinc-600" : "text-white"}`}>
        {n}
      </span>
    </div>
  );
}
