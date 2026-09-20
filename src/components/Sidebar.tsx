"use client";

import { SidebarBody } from "@/components/SidebarContent";
import { MobileSidebar } from "@/components/MobileSidebar";

/**
 * Responsive navigation shell.
 *
 * Desktop (>= md): a persistent 288px column pinned to the left.
 * Mobile  (<  md): hidden entirely — on a 430px iPhone Pro Max a fixed 288px
 *                  column would consume 67% of the viewport — and reachable
 *                  instead via the hamburger in MobileNav, which opens the
 *                  off-canvas drawer.
 *
 * Both variants render the same SidebarBody so they cannot drift apart.
 */
export function Sidebar({ onNewTrip }: { onNewTrip?: () => void }) {
  return (
    <>
      <aside className="hidden md:flex w-72 h-screen bg-[var(--surface-1)] border-r border-white/8 flex-col flex-shrink-0">
        <SidebarBody onNewTrip={onNewTrip} />
      </aside>

      <MobileSidebar onNewTrip={onNewTrip} />
    </>
  );
}
