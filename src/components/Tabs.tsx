"use client";

import { useCallback, useId, useRef, type ReactNode } from "react";
import { cn } from "cn";

/*
 * Segmented tab bar for the trip page.
 *
 * The page used to be one long scroll of five stacked blocks; these tabs split
 * it into four views so packing and notes are one click away instead of a few
 * screens down.
 *
 * Accessibility follows the WAI-ARIA tabs pattern, which is the part worth
 * getting right: the tab list is a single stop in the tab order and the arrow
 * keys move between tabs (roving tabindex), rather than making the keyboard
 * user tab through every tab to reach the panel. Home/End jump to the ends.
 * Each panel is labelled by its tab and the tab points at its panel.
 *
 * Panels are unmounted when inactive rather than hidden with CSS. These panels
 * are live data (a Leaflet map, a geocoding fetch, a weather call) and keeping
 * them mounted would leave invisible instances holding sockets and re-rendering
 * on every state change. Unmounting means each tab rebuilds on activation,
 * which is the honest trade for not running three hidden views at once.
 */

export type TabDef = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Optional count shown after the label (stops, items, bookings). */
  badge?: ReactNode;
  content: ReactNode;
};

type Props = {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, value, onChange, className }: Props) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const panelId = (id: string) => `${baseId}-panel-${id}`;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const i = tabs.findIndex((t) => t.id === value);
      if (i === -1) return;

      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      else return;

      e.preventDefault();
      const target = tabs[next];
      onChange(target.id);
      // Move real DOM focus with the selection, or the roving tabindex would
      // leave focus behind on the tab that is no longer selected.
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabId(target.id))}`)
        ?.focus();
    },
    [tabs, value, onChange, baseId]
  );

  const current = tabs.find((t) => t.id === value) ?? tabs[0];

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Trip sections"
        onKeyDown={onKeyDown}
        className={cn(
          "flex items-stretch gap-1 overflow-x-auto",
          // The bar sits on the page background, so give it a bottom rule that
          // the active tab's underline can land on rather than floating.
          "border-b border-white/5"
        )}
      >
        {tabs.map((t) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              id={tabId(t.id)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                "focus-ring relative -mb-px flex shrink-0 items-center gap-1.5 rounded-t-md",
                "px-3 py-2.5 text-sm transition-colors sm:px-4",
                selected
                  ? "text-emerald-300"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {t.icon}
              <span className="font-medium">{t.label}</span>
              {t.badge != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] leading-none tnum",
                    selected
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-white/5 text-zinc-500"
                  )}
                >
                  {t.badge}
                </span>
              )}
              {/*
                The active indicator is a full-width underline on the bar's
                rule. Drawn as an element rather than a border so it can be
                inset and keep the emerald accent without tinting the text box.
              */}
              {selected && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-emerald-400"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        id={panelId(current.id)}
        role="tabpanel"
        aria-labelledby={tabId(current.id)}
        tabIndex={0}
        className="focus-ring pt-4 sm:pt-6"
      >
        {current.content}
      </div>
    </div>
  );
}
