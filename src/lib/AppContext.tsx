"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { AppState, User, Trip, Category, PackingItem } from "@/lib/types";
import {
  initializeState,
  loadState,
  saveState,
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

interface AppContextType {
  state: AppState;
  activeUser: User | undefined;
  user: {
    add: (name: string) => void;
    update: (id: string, updates: Partial<User>) => void;
    delete: (id: string) => void;
    switch: (userId: string) => void;
  };
  trip: {
    create: (data: Omit<Trip, "id" | "userId" | "archived" | "createdAt" | "updatedAt">) => void;
    update: (id: string, data: Partial<Trip>) => void;
    archive: (id: string, archived: boolean) => void;
    delete: (id: string) => void;
  };
  category: {
    create: (tripId: string, name: string, icon: string) => void;
    update: (id: string, data: { name?: string; icon?: string }) => void;
    delete: (id: string) => void;
  };
  item: {
    create: (tripId: string, categoryId: string, name: string, icon: string, quantity: number) => void;
    update: (id: string, data: { name?: string; quantity?: number; checked?: boolean; icon?: string }) => void;
    delete: (id: string) => void;
  };
  helpers: {
    getProgress: (tripId: string) => number;
    getCategories: (tripId: string) => Category[];
    getItems: (categoryId: string) => PackingItem[];
  };
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initializeState);

  // Load state from localStorage on mount
  useEffect(() => {
    const stored = loadState();
    if (stored) {
      setState(stored);
    }
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeUser = state.users.find((u) => u.id === state.activeUserId);

  const userActions = {
    add: (name: string) => {
      const user = addUser(name);
      setState((prev) => ({ ...prev, activeUserId: user.id }));
    },
    update: (id: string, updates: Partial<User>) => {
      updateUser(id, updates);
      setState((prev) => ({
        ...prev,
        users: prev.users.map((u) => (u.id === id ? { ...u, ...updates } : u)),
      }));
    },
    delete: (id: string) => {
      deleteUser(id);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    switch: (userId: string) => {
      switchUser(userId);
      setState((prev) => ({ ...prev, activeUserId: userId }));
    },
  };

  const tripActions = {
    create: (data: Omit<Trip, "id" | "userId" | "archived" | "createdAt" | "updatedAt">) => {
      const trip = createTrip(state.activeUserId, data);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
      return trip;
    },
    update: (id: string, data: Partial<Trip>) => {
      updateTrip(id, data);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    archive: (id: string, archived: boolean) => {
      archiveTrip(id, archived);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    delete: (id: string) => {
      deleteTrip(id);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
  };

  const categoryActions = {
    create: (tripId: string, name: string, icon: string) => {
      createCategory(tripId, name, icon);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    update: (id: string, data: { name?: string; icon?: string }) => {
      updateCategory(id, data);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    delete: (id: string) => {
      deleteCategory(id);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
  };

  const itemActions = {
    create: (tripId: string, categoryId: string, name: string, icon: string, quantity: number) => {
      createItem(tripId, categoryId, name, icon, quantity);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    update: (id: string, data: { name?: string; quantity?: number; checked?: boolean; icon?: string }) => {
      updateItem(id, data);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
    delete: (id: string) => {
      deleteItem(id);
      setState((prev) => {
        const newState = loadState();
        return newState ?? prev;
      });
    },
  };

  const helpers = {
    getProgress: (tripId: string) => {
      return getItemProgress(tripId, state.items);
    },
    getCategories: (tripId: string) => {
      return getCategoriesForTrip(tripId, state.categories);
    },
    getItems: (categoryId: string) => {
      return getItemsForCategory(categoryId, state.items);
    },
  };

  return (
    <AppContext.Provider
      value={{
        state,
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
