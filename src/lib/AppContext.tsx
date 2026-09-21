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
import { AppState, User, Trip, Category, PackingItem, Task, Reservation } from "@/lib/types";
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
  createTask,
  updateTask,
  deleteTask,
  createReservation,
  updateReservation,
  deleteReservation,
  reorderReservations,
  getItemProgress,
  getCategoriesForTrip,
  getItemsForCategory,
  getTasksForTrip,
  getTaskProgress,
  getTaskStatus,
  getReservationsForTrip,
  ReservationDraft,
  TaskStatus,
  ApiError,
  reconcilePending,
} from "@/lib/storage";
import { readCachedState, writeCachedState } from "@/lib/offlineCache";
import { importItinerary } from "@/lib/importItinerary";
import type { ParsedItinerary } from "@/lib/itineraryImport";

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
    /**
     * Create a trip and all of its reservations and tasks from a parsed
     * itinerary. Uneven compared with its siblings: it issues many writes, so
     * it owns state publication rather than going through `run` once.
     */
    import: (parsed: ParsedItinerary) => Promise<{ tripId: string; created: number }>;
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
  task: {
    create: (tripId: string, title: string, dueDate?: string) => Promise<void>;
    update: (
      id: string,
      data: { title?: string; done?: boolean; dueDate?: string; notes?: string }
    ) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  reservation: {
    create: (tripId: string, draft: ReservationDraft) => Promise<void>;
    update: (
      id: string,
      data: Partial<Omit<Reservation, "id" | "tripId" | "type" | "createdAt">>
    ) => Promise<void>;
    delete: (id: string) => Promise<void>;
    reorder: (tripId: string, orderedIds: string[]) => Promise<void>;
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
    getTasks: (tripId: string) => Task[];
    getTaskProgress: (tripId: string) => {
      done: number;
      total: number;
      overdue: number;
      percent: number;
    };
    getTaskStatus: (dueDate: string, done: boolean) => TaskStatus;
    getReservations: (tripId: string) => Reservation[];
  };
}

const EMPTY: AppState = {
  users: [],
  activeUserId: "",
  trips: [],
  categories: [],
  items: [],
  tasks: [],
  reservations: [],
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
      // Paint from the cached copy first when there is one, so an offline cold
      // start shows the itinerary immediately instead of an error. The network
      // read below then reconciles it.
      const cached = readCachedState();
      if (cached && !cancelled) {
        setState(cached.state);
        setHydrated(true);
      }

      try {
        const loaded = await fetchState();
        if (cancelled) return;
        if (loaded) {
          setState(loaded);
          setError(null);
        } else if (!cached) {
          setState(await initializeRemoteState());
        }
      } catch (err) {
        if (cancelled) return;
        // If we already rendered a cached copy, a failed refresh is not an
        // error worth showing — the user is simply offline with saved data.
        if (!cached) {
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
        // Replay anything still queued on top of the server response before it
        // is published or cached: a write can succeed while an *earlier*
        // offline edit is still waiting in the queue, and this server state
        // would not contain it.
        const reconciled = reconcilePending(authoritative);
        // Ignore stale responses; a newer action already owns the state.
        if (ticket === seq.current) {
          setState(reconciled);
          setError(null);
        }
        // Keep the offline copy current even for a superseded response: the
        // server state is authoritative regardless of which render wins.
        writeCachedState(reconciled);
        return reconciled;
      } catch (err) {
        if (ticket === seq.current) {
          // A queued-for-later write is not a failure — the optimistic state
          // is the truth until it syncs, so keep it and do not raise an error.
          if (err instanceof ApiError && err.status === 0) {
            writeCachedState(optimistic(state));
            return null;
          }
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
          // categories, items and tasks belonging to a trip that no longer exists.
          categories: prev.categories.filter((c) => c.tripId !== id),
          items: prev.items.filter((i) => i.tripId !== id),
          tasks: prev.tasks.filter((t) => t.tripId !== id),
        }),
        () => deleteTrip(id)
      );
    },
    /**
     * Import a parsed itinerary as a new trip.
     *
     * Deliberately does not delegate to `run`. That helper bumps the sequence
     * ticket once and discards responses from stale tickets, which is correct
     * for a single write but wrong for a batch: the importer issues N+1
     * requests, and each intermediate response would be published in turn,
     * briefly rendering a trip with none of its bookings.
     *
     * Instead we take the ticket once up front, hold every intermediate state
     * back until the batch completes, and publish only the final response. The
     * caller can navigate as soon as this resolves, because by then the trip is
     * in context — navigating against stale context is what produced the
     * "Trip not found" screen after a successful import.
     */
    import: async (parsed: ParsedItinerary) => {
      const ticket = ++seq.current;
      const snapshot = state;

      // Resolve the owner server-side for the same reason trip.create does:
      // React state may be stale pre-hydration and picking the wrong owner
      // would orphan the trip.
      const current = await fetchState();
      const ownerId =
        current?.activeUserId && current.users.some((u) => u.id === current.activeUserId)
          ? current.activeUserId
          : (current?.users[0]?.id ?? state.activeUserId);

      try {
        const { state: next, tripId, created } = await importItinerary(ownerId, parsed);
        if (ticket === seq.current) {
          setState(next);
          setError(null);
        }
        return { tripId, created };
      } catch (err) {
        // Partial imports are real: some records may have landed. Re-read so
        // the UI reflects what actually exists rather than the pre-import
        // snapshot, which would hide records the user needs to finish by hand.
        const authoritative = await fetchState().catch(() => null);
        if (ticket === seq.current) {
          setState(authoritative ?? snapshot);
          setError(err instanceof Error ? err.message : "Import failed");
        }
        throw err;
      }
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

  const taskActions = {
    create: async (tripId: string, title: string, dueDate = "") => {
      await run(
        (prev) => prev,
        async () => (await createTask(tripId, title, dueDate)).state
      );
    },
    update: async (
      id: string,
      data: { title?: string; done?: boolean; dueDate?: string; notes?: string }
    ) => {
      await run(
        (prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...data } : t)),
        }),
        () => updateTask(id, data)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }),
        () => deleteTask(id)
      );
    },
  };

  const reservationActions = {
    create: async (tripId: string, draft: ReservationDraft) => {
      await run(
        (prev) => prev,
        async () => (await createReservation(tripId, draft)).state
      );
    },
    update: async (
      id: string,
      data: Partial<Omit<Reservation, "id" | "tripId" | "type" | "createdAt">>
    ) => {
      await run(
        (prev) => ({
          ...prev,
          reservations: prev.reservations.map((r) => (r.id === id ? { ...r, ...data } : r)),
        }),
        () => updateReservation(id, data)
      );
    },
    delete: async (id: string) => {
      await run(
        (prev) => ({ ...prev, reservations: prev.reservations.filter((r) => r.id !== id) }),
        () => deleteReservation(id)
      );
    },
    /*
     * Optimistically renumber the affected trip's reservations, then persist.
     * The local update mirrors what the server does — position equals array
     * index — so a refetch cannot produce a different order than what the user
     * just saw.
     */
    reorder: async (tripId: string, orderedIds: string[]) => {
      const positions = new Map(orderedIds.map((id, i) => [id, i]));
      await run(
        (prev) => ({
          ...prev,
          reservations: prev.reservations.map((r) =>
            r.tripId === tripId && positions.has(r.id)
              ? { ...r, order: positions.get(r.id) as number }
              : r
          ),
        }),
        () => reorderReservations(tripId, orderedIds)
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
    getTasks: (tripId: string) => getTasksForTrip(tripId, state.tasks),
    getTaskProgress: (tripId: string) => getTaskProgress(tripId, state.tasks),
    getTaskStatus,
    getReservations: (tripId: string) => getReservationsForTrip(tripId, state.reservations),
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
        task: taskActions,
        reservation: reservationActions,
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
