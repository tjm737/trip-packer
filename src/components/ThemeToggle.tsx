"use client";

import { useCallback, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useApp } from "@/lib/AppContext";
import {
  applyTheme,
  normalizeTheme,
  themeClassName,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme";

/*
 * Theme toggle, for the sidebar footer beside "New Trip".
 *
 * Scope: it changes the CURRENT USER's theme. A signed-out visitor has no row
 * to write to, so the choice is held in localStorage only and follows the
 * device. That is the same best-effort model the pre-paint script uses, and it
 * means the toggle is always usable rather than disabled for guests.
 *
 * The local `theme` state is the source of truth for rendering, not the user
 * record. Reading it from `activeUser.theme` alone would make the button feel
 * broken on a signed-out device (no user, so no value to toggle) and would lag
 * a frame behind while the optimistic update settles. localStorage is read once
 * on mount — deliberately in an effect rather than in the initial render,
 * because the server has no localStorage and rendering from it during the first
 * pass would produce a hydration mismatch.
 */
export function ThemeToggle() {
  const { activeUser, user } = useApp();
  const [theme, setTheme] = useState<Theme>("dark");

  /*
   * Adopt whatever the pre-paint script already resolved.
   *
   * The script has run by now, so the class on <html> is authoritative for what
   * the user is currently looking at. Reading the class (rather than
   * localStorage again) guarantees the button's label matches the visible
   * theme even if the two somehow diverged — the button must never describe a
   * state the page is not in.
   */
  useEffect(() => {
    const root = document.documentElement;
    setTheme(root.classList.contains(themeClassName("light")) ? "light" : "dark");
  }, []);

  /*
   * Reconcile with the stored user preference once the record is available.
   *
   * A signed-in user's database value wins over the device cache, which is what
   * makes the setting follow them to a new device. This runs when the user id or
   * their stored theme changes, so a value arriving late (after the initial
   * fetch) still lands. Skipping it when the two already agree avoids a
   * pointless re-render on every state poll.
   */
  useEffect(() => {
    if (!activeUser) return;
    const stored = normalizeTheme(activeUser.theme);
    setTheme((current) => (current === stored ? current : stored));
  }, [activeUser, activeUser?.theme]);

  // Keep the document in step with local state, so every change path (toggle,
  // late-arriving preference) updates the page without each caller remembering
  // to call applyTheme.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(async () => {
    const next: Theme = theme === "dark" ? "light" : "dark";

    // Optimistic: paint immediately. The theme is a local visual preference and
    // waiting on a round-trip would leave the button feeling unresponsive.
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode or storage disabled. The theme still applies for this
      // session; it just will not survive a reload. Not worth surfacing.
    }

    if (!activeUser) return;
    try {
      await user.update(activeUser.id, { theme: next });
    } catch {
      /*
       * Persisting failed (offline, or a 403 for a viewer toggling their own
       * preference in some future policy). Deliberately NOT reverting the visual
       * change: the user asked for light, the page delivered light, and it is
       * still in localStorage. Snapping back would be the more confusing
       * outcome. The mutation layer surfaces its own error toast.
       */
    }
  }, [theme, activeUser, user]);

  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      // Toggling theme is not a navigation or an action worth closing the
      // drawer for — the user stays put and wants to see the result.
      data-keep-drawer-open
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-ring"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
