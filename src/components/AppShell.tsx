"use client";

import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { OfflineBanner } from "@/components/OfflineBanner";

/**
 * The authenticated app shell: sidebar, mobile nav, offline banner.
 *
 * This exists as a named component because the shell is needed in two places
 * that a layout cannot cover at once. The authenticated routes get it from
 * (app)/layout.tsx, but the DASHBOARD is served from the root "/" route, which
 * sits outside that group — "/" has to stay a public URL because it is also the
 * landing page for visitors without a session, and a route group cannot contain
 * a path that is not under it.
 *
 * The bug that motivated extracting this: the shell used to live in the root
 * layout, wrapping everything including public routes, so a logged-out visitor
 * at "/" was served a working "New Trip" button that failed at the API with a
 * 401. Moving the shell into (app)/ fixed that but silently dropped the sidebar
 * from the signed-in dashboard at "/", which is outside the group. Rendering
 * the markup twice instead would have left the two copies free to drift; one
 * component keeps them identical by construction.
 *
 * Like (app)/layout.tsx, this renders chrome and admits nobody. The middleware
 * redirects on a missing session and the API routes return 401.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav />
        {/* Above the content, below the nav — never covers the itinerary. */}
        <OfflineBanner />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
