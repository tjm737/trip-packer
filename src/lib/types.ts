/*
 * Type-only import, so this shared data-shape module does not gain a runtime
 * dependency on the theme helpers (which touch `document` and are meant for the
 * browser). `import type` is erased at compile time, so the shape stays pure
 * while both sides still agree on what a valid theme is.
 */
import type { Theme } from "./theme";

export type User = {
  id: string;
  name: string;
  avatarColor: string;
  createdAt: string;
  /*
   * Credentials. Optional because a "companion" profile — a fellow traveller who
   * appears on a trip but has no account — is a User row with no login. The
   * previous model had every profile equally able to be the active user, which
   * is what `user.switch` did; now only rows with credentials can sign in.
   */
  email?: string;
  passwordHash?: string;
  /*
   * Whether this account may administer others. A plain boolean rather than a
   * role enum because there are exactly two levels and an enum invites a third
   * that nothing enforces.
   */
  isOwner?: boolean;
  /*
   * Display preference. Required (not optional) because `toUser` always resolves
   * it — a NULL column becomes the default — so every client-side `User` carries
   * a usable value and no consumer needs a fallback of its own. Optional here
   * would push the same `?? "dark"` into every component that reads it.
   */
  theme: Theme;
};

export type Trip = {
  id: string;
  userId: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  notes: string;
  icon: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Category = {
  id: string;
  tripId: string;
  name: string;
  icon: string;
  order: number;
};

export type PackingItem = {
  id: string;
  tripId: string;
  categoryId: string;
  name: string;
  quantity: number;
  checked: boolean;
  icon: string;
  order: number;
  /*
   * Which bag this item is packed in, or null when unassigned.
   *
   * Optional in the type as well as nullable in the schema so that every
   * existing construction site keeps compiling: a missing bagId and a null
   * bagId both mean "not in a bag yet", which is the honest default for the
   * trips that existed before bags did.
   *
   * This is deliberately NOT a foreign key at the type level either — nothing
   * guarantees the bag still exists after a delete, so read paths must tolerate
   * a dangling id rather than assume it resolves. bag.delete clears it, but a
   * client holding a stale snapshot could still send one.
   */
  bagId?: string | null;
};

/**
 * A bag: a physical container the trip's items travel in.
 *
 * Bags answer "where is this thing right now", which is a DIFFERENT question
 * from Category ("what kind of thing is it"). The same t-shirt is Clothing AND
 * in the black carry-on, so a bag is a second axis rather than another category.
 *
 * Not to be confused with a "registered bag" — a persistent object with a tag
 * number that travels across trips. This type is deliberately trip-scoped
 * (`tripId` is a plain required string), and the schema's nullable column is
 * what leaves room for registered bags later without a data migration.
 */
export type Bag = {
  id: string;
  tripId: string;
  name: string;
  kind: BagKind;
  /** Airline tag number, when the bag has one. Free text; "" when unknown. */
  tagNumber: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * What sort of container this is.
 *
 * `carry_on` and `personal` matter beyond labelling: a bag that never leaves
 * your side is not exposed to the same loss risk as a checked bag, and a claim
 * export needs to distinguish them.
 */
export type BagKind = "checked" | "carry_on" | "personal" | "other";

export const BAG_KINDS: readonly BagKind[] = [
  "checked",
  "carry_on",
  "personal",
  "other",
] as const;

/** Human labels for the UI. Kept next to the values so they cannot drift. */
export const BAG_KIND_LABELS: Record<BagKind, string> = {
  checked: "Checked",
  carry_on: "Carry-on",
  personal: "Personal item",
  other: "Other",
};

/**
 * A pre-trip chore: "renew passport", "book the rental car".
 *
 * Deliberately not a PackingItem. A packing item answers "did I put this in
 * the bag"; a task answers "is this done before I leave", and often has a
 * deadline rather than a quantity. Reusing PackingItem would have meant an
 * unused `quantity` on every task and a `dueDate` that packing rows could
 * never sensibly use.
 */
export type Task = {
  id: string;
  tripId: string;
  title: string;
  done: boolean;
  /** "YYYY-MM-DD" or "" when the task has no deadline. */
  dueDate: string;
  notes: string;
  order: number;
  createdAt: string;
};

/**
 * What kind of booking this is. Drives which fields the UI emphasises and how
 * the entry is labelled on the map later (a flight is a pair of endpoints, a
 * hotel is a single point you stay at, a car is picked up and dropped).
 */
export type ReservationType =
  | "flight"
  | "lodging"
  | "car"
  | "train"
  | "ferry"
  | "activity"
  | "other";

/**
 * A booking: the flight, the hotel, the rental car, the tour.
 *
 * Kept separate from Task because the two have genuinely different shapes. A
 * task is a thing to do with a deadline; a reservation is a record of
 * something already booked, with a confirmation number you need to produce at
 * a counter. Overloading one table would mean every row carrying a union of
 * both field sets, mostly empty.
 *
 * All the detail fields are optional strings rather than nullable columns:
 * you might book a hotel before you know the check-in time, and a
 * half-completed reservation should still save. Empty string means "not
 * filled in", matching how `dueDate` works on Task.
 */
export type Reservation = {
  id: string;
  tripId: string;
  type: ReservationType;
  /** "Delta 4021", "Blue Lagoon Guesthouse", "Hertz". */
  title: string;
  /** Booking reference / confirmation code — the thing you show at a desk. */
  confirmation: string;
  /**
   * Whether this booking is locked in or still being considered.
   *
   * Deliberately separate from `confirmation`: a confirmation code is a
   * *reference number*, and having one does not mean the booking is settled
   * (you might be holding a code for a reservation you intend to cancel), while
   * a settled booking may legitimately have no code yet — a hotel booked by
   * phone, a rental paid on arrival. Collapsing the two would make "do I have
   * the reference handy" and "is this still a maybe" the same question, which
   * they are not.
   *
   * A plain boolean rather than a wider status enum: the app only ever asks
   * two questions of this field — should this be visually de-emphasised, and
   * how many bookings are still unresolved — and "cancelled" is really a
   * delete. Keeping it binary means there is no state the UI can forget to
   * handle.
   */
  confirmed: boolean;
  /** Where you go. For flights this is the departure point. */
  location: string;
  /** Arrival point. Flights and trains use it; lodging and cars leave it "". */
  locationTo: string;
  /** "YYYY-MM-DD" or "" — same convention as Task.dueDate. */
  startDate: string;
  /** Clock time "HH:MM" (24h) or "". Deliberately not a full timestamp: a
   *  booking time is local to wherever you are, and storing an instant would
   *  silently shift it across timezones. */
  startTime: string;
  endDate: string;
  endTime: string;
  /** Free-text cost, e.g. "412.50 USD". Not a number: currency varies and
   *  splitting into amount+currency buys nothing at this stage. */
  cost: string;
  notes: string;
  /** Drag position. Only meaningful when `orderManual` is non-null. */
  order: number;
  /**
   * Whether the user has ever dragged this trip's itinerary.
   *
   * `null` means they have not, so the map and list sequence by date and treat
   * `order` as meaningless. A number means they have, and `order` wins — which
   * is what preserves a deliberate drag across dates.
   */
  orderManual: number | null;
  createdAt: string;
};

export type TripMember = {
  tripId: string;
  userId: string;
  /*
   * 'editor' may change the trip's contents; 'viewer' may only read it. The
   * owner is deliberately never in this table — trips.userId already records
   * ownership, and storing it twice lets the two disagree. Mirrors the CHECK
   * constraint on trip_members.
   */
  role: "editor" | "viewer";
  createdAt: string;
};

export type AppState = {
  users: User[];
  activeUserId: string;
  trips: Trip[];
  categories: Category[];
  items: PackingItem[];
  tasks: Task[];
  reservations: Reservation[];
  /*
   * Bags for each trip.
   *
   * Optional like `tripMembers` so that any construction site holding a state
   * without bags keeps compiling, and so a client on an older build does not
   * crash on a state that has them. Read paths must tolerate `undefined`.
   */
  bags?: Bag[];
  /*
   * Non-owner grants, loaded by readState().
   *
   * This must be populated or lib/access.ts silently treats every shared trip as
   * unreadable: roleOnTrip() reads this list, and an empty list is
   * indistinguishable from "no shares exist". The failure is invisible — shared
   * trips just never appear — so it is loaded eagerly alongside the trips it
   * refers to rather than lazily on first permission check.
   */
  tripMembers?: TripMember[];
};
