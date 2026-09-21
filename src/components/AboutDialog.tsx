"use client";

import { RELEASES, CURRENT_VERSION } from "@/lib/changelog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Info } from "lucide-react";

/**
 * Version, build info and release notes.
 *
 * Opens from the sidebar footer next to "New Trip" rather than as a trip tab:
 * this is app-level information, and the trip tabs describe one trip. Dialog
 * rather than a route so it can be reached from anywhere without the sidebar's
 * current selection being disturbed — there is no page to navigate back to.
 *
 * The build info block is deliberately small and monospaced: it exists so a
 * bug can be tied to a specific build, not to be read for its own sake.
 */

/** Format an ISO date as "20 Sep 2026" without pulling in a date library. */
function formatReleaseDate(iso: string): string {
  // Build from parts and read back in UTC. Passing the raw ISO string to
  // `new Date` and formatting it locally can land on the previous day for a
  // negative UTC offset, which is exactly the bug the app already hit once.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function BuildRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-zinc-400">{label}</span>
      <span className="truncate font-mono text-[11px] text-zinc-300">{value}</span>
    </div>
  );
}

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] gap-0 overflow-y-auto border-zinc-700 bg-[var(--surface-2)] p-0 sm:max-w-[560px] scrollbar-thin"
        title="About TripPlanner"
      >
        <DialogHeader className="border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600">
              <span className="text-base leading-none">✈️</span>
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold tracking-tight text-zinc-100">
                TripPlanner
              </DialogTitle>
              <DialogDescription className="text-xs text-zinc-400">
                Version {CURRENT_VERSION} ·{" "}
                {formatReleaseDate(RELEASES[0].date)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          {/* Build info */}
          <section aria-labelledby="about-build">
            <h3
              id="about-build"
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
            >
              Build
            </h3>
            <div className="rounded-lg border border-zinc-800/60 surface-inset px-3 py-1.5">
              <BuildRow label="Version" value={CURRENT_VERSION} />
              <BuildRow
                label="Released"
                value={formatReleaseDate(RELEASES[0].date)}
              />
              <BuildRow label="Next.js" value="16.3.5" />
              <BuildRow label="React" value="19.2.8" />
            </div>
          </section>

          {/* Release notes */}
          <section aria-labelledby="about-notes" className="mt-5">
            <h3
              id="about-notes"
              className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
            >
              Release notes
            </h3>

            <ol className="space-y-5">
              {RELEASES.map((release, i) => {
                const isCurrent = i === 0;
                return (
                  <li key={release.version}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-sm font-semibold text-zinc-100">
                        {release.version}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full border border-emerald-500/60 bg-emerald-500/25 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                          Current
                        </span>
                      )}
                      {release.tag && (
                        <span className="rounded-full border border-zinc-700 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                          {release.tag}
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-400 tnum">
                        {formatReleaseDate(release.date)}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-zinc-400">
                      {release.headline}
                    </p>

                    <div className="mt-2.5 space-y-3 border-l border-white/8 pl-3.5">
                      {release.groups.map((group) => (
                        <div key={group.area}>
                          <h4 className="text-[11px] font-semibold text-zinc-300">
                            {group.area}
                          </h4>
                          <ul className="mt-1 space-y-1">
                            {group.items.map((item, k) => (
                              <li
                                key={k}
                                className="flex gap-2 text-[11px] leading-relaxed text-zinc-400"
                              >
                                <span
                                  aria-hidden="true"
                                  className="mt-[0.4rem] h-1 w-1 flex-shrink-0 rounded-full bg-zinc-700"
                                />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Storage note */}
          <section aria-labelledby="about-storage" className="mt-5">
            <h3
              id="about-storage"
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
            >
              Where your data lives
            </h3>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Trips, bookings and packing lists are stored in a local database on
              the machine running the app — not in the browser and not on a
              third-party service. Destinations are resolved to coordinates
              using a local airport dataset and a geocoding lookup, and those
              lookups are cached locally so repeat views work offline.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The sidebar entry that opens AboutDialog.
 *
 * `data-keep-drawer-open` opts this control out of MobileSidebar's
 * close-on-any-button handler. Without it, tapping About on a phone opened the
 * dialog and closed the drawer in the same tick, and since the dialog is
 * rendered inside SidebarBody the close unmounted it — the panel appeared and
 * vanished instantly.
 */
export function AboutButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-keep-drawer-open
      title="Version and release notes"
      aria-label="About TripPlanner"
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-ring"
    >
      <Info className="h-4 w-4" />
    </button>
  );
}
