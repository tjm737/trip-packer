"use client";

import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "cn";

/**
 * Tooltip primitives.
 *
 * Thin wrappers over Base UI's tooltip so call sites don't repeat positioning
 * and styling. The popup uses the top of the surface scale (--surface-3) plus a
 * visible border, because a tooltip floats above everything else and needs to
 * stay legible over any surface beneath it.
 *
 * Usage:
 *   <Tooltip label="Remove item">
 *     <Button>...</Button>
 *   </Tooltip>
 *
 * The trigger must be a single element that forwards props/ref. Disabled
 * buttons do not fire pointer events on themselves, so wrap a disabled control
 * in a <span> inside the trigger if it needs a tooltip.
 */

function TooltipProvider({
  delay = 200,
  ...props
}: React.ComponentProps<typeof BaseTooltip.Provider>) {
  return <BaseTooltip.Provider delay={delay} {...props} />;
}

function Tooltip({
  label,
  children,
  side = "top",
  sideOffset = 6,
  className,
  disabled = false,
}: {
  /** Text to show. Pass null/undefined to render children with no tooltip. */
  label?: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
  /** Skip the tooltip entirely (e.g. while a control is hidden or redundant). */
  disabled?: boolean;
}) {
  if (disabled || !label) return <>{children}</>;

  // Render the tooltip on the child element itself.
  //
  // Base UI's `render` prop accepts a ReactElement and merges the trigger's
  // props into it (pointer/focus handlers + aria-describedby). Passing the
  // element here is the supported form -- wrapping it in a function and
  // cloneElement-ing by hand caused Base UI to additionally emit its own
  // <button>, producing nested <button> (a hydration error).
  //
  // The child must be a single element that forwards props to a real DOM node.
  // `<button>` and the shadcn Button both satisfy this.
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children as React.ReactElement} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset}>
          <BaseTooltip.Popup
            role="tooltip"
            className={cn(
              "z-50 max-w-xs rounded-lg border border-zinc-700/80 px-2.5 py-1.5",
              "text-xs font-medium text-zinc-100 shadow-lg shadow-black/50",
              "origin-[var(--transform-origin)] transition-[transform,opacity]",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              className
            )}
            style={{ backgroundColor: "var(--surface-3)" }}
          >
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export { Tooltip, TooltipProvider };
