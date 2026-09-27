/*
 * Sidebar section collapse state.
 *
 * Which sidebar sections are expanded, and how that survives a reload.
 *
 * Kept out of the components because the interesting parts are the defaults and
 * the merge with persisted state, neither of which needs a DOM -- and this
 * project has no React test infrastructure, so anything worth testing has to be
 * a pure function.
 *
 * Persisted to localStorage rather than component state. A collapsed section
 * that springs back open on every navigation is worse than no control at all:
 * the user has to re-collapse it on each page load, against a sidebar that
 * exists precisely to be low-maintenance. Same reasoning as the theme toggle,
 * which is the existing precedent for a persisted UI preference.
 */

export type SectionKey = "accounts" | "companions" | "upcoming" | "archived";

/**
 * The sections and their state when nothing has been persisted.
 *
 * Accounts and companions start EXPANDED, matching today's always-visible
 * behaviour -- adding a control should not silently change the default view for
 * everyone who never touches it. Archived starts collapsed: it is reference
 * material, not something to scan past on the way to a live trip.
 */
export const DEFAULT_EXPANDED: Record<SectionKey, boolean> = {
  accounts: true,
  companions: true,
  upcoming: true,
  archived: false,
};

const STORAGE_KEY = "tp.sidebar.sections.v1";

/** Narrow an arbitrary parsed value to the shape we expect. */
export function normalizeExpanded(raw: unknown): Record<SectionKey, boolean> {
  const out: Record<SectionKey, boolean> = { ...DEFAULT_EXPANDED };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULT_EXPANDED) as SectionKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    // Only a real boolean counts. Anything else (missing, null, a string) falls
    // back to the default rather than being coerced -- a half-written entry
    // should not collapse a section by accident.
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

export function toggleSection(
  current: Record<SectionKey, boolean>,
  key: SectionKey
): Record<SectionKey, boolean> {
  return { ...current, [key]: !current[key] };
}

export function readExpanded(): Record<SectionKey, boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_EXPANDED };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPANDED };
    return normalizeExpanded(JSON.parse(raw));
  } catch {
    // Corrupt or unparseable: fall back to defaults rather than throwing inside
    // a render path.
    return { ...DEFAULT_EXPANDED };
  }
}

export function writeExpanded(value: Record<SectionKey, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked. Collapse state is a convenience, so
    // failing to persist it must not break the sidebar.
  }
}
