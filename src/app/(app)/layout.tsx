/*
 * Layout for the authenticated area.
 *
 * Everything in this route group is wrapped in the app shell — sidebar, mobile
 * nav, offline banner. The group exists so that chrome is NOT applied to the
 * public routes: before this, the shell lived in the root layout and wrapped
 * every page, which meant a logged-out visitor to "/" received a fully rendered
 * "New Trip" button in the sidebar. Clicking it opened the creation dialog and
 * the write then failed at the API with a 401 — the UI inviting an action the
 * server refuses.
 *
 * A route group is the right tool because it changes the layout boundary without
 * changing any URL. /trips/new is still /trips/new.
 *
 * The dashboard at "/" is NOT covered by this file, because "/" is outside the
 * group by necessity — it doubles as the public landing page. That route wraps
 * itself in the same AppShell, so both render identical chrome.
 *
 * What this does NOT do is admit or reject anyone. It renders chrome; the
 * middleware redirects on a missing session and the API routes return 401. That
 * separation is deliberate — a layout cannot enforce anything, since it wraps
 * whatever the router has already decided to render.
 */

import { AppShell } from "@/components/AppShell";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
