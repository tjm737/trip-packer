"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { AppState, User, Trip, Category, PackingItem } from "@/lib/types";
import {
  fetchState,
  initializeRemoteState,
  addUser,
  updateUser,
  deleteUser,
  switchUser,
  createTrip,
  updateTrip,
  archiveTrip,
  deleteTrip,
  createCategory,
  updateCategory,
  deleteCategory,
  createItem,
  updateItem,
  deleteItem,
  getItemProgress,
  getCategoriesForTrip,
  getItemsForCategory,
} from "@/lib/storage";

/*
 * Client store.
 *
 * Persistence now lives in SQLite behind /api/mutate. Each action is
 * optimistic: the local state is updated immediately so the UI stays
 * responsive, then reconciled with the authoritative state the server returns.
 * If the write fails, the optimistic change is rolled back and the error is
 * surfaced, rather than leaving the UI showing a change that was never saved.
 *
 * `hydrated` still gates every component that renders persisted data, because
 * the server cannot know the client's data during SSR.
 */

interface AppContextType {
  state: AppState;
  /**
   * False during SSR and the first client render, true once state has loaded
   * from the server. Components rendering persisted data must gate on this so
   * server HTML and the first client render match.
   */
  hydrated: boolean;
  /** Non-null when the last write failed; cleared on the next success. */
  error: string | null;
  clearError: () => void;
  activeUser: User | undefined;
  user: {
    add: (name: string) => Promise<void>;
    update: (id: string, updates: Partial<User>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    switch: (userId: string) => Promise<void>;
  };
  trip: {
    create: (
      data: Omit<Trip, "id" | "userId" | "archived" | "createdAt" | "updatedAt">
    ) => Promise<string>;
    update: (id: string, data: Partial<Trip>) => Promise<void>;
    archive: (id: string, archived: boolean) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  category: {
    create: (tripId: string, name: string, icon: string) => Promise<string>;
    update: (id: string, data: { name?: string; icon?: string }) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  item: {
    create: (
      tripId: string,
      categoryId: string,
      name: string,
      icon: string,
      quantity: number
    ) => Promise<void>;
    update: (
      id: string,
      data: { name?: string; quantity?: number; checked?: boolean; icon?: string }
    ) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  helpers: {
    getProgress: (tripId: string) => number;
    getCategories: (tripId: string) => Category[];
    getItems: (categoryId: string) => PackingItem[];
    getItemsForCategoryAndName: (
      tripId: string,
      categoryName: string,
      itemName: string
    ) => PackingItem | null;
    findOrCreateCategory: (tripId: string, name: string, icon: string) => Promise<string>;
  };
}

const EMPTY: AppState = {
  users: [],
  activeUserId: "",
  trips: [],
  categories: [],
  items: [],
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a late-arriving response from a previous action overwriting
  // newer state when the user clicks quickly (e.g. toggling several items).
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loaded = await fetchState();
        if (cancelled) return;
        setState(loaded ?? (await initializeRemoteState()));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load your data");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Applies a local change immediately, then persists it. On failure the
   * previous state is restored so the UI never claims a write succeeded.
   */
  const run = useCallback(
    async (
      optimistic: (prev: AppState) => AppState,
      write: () => Promise<AppState>
    ): Promise<AppState | null> => {
      const ticket = ++seq.current;
      const snapshot = state;

      setState(optimistic);
      try {
        const authoritative = await write();
        // Ignore stale responses; a newer action already owns the state.
        if (ticket === seq.current) {
          setState(authoritative);
          setError(null);
        }
        return authoritative;
      } catch (err) {
        if (ticket === seq.current) {
          setState(snapshot);
          setError(err instanceof Error ? err.message : "Could not save your change");
        }
        return null;
      }
    },
    [state]
  );

  const activeUser = state.users.find((u) => u.id === state.activeUserId);

  const userActions = {
    add: async (name: string) => {
      await run(
        (prev) => prev,
        () => addUser(name).then((r) => r.state)
      );
    },
    update: async (id: string, updates: Partial<User>) => {
      await run(
        (prev) => ({
          ...prev,
          users: prev.users.map((u) => (u.id === id ? { ...u, ...updates } : u)),
        }),
        () => updateUser(id, updates)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => {
          const users = prev.users.filter((u) => u.id !== id);
          return {
            ...prev,
            users,
            activeUserId: prev.activeUserId === id ? (users[0]?.id ?? "") : prev.activeUserId,
          };
        },
        () => deleteUser(id)
      );
    },
    switch: async (userId: string) => {
      await run(
        (prev) => ({ ...prev, activeUserId: userId }),
        () => switchUser(userId)
      );
    },
  };

  const tripActions = {
    create: async (
      data: Omit<Trip, "id" | "userId" | "archived" | "createdAt" | "updatedAt">
    ): Promise<string> => {
      // Resolve the owner server-side: React state may be stale pre-hydration,
      // and picking the wrong owner would orphan the trip.
      const current = await fetchState();
      const ownerId =
        current?.activeUserId && current.users.some((u) => u.id === current.activeUserId)
          ? current.activeUserId
          : (current?.users[0]?.id ?? state.activeUserId);

      const result = await run(
        (prev) => prev,
        async () => (await createTrip(ownerId, data)).state
      );
      return result ? (result.trips.at(-1)?.id ?? "") : "";
    },
    update: async (id: string, data: Partial<Trip>) => {
      await run(
        (prev) => ({
          ...prev,
          trips: prev.trips.map((t) =>
            t.id === id ? { ...t, ...data, updatedAt: new Date().toISOString() } : t
          ),
        }),
        () => updateTrip(id, data)
      );
    },
    archive: async (id: string, archived: boolean) => {
      await run(
        (prev) => ({
          ...prev,
          trips: prev.trips.map((t) => (t.id === id ? { ...t, archived } : t)),
        }),
        () => archiveTrip(id, archived)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => ({
          ...prev,
          trips: prev.trips.filter((t) => t.id !== id),
          // Mirror the database cascade so the UI does not briefly show
          // categories and items belonging to a trip that no longer exists.
          categories: prev.categories.filter((c) => c.tripId !== id),
          items: prev.items.filter((i) => i.tripId !== id),
        }),
        () => deleteTrip(id)
      );
    },
  };

  const categoryActions = {
    create: async (tripId: string, name: string, icon: string): Promise<string> => {
      const result = await run(
        (prev) => prev,
        async () => (await createCategory(tripId, name, icon)).state
      );
      return result ? (result.categories.at(-1)?.id ?? "") : "";
    },
    update: async (id: string, data: { name?: string; icon?: string }) => {
      await run(
        (prev) => ({
          ...prev,
          categories: prev.categories.map((c) => (c.id === id ? { ...c, ...data } : c)),
        }),
        () => updateCategory(id, data)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => ({
          ...prev,
          categories: prev.categories.filter((c) => c.id !== id),
          items: prev.items.filter((i) => i.categoryId !== id),
        }),
        () => deleteCategory(id)
      );
    },
  };

  const itemActions = {
    create: async (
      tripId: string,
      categoryId: string,
      name: string,
      icon: string,
      quantity: number
    ) => {
      await run(
        (prev) => prev,
        async () => (await createItem(tripId, categoryId, name, icon, quantity)).state
      );
    },
    update: async (
      id: string,
      data: { name?: string; quantity?: number; checked?: boolean; icon?: string }
    ) => {
      await run(
        (prev) => ({
          ...prev,
          items: prev.items.map((i) => (i.id === id ? { ...i, ...data } : i)),
        }),
        () => updateItem(id, data)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }),
        () => deleteItem(id)
      );
    },
  };

  const helpers = {
    getProgress: (tripId: string) => getItemProgress(tripId, state.items).percent,
    getCategories: (tripId: string) => getCategoriesForTrip(tripId, state.categories),
    getItems: (categoryId: string) => getItemsForCategory(categoryId, state.items),
    getItemsForCategoryAndName: (tripId: string, categoryName: string, itemName: string) => {
      const cat = state.categories.find((c) => c.name === categoryName && c.tripId === tripId);
      if (!cat) return null;
      return state.items.find((i) => i.categoryId === cat.id && i.name === itemName) ?? null;
    },
    findOrCreateCategory: async (tripId: string, name: string, icon: string): Promise<string> => {
      const existing = state.categories.find((c) => c.tripId === tripId && c.name === name);
      if (existing) return existing.id;
      const result = await categoryActions.create(tripId, name, icon);
      return result;
    },
  };

  return (
    <AppContext.Provider
      value={{
        state,
        hydrated,
        error,
        clearError: () => setError(null),
        activeUser,
        user: userActions,
        trip: tripActions,
        category: categoryActions,
        item: itemActions,
        helpers,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
