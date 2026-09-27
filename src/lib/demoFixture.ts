/**
 * The demo account's fixtures.
 *
 * Split from the seed script so the content and the ordering rules can be
 * tested without touching a database, and so the "what does the reviewer see"
 * question has one answer in one file.
 *
 * Design notes that are not obvious from the data:
 *
 *  - The trip is deliberately NOT named something like "Demo Trip". A reviewer
 *    opening the app should see what the product looks like in use, and a
 *    fixture called "Demo Trip" reads as a fixture. It is a plausible trip.
 *
 *  - Dates are relative to today, computed at seed time, not hardcoded. A
 *    hardcoded date is in the past within months and the app then shows a
 *    finished trip with "0 days to go", which looks broken. The trip is always
 *    a few weeks out so the countdown, the upcoming-flight rendering and the
 *    staleness cues all have something real to show.
 *
 *  - The packing list spans checked and unchecked, and every category the app
 *    supports has contents. An empty category renders as an empty state, and a
 *    reviewer scrolling past three empty sections concludes the app is empty.
 */

export type DemoItem = {
  name: string;
  quantity?: number;
  checked?: boolean;
  icon?: string;
  /**
   * Which bag this item travels in, by index into the trip's `bags`.
   *
   * Omitted means unassigned, which is the normal state while packing. Not
   * every item gets one -- a list where literally everything is pre-assigned
   * looks curated rather than used.
   */
  bagIndex?: number;
};

export type DemoCategory = {
  name: string;
  icon: string;
  items: DemoItem[];
};

export type DemoReservation = {
  /** ReservationType: flight, lodging, car, train, ferry, activity, other. */
  type: "flight" | "lodging" | "car" | "train" | "ferry" | "activity" | "other";
  title: string;
  confirmation: string;
  /** Days from today to the booking's start date. */
  inDays: number;
  /** Nights/length, for the end date. 0 for same-day. */
  lengthDays?: number;
  /** Local clock time "HH:MM", 24h. Never a timestamp — see types.ts. */
  at: string;
  location: string;
  /** Arrival point. Flights/trains only; "" for lodging and cars. */
  locationTo?: string;
  cost?: string;
  notes?: string;
  confirmed?: boolean;
};

export type DemoTrip = {
  name: string;
  destination: string;
  /** Days from today to the start date. */
  startInDays: number;
  /** Length of the trip in days. */
  lengthDays: number;
  notes: string;
  icon: string;
  /**
   * Physical bags, for the packing list's Bags section.
   *
   * Optional: the archived trip has none, which is realistic and also proves the
   * UI's empty-bags state renders rather than only ever being seen full.
   */
  bags?: DemoBag[];
  categories: DemoCategory[];
  reservations: DemoReservation[];
};

export type DemoBag = {
  name: string;
  /** Must be one of the CHECK-constrained kinds: checked, carry_on, personal, other. */
  kind: "checked" | "carry_on" | "personal" | "other";
  /** Airline bag tag, when there is one. */
  tagNumber?: string;
  notes?: string;
};

/** `YYYY-MM-DD`, `days` from today. Date-only columns. */
export function dateFromNow(days: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The fixture trip.
 *
 * Kept as a function because the dates are relative to when it is called; a
 * module-level constant would freeze whatever day the server first imported it.
 */
export function demoTrip(): DemoTrip {
  return {
    name: "Lisbon Long Weekend",
    destination: "Lisbon, Portugal",
    startInDays: 24,
    lengthDays: 4,
    /*
     * An emoji, not a lucide name. Trip icons render as raw text
     * (`{trip.icon}`), so a name like "plane" shows the literal word in the
     * sidebar and on the shared page. Every real entry point defaults to "✈️"
     * — see trips/new/page.tsx, DashboardClient.tsx and itineraryImport.ts.
     */
    icon: "✈️",
    notes:
      "Flight lands mid-afternoon. Hotel is a 15-minute walk from Praça do " +
      "Comércio, so no car needed — the tram and the metro cover everything.",
    /*
     * Two bags, and the assignment follows what a real packer would do: the
     * carry-on holds what you cannot afford to lose (documents, medication,
     * electronics), the checked bag holds bulk clothing. That makes the Bags
     * section demonstrate its actual purpose -- "where is it right now" -- rather
     * than showing two containers with arbitrary contents.
     */
    bags: [
      {
        name: "Black carry-on",
        kind: "carry_on",
        tagNumber: "TP-4471902",
        notes: "Overhead bin. Keeps the documents and medication with me.",
      },
      {
        name: "Blue checked bag",
        kind: "checked",
        tagNumber: "TP-4471903",
        notes: "",
      },
    ],
    categories: [
      {
        name: "Clothing",
        icon: "shirt",
        items: [
          { name: "T-shirts", quantity: 4, checked: true, icon: "shirt", bagIndex: 1 },
          { name: "Light jacket", quantity: 1, checked: true, icon: "shirt", bagIndex: 1 },
          { name: "Walking shoes", quantity: 1, icon: "footprints", bagIndex: 1 },
          { name: "Swimsuit", quantity: 1, icon: "shirt", bagIndex: 1 },
          { name: "Socks", quantity: 5, icon: "shirt", bagIndex: 1 },
        ],
      },
      {
        name: "Toiletries",
        icon: "droplet",
        items: [
          { name: "Toothbrush", quantity: 1, checked: true, icon: "droplet" },
          { name: "Sunscreen SPF 50", quantity: 1, icon: "sun", bagIndex: 1 },
          { name: "Prescription medication", quantity: 1, icon: "pill", bagIndex: 0 },
          { name: "Razor", quantity: 1, icon: "droplet" },
        ],
      },
      {
        name: "Electronics",
        icon: "plug",
        items: [
          { name: "Phone charger", quantity: 1, checked: true, icon: "plug", bagIndex: 0 },
          { name: "Type C adapter (Portugal)", quantity: 2, icon: "plug", bagIndex: 0 },
          { name: "Power bank", quantity: 1, icon: "battery", bagIndex: 0 },
          { name: "Headphones", quantity: 1, icon: "headphones", bagIndex: 0 },
        ],
      },
      {
        name: "Documents",
        icon: "file-text",
        items: [
          { name: "Passport", quantity: 1, checked: true, icon: "book", bagIndex: 0 },
          { name: "Travel insurance", quantity: 1, icon: "file-text", bagIndex: 0 },
          { name: "Hotel confirmation", quantity: 1, checked: true, icon: "file-text", bagIndex: 0 },
          { name: "Boarding passes", quantity: 2, icon: "ticket", bagIndex: 0 },
        ],
      },
    ],
    reservations: [
      {
        type: "flight",
        title: "LIS → LGW, TP1234",
        confirmation: "TP-8HK2LM",
        inDays: 24,
        at: "09:20",
        location: "Humberto Delgado Airport (LIS)",
        locationTo: "Gatwick (LGW)",
        cost: "412.50 USD",
        notes: "Terminal 1. Check-in opens 3 hours before departure.",
      },
      {
        type: "lodging",
        title: "Baixa Hotel",
        confirmation: "BH-4491203",
        inDays: 24,
        lengthDays: 3,
        at: "15:00",
        location: "Rua Augusta 120, Lisboa",
        cost: "486.00 EUR",
      },
      {
        type: "car",
        title: "Airport transfer",
        confirmation: "TRF-77120",
        inDays: 24,
        at: "16:15",
        location: "Arrivals, LIS",
        notes: "Driver meets in arrivals with a name board.",
      },
      {
        type: "activity",
        title: "Dinner — Cervejaria Ramiro",
        confirmation: "CR-2211",
        inDays: 25,
        at: "20:00",
        location: "Av. Almirante Reis 1, Lisboa",
        notes: "No reservations after 19:00 on Fridays; this one is for 20:00.",
      },
    ],
  };
}

/**
 * The second trip, so the trips list is not a single card.
 *
 * Archived, which is deliberate: the list has an active/archived split and a
 * single trip leaves the archived state unexercised, so a reviewer cannot tell
 * whether it works.
 */
export function archivedDemoTrip(): DemoTrip {
  return {
    name: "Chicago — Family Visit",
    destination: "Chicago, IL",
    startInDays: -46,
    lengthDays: 5,
    icon: "🏠",
    notes: "Thanksgiving with the family. Kept for the packing list.",
    categories: [
      {
        name: "Clothing",
        icon: "shirt",
        items: [
          { name: "Warm coat", quantity: 1, checked: true, icon: "shirt" },
          { name: "Gloves", quantity: 1, checked: true, icon: "shirt" },
          { name: "Sweaters", quantity: 3, checked: true, icon: "shirt" },
        ],
      },
      {
        name: "Gifts",
        icon: "gift",
        items: [
          { name: "Wine for dinner", quantity: 2, checked: true, icon: "gift" },
          { name: "Board game", quantity: 1, checked: true, icon: "gift" },
        ],
      },
    ],
    reservations: [
      {
        type: "flight",
        title: "ORD → LHR, AA86",
        confirmation: "AA-556701",
        inDays: -42,
        at: "18:40",
        location: "O'Hare International (ORD)",
        locationTo: "Heathrow (LHR)",
        cost: "598.20 USD",
      },
    ],
  };
}
