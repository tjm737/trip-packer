"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SidebarBody } from "@/components/SidebarContent";

// The hamburger lives in MobileNav (rendered by the root layout) while the
// drawer lives here. Both are client components, so a tiny module-level event
// avoids threading a context provider through the layout just to open a drawer.
const OPEN_EVENT = "trippacker:open-sidebar";

export function openMobileSidebar() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function MobileSidebar({ onNewTrip }: { onNewTrip?: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  // Close on navigation. TripCard uses window.location.href, so the sheet would
  // otherwise stay mounted over the destination page after a tap.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    return () => {
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
    };
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-label="Navigation"
        className="w-[85vw] max-w-[320px] p-0 gap-0 bg-[var(--surface-1)] border-r border-white/8"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-end px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button
              onClick={() => setOpen(false)}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Close menu"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Tapping a trip closes the drawer so the new page is visible. */}
          <div
            className="flex-1 min-h-0 flex flex-col pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) setOpen(false);
            }}
          >
            <SidebarBody onNewTrip={onNewTrip} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
