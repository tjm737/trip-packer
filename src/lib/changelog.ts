/**
 * Release notes.
 *
 * Curated rather than derived from git: commit subjects are written for whoever
 * is reading `git log`, and a release note needs to say what changed *for the
 * person packing a bag*, grouped by area instead of by commit order. The
 * grouped entries below are the source of truth.
 *
 * When you ship something worth telling a user about, add a release at the TOP
 * of RELEASES and bump `version` in package.json to match. Keep entries short
 * and concrete; note the fix, not the implementation. Internal chores (lints,
 * refactors with no behaviour change) do not need an entry.
 *
 * `RELEASES[0]` is the current version, so the About tab can show it without a
 * second source that could disagree.
 */

export interface ChangeGroup {
  /** Area of the app, as a user would describe it. */
  area: string;
  items: string[];
}

export interface Release {
  version: string;
  /** ISO date, rendered as "20 Sep 2026". */
  date: string;
  /** One line on what this release was about. */
  headline: string;
  /** A short, informal label: "Initial release", "Beta", etc. Omit once stable. */
  tag?: string;
  groups: ChangeGroup[];
}

/**
 * Newest first. The first entry is what About shows as the running version.
 */
export const RELEASES: Release[] = [
  {
    version: "0.5.0",
    date: "2026-09-20",
    headline: "Weather that actually loads, and a Status control for bookings",
    groups: [
      {
        area: "Weather",
        items: [
          "Fixed weather showing nothing at all on trips whose destination is an airport rather than a town — the destination is now resolved against the offline airport dataset before geocoding, so a destination like \"near MUC\" works.",
          "Fixed the historical year-by-year rows clipping the rainfall figure on a phone; rows now wrap instead of cutting the number off.",
        ],
      },
      {
        area: "Bookings",
        items: [
          "Added a Status control to the booking editor, so a booking can be changed between confirmed and draft while editing it.",
          "Made the selected state on status controls actually visible. It previously relied on a very faint tint, which was indistinguishable from the unselected state.",
        ],
      },
      {
        area: "Itinerary",
        items: [
          "Enlarged the Map link on mobile and gave it a real border, so it reads as a control rather than decoration.",
        ],
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-19",
    headline: "A quieter palette, and clearer ways to filter and open a booking",
    groups: [
      {
        area: "Appearance",
        items: [
          "Retuned the accent colour to a muted sage and removed the blue cast from the greys.",
        ],
      },
      {
        area: "Map",
        items: [
          "Added a booking-type filter to the trip map, so flights, stays, cars and activities can be shown or hidden.",
          "Added a Google Maps link to each booking, opening its location directly.",
        ],
      },
      {
        area: "Bookings",
        items: [
          "Added confirmed and draft states for bookings, so a booking can be marked as still being researched.",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-18",
    headline: "Itinerary that works offline, understands airport codes, and edits in place",
    groups: [
      {
        area: "Offline",
        items: [
          "Installed as an app, with trip pages and shell assets cached so a trip can be opened with no connection.",
          "Fixed stops dropping off the map on every load after the first.",
          "Normalised how cached coordinates are keyed, so the offline map can find them again.",
        ],
      },
      {
        area: "Locations",
        items: [
          "Airport codes are now resolved offline from a built-in dataset instead of being sent to a lookup service, so codes resolve without a connection and without ambiguity.",
          "Ambiguous locations are resolved using the booking title as context, so \"Terminal 5\" lands in the right city.",
        ],
      },
      {
        area: "Itinerary",
        items: [
          "Itinerary stops can be edited in place from the map, not just reordered.",
          "Added Map, Itinerary, Packing and Notes tabs to keep the trip page navigable.",
          "Stop order is persisted across the whole reservation set, not just the visible list.",
          "Added import from an existing itinerary file, which creates the trip and its bookings in one step.",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-17",
    headline: "Maps, a proper trip layout, and bookings you can move around",
    groups: [
      {
        area: "Map",
        items: [
          "Added a trip map drawing driving legs between stops.",
          "Drew flight legs as great-circle arcs rather than straight lines.",
          "Switched to a dark basemap and re-themed the map controls to match.",
          "Made itinerary stops draggable to reorder, with the new order saved.",
        ],
      },
      {
        area: "Layout",
        items: [
          "Laid the trip page out in columns to cut vertical scrolling.",
          "Put notes and tasks side by side and led with the map.",
          "Fixed a sidebar layout collision and unified its visual scale.",
        ],
      },
      {
        area: "Bookings",
        items: [
          "Added flights, lodging, cars and activities.",
          "Added geocoding with a local cache, ranked to prefer airports when a code is typed.",
          "Fixed \"Trip not found\" appearing after a successful import.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-16",
    headline: "First working version",
    tag: "Initial release",
    groups: [
      {
        area: "Trips",
        items: [
          "Create trips with a destination and dates, with support for more than one traveller.",
          "Group trips into upcoming and archived.",
        ],
      },
      {
        area: "Packing",
        items: [
          "Packing lists with progress per trip.",
          "Pre-trip tasks with optional deadlines and overdue tracking.",
        ],
      },
      {
        area: "Weather",
        items: [
          "Current conditions and historical climate for a trip's destination.",
          "Weather-based packing suggestions.",
        ],
      },
      {
        area: "Storage",
        items: [
          "Trips are stored in a local database rather than the browser, so nothing is lost on a refresh.",
          "Responsive layout for phone use.",
        ],
      },
    ],
  },
];

/** The version currently running. Kept in step with RELEASES[0] by convention. */
export const CURRENT_VERSION = RELEASES[0].version;
