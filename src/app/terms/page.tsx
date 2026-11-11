/*
 * Terms of use.
 *
 * Plain English on purpose: the app is free, invite-only, and run by one
 * person, so the terms say what that means in practice rather than borrowing a
 * template written for a different business. Public, like /privacy.
 */

import Link from "next/link";
import { LegalPage, ContactLink, type LegalSection } from "@/components/LegalPage";

export const metadata = {
  title: "Terms of Use — TripPlanner",
  description: "The terms for using TripPlanner, in plain English.",
};

const linkClass =
  "focus-ring rounded font-medium text-emerald-400 underline underline-offset-2 hover:text-emerald-300";

const SECTIONS: LegalSection[] = [
  {
    heading: "Who we are",
    body: [
      "TripPlanner is provided by TJM Studios LLC, a Pennsylvania limited liability company (\u201cwe\u201d, \u201cus\u201d). By using the app or this website you agree to these terms. If you do not agree, please do not use TripPlanner.",
    ],
  },
  {
    heading: "Your account",
    body: [
      "Accounts are invite-only and are created for you by us. You must be at least 13 years old to use TripPlanner. Keep your password to yourself; you are responsible for what happens under your account. Tell us promptly if you think someone else has access to it.",
      "We may suspend or close an account that is used to break the law, to harm other people, or to attack or overload the service. You can delete your account at any time from the Profile tab.",
    ],
  },
  {
    heading: "Your content",
    body: [
      "The trips, lists, notes, and other information you enter stay yours. You give us only the permission we need to store them, show them to you, and show them to anyone you share a trip with, so the app can work.",
      "Do not put anything into TripPlanner that you do not have the right to use, or that is unlawful. Anyone with a share link you create can view that trip, so share links carefully.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "Do not try to access other people's accounts or data, interfere with or overload the service, scrape it, or use it to send spam or malware.",
    ],
  },
  {
    heading: "Travel information is a guide, not a guarantee",
    body: [
      "Weather, maps, routes, travel times, and packing suggestions come from third-party services and on-device models and can be wrong, out of date, or incomplete. Always check flight times, reservations, entry requirements, and anything else important with the airline, hotel, or official source before you rely on it.",
    ],
  },
  {
    heading: "No warranty",
    body: [
      "TripPlanner is provided \u201cas is\u201d and \u201cas available\u201d, without warranties of any kind, whether express or implied, including any warranty of merchantability, fitness for a particular purpose, or non-infringement. We do not promise that it will always be available, error-free, or that your data will never be lost, so keep your own copy of anything you cannot afford to lose.",
    ],
  },
  {
    heading: "Limitation of liability",
    body: [
      "To the fullest extent the law allows, TJM Studios LLC is not liable for any indirect, incidental, special, or consequential damages, or for missed trips, lost bookings, or lost data, arising from your use of TripPlanner. Our total liability for any claim relating to the app is limited to the amount you paid us to use it in the previous 12 months (which, for a free app, is zero). Some places do not allow these limits, in which case they apply only as far as permitted.",
    ],
  },
  {
    heading: "Changes and ending the service",
    body: [
      "We may change or stop offering TripPlanner, or update these terms. If the terms change in a way that matters, we will post the new version here and change the date below; continuing to use the app after that means you accept the update.",
    ],
  },
  {
    heading: "Governing law",
    body: [
      "These terms are governed by the laws of the Commonwealth of Pennsylvania, United States, without regard to its conflict-of-laws rules. Any dispute will be handled in the state or federal courts located in Pennsylvania, unless the law where you live gives you the right to bring it elsewhere.",
    ],
  },
  {
    heading: "Apple App Store",
    body: [
      "If you downloaded TripPlanner from the App Store, these terms are between you and TJM Studios LLC, not Apple. Apple has no obligation to provide support or maintenance for the app, and Apple's standard Licensed Application End User License Agreement also applies.",
    ],
  },
  {
    heading: "Contact",
    body: [
      <>
        Questions about these terms can be sent to <ContactLink />. See also the{" "}
        <Link href="/privacy" className={linkClass}>
          privacy policy
        </Link>
        .
      </>,
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="The short version: TripPlanner is a free tool for planning trips. Use it lawfully, keep your account to yourself, double-check important travel details, and understand that it comes without guarantees."
      sections={SECTIONS}
      effective="11 November 2026"
    />
  );
}
