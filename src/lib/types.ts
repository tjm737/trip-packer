export type User = {
  id: string;
  name: string;
  avatarColor: string;
  createdAt: string;
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
