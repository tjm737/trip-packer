"use client";

import { Menu } from "lucide-react";
import { openMobileSidebar } from "@/components/MobileSidebar";

/**
 * Mobile-only top bar carrying the hamburger that opens the sidebar drawer.
 *
 * Hidden from `md` up, where the sidebar is a permanent column and a toggle
 * would be redundant. Padding respects the Dynamic Island / notch via
 * `env(safe-area-inset-top)` — which requires `viewport-fit=cover` in the
 * root layout's viewport export.
 */
export function MobileNav() {
  return (
    <header className="md:hidden sticky top-0 z-30 bg-[var(--surface-1)]/95 backdrop-blur-xl border-b border-white/8">
      <div className="flex items-center gap-2 px-2 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1">
        <button
          onClick={openMobileSidebar}
          className="w-11 h-11 flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-white/5 active:bg-white/10 transition-colors"
          aria-label="Open navigation menu"
          title="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500">
            <span className="text-[13px] leading-none">✈️</span>
          </div>
          <span className="truncate text-sm font-bold tracking-tight text-white">
            TripPlanner
          </span>
        </div>
      </div>
    </header>
  );
}
