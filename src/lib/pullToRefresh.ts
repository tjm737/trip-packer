/*
 * Pull-to-refresh gesture logic.
 *
 * Pure functions only. The component that uses these has no useful test surface
 * -- it is event handlers over a DOM -- so every decision worth asserting on
 * lives here instead. What is worth asserting on is exactly the set of cases
 * that make a hand-rolled pull-to-refresh feel broken:
 *
 *   - It fires while the page is scrolled down, yanking the user back to the top.
 *   - It fires when the user is scrolling UP, so ordinary reading triggers it.
 *   - It fires during a pinch, because a second finger joined the gesture.
 *   - It latches mid-drag and then, on release, refreshes after all.
 *
 * None of those are visible in a screenshot, and all of them are one comparison
 * away from being correct.
 */

/** Where the pull is in its lifecycle. */
export type PullPhase = "idle" | "pulling" | "armed" | "refreshing";

/**
 * Distance in px the user must pull before releasing triggers a refresh.
 *
 * Chosen against the platform feel rather than by taste: iOS Safari's own
 * control arms at roughly this distance, and a shorter threshold makes the
 * gesture fire on an incidental overscroll at the top of the list.
 */
export const PULL_THRESHOLD = 72;

/**
 * Hard cap on how far the indicator can be dragged.
 *
 * Without this the progress ring stalls at 100% and then the page keeps
 * travelling for the rest of the drag, which reads as the gesture having hung.
 * Resisted growth past the threshold keeps it responsive instead.
 */
export const PULL_MAX = 110;

/**
 * Movement in px below which a touch is not treated as a pull at all.
 *
 * A tap or a two-pixel wobble while pressing a row must not start a gesture.
 */
export const PULL_DEAD_ZONE = 8;

/**
 * Applies rubber-band resistance so the indicator tracks the finger but slows
 * as it approaches the cap. Linear tracking feels mechanical and, worse, makes
 * the cap arrive abruptly.
 */
export function resistPull(distance: number): number {
  if (distance <= 0) return 0;
  if (distance <= PULL_THRESHOLD) return distance;
  // Everything past the threshold is damped to a third, then capped.
  const overshoot = distance - PULL_THRESHOLD;
  return Math.min(PULL_THRESHOLD + overshoot / 3, PULL_MAX);
}

/** Progress in 0..1 for the indicator ring, saturating at the threshold. */
export function pullProgress(distance: number): number {
  if (distance <= 0) return 0;
  return Math.min(distance / PULL_THRESHOLD, 1);
}

/**
 * Whether a pull should be allowed to begin.
 *
 * `scrollTop` is checked on every move rather than only at touchstart, because
 * the user can start a gesture at scrollTop 0 and then scroll the list down
 * mid-gesture; the pull must stop being tracked at that point instead of
 * continuing to accumulate distance from an already-scrolled position.
 */
export function canStartPull(input: {
  /** Vertical scroll offset of the scrolling element. */
  scrollTop: number;
  /** Horizontal offset, to distinguish a pull from a horizontal swipe. */
  scrollLeft: number;
  /** How many fingers are down. */
  touches: number;
  /** Whether a refresh is already running. */
  refreshing: boolean;
}): boolean {
  // Any scroll offset means the user is not at the top, so there is nothing to
  // pull. A small tolerance absorbs sub-pixel offsets and rubber-band bounce.
  if (input.scrollTop > 1) return false;
  // A horizontal swipe starting at the top must not be read as a pull.
  if (Math.abs(input.scrollLeft) > 1) return false;
  // A second finger means pinch-zoom or a system gesture, not a refresh.
  if (input.touches > 1) return false;
  // Re-entrancy guard: a second pull while one is running would double-fire.
  if (input.refreshing) return false;
  return true;
}

/**
 * Whether the current drag has pulled far enough that releasing will refresh.
 *
 * Crossing this during the drag is what turns the indicator from "keep pulling"
 * into "let go", so the user knows before they lift their finger.
 */
export function isArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/**
 * The phase to render for a given drag distance and refresh state.
 *
 * Single source of truth for the indicator, so the label and the spinner can
 * never disagree about what is happening.
 */
export function phaseFor(distance: number, refreshing: boolean): PullPhase {
  if (refreshing) return "refreshing";
  if (distance <= 0) return "idle";
  return isArmed(distance) ? "armed" : "pulling";
}

/**
 * Whether the touch sequence has committed to pulling.
 *
 * A gesture is only a pull once it has moved past the dead zone AND the
 * component has decided to track it. Tracking is latched on the first move that
 * qualifies and released on touchend, which is what stops a gesture that began
 * as a pull from being abandoned halfway and then firing anyway.
 */
export function shouldBeginPull(input: {
  /** Absolute vertical movement since touchstart, in px. */
  dy: number;
  /** Absolute horizontal movement since touchstart, in px. */
  dx: number;
  /** Whether this component already took ownership of the gesture. */
  tracking: boolean;
  /** Whether the gesture is even eligible (see canStartPull). */
  eligible: boolean;
}): boolean {
  if (input.tracking) return true;
  if (!input.eligible) return false;
  // Vertical intent must dominate: a mostly-horizontal move is a swipe.
  if (input.dy <= PULL_DEAD_ZONE) return false;
  return input.dy > Math.abs(input.dx);
}

/** Copy for the indicator label, keyed by phase. */
export function pullLabel(phase: PullPhase): string {
  switch (phase) {
    case "pulling":
      return "Pull to refresh";
    case "armed":
      return "Release to refresh";
    case "refreshing":
      return "Refreshing…";
    case "idle":
    default:
      return "";
  }
}

/** How long the result message stays on screen after a refresh settles, in ms. */
export const RESULT_DWELL_MS = 1200;
