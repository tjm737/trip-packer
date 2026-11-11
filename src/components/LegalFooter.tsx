/*
 * Footer for the public pages (landing, sign-in, and the legal/support pages).
 *
 * One component so the set of links cannot drift between pages: App Store
 * review, a visitor with no account, and an assistive-technology user all need
 * to reach the same four documents from wherever they land. No "use client" --
 * it renders nothing interactive beyond links, so it works from server and
 * client components alike.
 *
 * Every link and the copyright line use text-zinc-400 or brighter, which clears
 * WCAG AA (4.5:1) on the page background in both themes.
 */

import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/support", label: "Support" },
] as const;

export function LegalFooter({
  maxWidth = "max-w-3xl",
}: {
  /** Match the page's content column so the footer lines up with it. */
  maxWidth?: "max-w-3xl" | "max-w-5xl";
}) {
  return (
    <footer
      className={`mx-auto flex w-full ${maxWidth} flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 pb-10 pt-6`}
    >
      <p className="text-xs text-zinc-400">
        TripPlanner &middot; &copy; {new Date().getFullYear()} TJM Studios LLC
      </p>
      <nav aria-label="Legal and support">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="focus-ring rounded text-xs text-zinc-400 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
