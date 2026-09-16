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

export type AppState = {
  users: User[];
  activeUserId: string;
  trips: Trip[];
  categories: Category[];
  items: PackingItem[];
};
