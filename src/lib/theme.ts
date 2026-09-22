/*
 * Theme: the single source of truth.
 *
 * Why this is its own module rather than three loose string literals.
 *
 * The theme has to be known in four separate places that cannot import from
 * each other:
 *
 *   1. an inline `<script>` in the root layout, which runs before React exists
 *      and before the first paint;
 *   2. the client toggle component;
 *   3. the SQLite persistence path, as the accepted column value;
 *   4. the Leaflet basemap picker, which swaps tile URLs.
 *
 * A typo in any one of them produces a silent failure — the classic being a
 * toggle that writes "light" while the bootstrap script tests for "Light", so
 * the choice sticks in the database but the app never changes appearance, and
 * nothing errors anywhere. Keeping the literals here means the compiler catches
 * that class of bug instead of the user.
 *
 * `THEME_STORAGE_KEY` is a localStorage key, NOT the SQLite column. Both exist
 * on purpose: localStorage lets the inline script resolve the theme
 * synchronously before paint (no flash), while the database makes the choice
 * follow the user across devices and survive a cleared cache. The database
 * value wins once it arrives; see AppContext for the reconciliation.
 */

export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

/** Dark is the unmarked default: it is what the app has always looked like. */
export const DEFAULT_THEME: Theme = "dark";

/** localStorage key, read by the pre-paint inline script in layout.tsx. */
export const THEME_STORAGE_KEY = "tripplanner.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Coerce anything (DB value, localStorage value, query param) to a theme. */
export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/**
 * The class applied to `document.documentElement`.
 *
 * Dark is expressed as BOTH `dark` and the absence of `light`, because the
 * shadcn primitives carry `dark:` utilities that must be active in dark mode and
 * the hand-written `.light` overrides in globals.css must not be. Writing `dark`
 * explicitly (rather than removing both classes for the default) also gives the
 * `@variant dark` rule something to match, which is what makes those primitives
 * follow the theme at all.
 */
export function themeClassName(theme: Theme): string {
  return theme === "light" ? "light" : "dark";
}

/**
 * Applies the theme to the document.
 *
 * `colorScheme` is set on the element as well as in CSS so the browser's own
 * chrome follows: scrollbars, form control defaults, and — on iOS, where this
 * ships as a Capacitor app — the status bar text colour. Without it a light
 * theme keeps dark scrollbars and an unreadable status bar over the safe area.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(themeClassName(theme));
  root.style.colorScheme = theme;
}
