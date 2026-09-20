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

export type AppState = {
  users: User[];
  activeUserId: string;
  trips: Trip[];
  categories: Category[];
  items: PackingItem[];
  tasks: Task[];
};
