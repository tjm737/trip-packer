/*
 * Public landing page.
 *
 * Rendered at "/" for visitors without a session, in place of the dashboard.
 * The policy this page exists to express: unauthenticated visitors get a
 * description of the product and a way to sign in — never the trip UI. Before
 * this existed the dashboard shell rendered for everyone, so a logged-out
 * visitor saw "Hello, Traveler" with working Import and New Trip buttons that
 * failed silently at the API with a 401.
 *
 * Deliberately server-rendered with no client state. It reads no trip data, so
 * it cannot leak any, and it has nothing to hydrate — which also means it
 * renders identically before and after JS loads, with no empty-state flash.
 *
 * The sign-in control is a plain link to /login rather than a dialog, because
 * LoginDialog is part of the authenticated shell and needs the client data
 * layer. Keeping the landing page free of that dependency is what lets it be
 * static.
 */

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  CloudOff,
  MapPin,
  Plane,
  Share2,
  ShieldCheck,
  Ticket,
} from "lucide-react";

/*
 * Product surface. Kept as data rather than hand-written markup so the three
 * cards stay structurally identical — the alternative drifts into three
 * slightly different paddings and icon sizes.
 */
const FEATURES = [
  {
    icon: CalendarDays,
    title: "Everything in one place",
    body: "Flights, stays, cars, trains and ferries kept against a single trip, with confirmation numbers where you can find them.",
  },
  {
    icon: MapPin,
    title: "See the shape of the trip",
    body: "Stops plotted on a map with driving routes and distances between them, so the ground you have to cover is visible before you book.",
  },
  {
    icon: Ticket,
    title: "Start from an itinerary",
    body: "Import an existing itinerary file and the trip is built for you — reservations, tasks and dates already in place.",
  },
  {
    icon: Plane,
    title: "Live flight status",
    body: "Flight tracking that follows the booking rather than the airline, so a delay shows up without you going looking for it.",
  },
  {
    icon: CloudOff,
    title: "Works without a signal",
    body: "Installs to your home screen and keeps working on a plane, a train, or a queue at passport control.",
  },
  {
    icon: Share2,
    title: "Share a read-only view",
    body: "Send someone a link that shows the itinerary without giving them the ability to change it.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-0)] text-zinc-100">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <Plane className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-tight">TripPlanner</span>
        </div>
        <Link
          href="/login"
          className="focus-ring rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-[var(--surface-2)] hover:text-white"
        >
          Sign in
        </Link>
      </header>

      {/*
        Full-bleed hero. The background photograph is portrait (3:4) but the
        hero is wide, so the crop is handled in CSS: object-cover on a wide
        band for desktop, and the full portrait framing on phones where the
        viewport is itself portrait.

        Legibility drove the scrim, and it is measured rather than guessed. The
        photograph's luminance, sampled in a 3x4 grid, runs bright at the top
        (cloud and snow, 100-200) and dark through the lower half (61 down to
        24). The headline and body sit over the upper third, so the scrim is
        weighted there and left almost clear below, where the photo is already
        dark enough to carry white text on its own. An earlier pass used a flat
        72% black and crushed the whole image to a black panel; the photo has to
        stay visible or it is just noise.

        Two <Image> elements rather than one with a breakpoint switch, because
        art direction differs (wide band vs full portrait), not just resolution.
      */}
      <section className="relative isolate overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 -z-10">
          <Image
            src="/hero/hero-mobile.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center lg:hidden"
          />
          <Image
            src="/hero/hero-desktop.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover object-[55%_45%] lg:block"
          />
          {/*
            Single top-weighted scrim, deliberately light.

            Measured composite luminance at the headline (y=27%) is what drives
            this. The photo is already dark through the lower half (32-59), so a
            heavy overlay adds nothing there but destroys the rock and snow
            detail that makes the image worth having. Two overlapping gradients
            (a vertical *and* a left wash) were the original mistake: they
            multiply, landing roughly 70% black on the left third and turning
            the photo into a flat panel. One gradient, tuned so the headline
            zone composites near 45 while the peak stays above 70 and remains
            legible as a photograph.
          */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/28 to-black/8" />
        </div>

        <div className="mx-auto max-w-5xl px-6 pt-24 pb-28 sm:pt-32 sm:pb-36">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center lg:gap-16">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-200/90">
                Trip planning
              </p>
              <h1 className="mt-5 text-[34px] font-bold leading-[1.15] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-[44px]">
                Plan the trip you&rsquo;re actually going to take.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-200 drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
                Flights, stays, trains and the drive between them, in one place — with
                a map that shows how far apart the pieces really are.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="focus-ring inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-700"
                >
                  Sign in to your trips
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className="focus-ring rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-[var(--surface-2)] hover:text-white"
                >
                  Create an account
                </Link>
              </div>

              <p className="mt-5 flex items-center gap-1.5 text-xs text-zinc-300 [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Your trips are private to your account.
              </p>
            </div>

            {/*
              A concrete glimpse of the product, rather than decoration. The
              hero's right half was empty on wide screens and the page described
              a map without ever showing one; this fills the space with the
              actual artefact being sold. Hidden below lg, where the columns
              stack and it would just push the features further down.
            */}
            <div className="hidden lg:block">
              <div className="surface-raised rounded-xl border border-white/8 p-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500">
                  Iceland Ring Road
                </p>
                <div className="mt-3 space-y-2.5">
                  {[
                    { icon: Plane, label: "KEF → Reykjavík", meta: "45 min drive" },
                    { icon: MapPin, label: "Þingvellir", meta: "1 h 10 m" },
                    { icon: MapPin, label: "Vík", meta: "2 h 45 m" },
                    { icon: CalendarDays, label: "Höfn", meta: "3 h 20 m" },
                  ].map(({ icon: Icon, label, meta }) => (
                    <div key={label} className="flex items-center gap-2.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                      <span className="truncate text-[13px] text-zinc-300">{label}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{meta}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3.5 border-t border-white/8 pt-3 text-[11px] text-zinc-500">
                  4 stops · 1,332 mi
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-6">
        {/* Features */}
        <section className="border-t border-white/8 py-16">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500">
            What it does
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="surface-raised rounded-xl border border-white/8 p-5"
              >
                <Icon className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <h3 className="mt-3.5 text-sm font-semibold text-zinc-100">{title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing */}
        <section className="border-t border-white/8 py-16">
          <div className="surface-raised flex flex-col items-start justify-between gap-6 rounded-xl border border-white/8 p-7 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
                Already have an account?
              </h2>
              <p className="mt-1.5 text-sm text-zinc-400">
                Sign in and your trips are exactly where you left them.
              </p>
            </div>
            <Link
              href="/login"
              className="focus-ring inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-700"
            >
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-10">
        <p className="text-xs text-zinc-600">TripPlanner</p>
      </footer>
    </div>
  );
}
