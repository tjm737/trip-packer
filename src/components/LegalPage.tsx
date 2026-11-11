/*
 * Shared frame for the plain-text public documents (/terms, /accessibility).
 *
 * Same header, column, and type scale as /privacy and /support, so the four
 * documents read as one set. Public by construction: the matcher in
 * src/proxy.ts covers only /trips/:path*, so routes using this need no
 * allowlist entry.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Plane, ArrowLeft } from "lucide-react";
import { LegalFooter } from "@/components/LegalFooter";

export interface LegalSection {
  heading: string;
  body: ReactNode[];
}

export const CONTACT_EMAIL = "tylerjamesmorgan@gmail.com";

export function ContactLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
    >
      {CONTACT_EMAIL}
    </a>
  );
}

export function LegalPage({
  title,
  intro,
  sections,
  effective,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  /** Human-readable date, e.g. "11 November 2026". */
  effective: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface-0)]">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="focus-ring flex items-center gap-2.5 rounded-lg"
          title="Back to the TripPlanner home page"
        >
          <Plane className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-100">
            TripPlanner
          </span>
        </Link>
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-[var(--surface-2)] hover:text-zinc-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{intro}</p>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[15px] font-semibold tracking-tight text-zinc-100">
                {section.heading}
              </h2>
              <div className="mt-2.5 space-y-3">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed text-zinc-400">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 text-xs text-zinc-400">
          Effective {effective}. Last updated {effective}.
        </p>
      </main>

      <LegalFooter />
    </div>
  );
}
