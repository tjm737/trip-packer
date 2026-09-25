/*
 * Support page.
 *
 * This is the "Support URL" field in App Store Connect, so it has to work for
 * a logged-out visitor with no context: no session, no app installed, no idea
 * what the product is. It is also the page a reviewer lands on if something in
 * the app confused them.
 *
 * Because the app is invite-only, the single most important question a
 * reviewer will have is "how do I get in?" -- so that is answered first, in
 * plain terms, rather than buried under a FAQ. A reviewer who cannot get past
 * the sign-in screen rejects the app as unreviewable, and it is not their job
 * to guess.
 *
 * Public for the same reason as /privacy: the matcher in src/proxy.ts covers
 * only /trips/:path*, so nothing gates this route.
 */

import Link from "next/link";
import { Plane, ArrowLeft, Mail } from "lucide-react";

export const metadata = {
  title: "Support — TripPlanner",
  description:
    "How to get access to TripPlanner, and how to get help with your account, trips, or packing lists.",
};

const SUPPORT_EMAIL = "tylerjamesmorgan@gmail.com";

const FAQ = [
  {
    q: "How do I create an account?",
    a: "TripPlanner is invite-only. Accounts are created by the app's owner rather than through a public sign-up form, which is why there is no \"Create account\" button on the sign-in screen. To request access, email us at the address below and we will set one up for you.",
  },
  {
    q: "Why can't I sign in?",
    a: "Accounts are created for a specific email address. If you have not been given one yet, see the question above. If you believe you already have an account and cannot get in, email us and we will look at it — we will never ask you for your password.",
  },
  {
    q: "The \"Suggest items\" button is missing or does nothing",
    a: "Packing suggestions need Apple Intelligence, which requires an iPhone that supports it and the feature switched on in Settings. If your device does not support it, the suggestion feature is simply unavailable and the rest of the app works normally. This is why suggestions are generated on your device: nothing you are packing for is ever sent to a server.",
  },
  {
    q: "How do I share a trip with someone?",
    a: "Open the trip and use the share option to create a link. Anyone with that link can view the trip without signing in, so only send it to people you want to see it. You can revoke a link at any time, and it will stop working immediately.",
  },
  {
    q: "How do I delete my account and data?",
    a: "Open the Profile tab in the app and use the delete option. This removes your account and the trips and data associated with it. If you would rather we did it for you, email us.",
  },
  {
    q: "Do you use my location?",
    a: "No. The app never asks for access to your device's location. Maps are drawn from the places you type into your itinerary.",
  },
];

export default function SupportPage() {
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
          Support
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          TripPlanner is a small app, maintained by one person. Email is the
          fastest way to reach us, and you will get a reply from a human.
        </p>

        {/*
          Contact comes before the FAQ deliberately: for a reviewer, "how do I
          get in" is the blocking question, and making them scroll past six
          answers to find the email would be the wrong order.
        */}
        <div className="mt-8 rounded-xl border border-zinc-800 bg-[var(--surface-2)] p-5">
          <div className="flex items-start gap-3">
            <Mail
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-zinc-100">
                Get in touch
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                For access, account problems, or anything else:
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="focus-ring mt-2.5 inline-block rounded text-sm font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>

        <h2 className="mt-12 text-[15px] font-semibold tracking-tight text-zinc-100">
          Common questions
        </h2>
        <div className="mt-4 space-y-6">
          {FAQ.map((item) => (
            <section key={item.q}>
              <h3 className="text-sm font-medium text-zinc-200">{item.q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                {item.a}
              </p>
            </section>
          ))}
        </div>

        <p className="mt-12 text-sm leading-relaxed text-zinc-400">
          See also our{" "}
          <Link
            href="/privacy"
            className="focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
          >
            privacy policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
