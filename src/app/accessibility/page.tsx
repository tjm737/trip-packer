/*
 * Accessibility statement. Public, like /privacy.
 */

import { LegalPage, ContactLink, type LegalSection } from "@/components/LegalPage";

export const metadata = {
  title: "Accessibility — TripPlanner",
  description:
    "TripPlanner's commitment to WCAG 2.1 AA, and how to report an accessibility problem.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Our commitment",
    body: [
      "TJM Studios LLC wants TripPlanner to be usable by everyone, including people who use screen readers, keyboard navigation, magnification, or other assistive technology. Our goal is for the website and app to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at Level AA.",
    ],
  },
  {
    heading: "What we do",
    body: [
      "We check text and controls for sufficient colour contrast in both the light and dark themes, label form fields, keep every action reachable from the keyboard with a visible focus indicator, use headings and landmarks so pages can be navigated by structure, and check public pages with automated accessibility audits.",
    ],
  },
  {
    heading: "Known limitations",
    body: [
      "The interactive trip map is visual. Every stop shown on it is also listed as text in the trip's itinerary, which is the accessible way to review the same information.",
      "Map images come from a third-party provider and may not meet every guideline. Weather and route details depend on outside services and may occasionally be unavailable.",
    ],
  },
  {
    heading: "Report a problem",
    body: [
      <>
        If something in TripPlanner is hard or impossible for you to use, please
        email <ContactLink /> and tell us the page or screen, what you were
        trying to do, and the device, browser, and any assistive technology you
        use. We aim to reply within five business days, and if we cannot fix the
        problem quickly we will help you get the information or result another
        way.
      </>,
    ],
  },
];

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility"
      intro="How we work to make TripPlanner accessible, and how to tell us when it is not."
      sections={SECTIONS}
      effective="11 November 2026"
    />
  );
}
