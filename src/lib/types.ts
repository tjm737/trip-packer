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
  order: number;
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
};
