/*
 * Privacy policy.
 *
 * Required by App Store Connect for any app with accounts, and linked from the
 * app's App Store listing. Public on purpose: a policy behind a login is not a
 * policy, and Apple's reviewers must be able to read it without credentials.
 *
 * The matcher in src/proxy.ts covers only /trips/:path*, so this route needs no
 * allowlist entry -- nothing protects it in the first place.
 *
 * Written to describe what the code actually does, not a generic template.
 * Every claim below is checkable against the repo:
 *   - on-device generation: src/lib/foundationModels.ts (no fetch anywhere in
 *     that module; the prompt goes to the native FoundationModels plugin)
 *   - stored data: src/lib/db.ts (trips, items, reservations, accounts,
 *     geocache, user_settings)
 *   - account deletion: handled by the user.delete mutation
 * If the data model changes, this page has to change with it.
 */

import Link from "next/link";
import { Plane, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy Policy — TripPlanner",
  description:
    "What TripPlanner stores, where it is stored, and how on-device packing suggestions work.",
};

const SECTIONS = [
  {
    heading: "What we store",
    body: [
      "TripPlanner stores the information you enter: your trips, the packing list for each trip, itinerary stops, reservations, and the notes you add to them. If you create an account, we store your email address and a hashed form of your password.",
      "We also store the ntfy topic you configure if you enable plane notifications, and a cache of geographic coordinates for places you look up, so the app does not have to look them up again.",
    ],
  },
  {
    heading: "Where it is stored",
    body: [
      "Your data is stored on a server that the operator of this app controls, in a single database file. It is not sold, rented, or shared with advertisers, and there is no analytics or tracking SDK in the app.",
      "Traffic to the server is encrypted in transit with HTTPS.",
    ],
  },
  {
    heading: "Packing suggestions stay on your device",
    body: [
      "The packing suggestions feature uses Apple Intelligence to generate ideas based on your destination, trip length, the time of year, and any activities you have booked.",
      "This generation happens entirely on your iPhone. The prompt is passed to Apple's on-device Foundation Models framework, and neither the prompt nor the result is sent to our server or to any third party. Nothing about what you are packing for leaves your device.",
      "If your device does not support Apple Intelligence, or the feature is turned off, the suggestions are simply unavailable. No data is collected as a fallback.",
    ],
  },
  {
    heading: "Location and maps",
    body: [
      "The app does not request access to your device's location. Maps are displayed using coordinate data derived from the places you type into your itinerary, and map tiles are loaded from OpenStreetMap.",
      "If you tap a map link, your device opens a third-party maps application, and that application's own privacy policy applies from that point.",
    ],
  },
  {
    heading: "Shared trips",
    body: [
      "If you create a share link for a trip, anyone with that link can view the trip without signing in. The link is the only credential, so treat it as you would a password: only share it with people you want to see the trip.",
      "You can revoke a share link at any time, which makes it stop working immediately.",
    ],
  },
  {
    heading: "Notifications",
    body: [
      "If you enable plane notifications, the app sends a message to the notification service ntfy, which delivers it to your device. The content of that message is the aircraft information you asked to be alerted about.",
    ],
  },
  {
    heading: "Deleting your data",
    body: [
      "You can delete your account from the Profile tab inside the app. Deleting your account removes it along with the trips and data associated with it.",
      "If you would prefer to have your data removed for you, or you have any question about what is stored, contact us and we will handle it.",
    ],
  },
  {
    heading: "Children",
    body: [
      "TripPlanner is not directed at children and we do not knowingly collect information from children.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "If this policy changes in a way that affects what is stored or how it is used, the updated version will be posted at this address and the date below will change.",
    ],
  },
];

export default function PrivacyPage() {
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
          className="focus-ring inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-[var(--surface-2)] hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          TripPlanner is a trip planning and packing app. This page explains what
          the app stores, where it is stored, and what happens to the
          information you put into it.
        </p>

        <div className="mt-10 space-y-9">
          {SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="text-[15px] font-semibold tracking-tight text-zinc-100">
                {section.heading}
              </h2>
              <div className="mt-2.5 space-y-3">
                {section.body.map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-sm leading-relaxed text-zinc-400"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h2 className="text-[15px] font-semibold tracking-tight text-zinc-100">
              Contact
            </h2>
            <p className="mt-2.5 text-sm leading-relaxed text-zinc-400">
              Questions about this policy or your data can be sent to{" "}
              <a
                href="mailto:tylerjamesmorgan@gmail.com"
                className="focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                tylerjamesmorgan@gmail.com
              </a>
              . See also the{" "}
              <Link
                href="/support"
                className="focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                support page
              </Link>
              .
            </p>
          </section>
        </div>

        <p className="mt-12 text-xs text-zinc-500">
          Last updated 23 September 2026.
        </p>
      </main>
    </div>
  );
}
