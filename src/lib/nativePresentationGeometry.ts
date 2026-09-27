/*
 * Geometry handoff between the web trip page and the native screens plugin.
 *
 * WHY THIS EXISTS
 *
 * The native itinerary/packing screens used to be presented as full-screen
 * modal sheets. The complaint was that the sheet covers the whole page --
 * including the web header, the trip name, the dates, and the tab bar -- so
 * switching tabs means dismissing to the dashboard and navigating back. It
 * reads as a window over the app rather than a tab belonging to it.
 *
 * The fix is to present the native content INSIDE the page, in the region the
 * web tab panel already occupies, leaving the header and tab bar visible and
 * tappable. For that, native needs to know WHERE that region is, in screen
 * coordinates, at the moment of presentation.
 *
 * WHY THE TAB PANEL AND NOT THE HEADER
 *
 * Measuring the header and tab bar and insetting below them looks equivalent
 * and is much worse: their heights come from responsive Tailwind classes
 * (`py-3 sm:py-4`, `text-xl`), so the inset would have to be hardcoded and
 * would drift on other devices, in landscape, and under Dynamic Type.
 *
 * The tab panel is already exactly the content region -- everything above it
 * is the chrome we want to keep. So one element is measured instead of two,
 * and the padding classes never enter the calculation.
 *
 * WHY PURE FUNCTIONS
 *
 * There is no DOM test harness in this project, so anything that reads
 * `getBoundingClientRect` directly is untestable. The reading happens in the
 * component; the arithmetic and the validity rules live here, where the test
 * suite can pin them.
 */

/**
 * A rectangle in CSS pixels, relative to the viewport.
 *
 * Not converted to device pixels here. Capacitor's plugin bridge takes points
 * (which is what UIKit's `frame` uses) and `getBoundingClientRect` also
 * reports CSS pixels, which map 1:1 to points on iOS. Converting would be a
 * scale-by-`devicePixelRatio` bug: the result would be a frame correct on a
 * 1x display and off by 3x on the phone this ships to.
 */
export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Inset from the top of the screen for the status bar and any notch. */
export type SafeArea = {
  top: number;
  bottom: number;
};

export type PresentationGeometry = Rect & {
  safeArea: SafeArea;
};

/**
 * The minimum height worth presenting into.
 *
 * A region shorter than this is not a screen, it is a layout accident -- the
 * page mid-load, a keyboard pushing the viewport, or a rotated device with the
 * chrome taking most of the height. Presenting into it produces a native screen
 * a few pixels tall with no way to dismiss, which is worse than not presenting
 * at all: `/native-present-region-too-small/` reasons are recoverable, a
 * collapsed presentation is not.
 */
export const MIN_PRESENTABLE_HEIGHT = 200;

/**
 * Is this rectangle usable as a presentation region?
 *
 * Returns a reason string rather than a bare boolean so the caller can report
 * why it declined. A silent false here means the native screen never appears
 * and nothing anywhere says why, which is the failure mode this guards against.
 */
export function presentRegionRejection(rect: Rect | null | undefined): string | null {
  if (!rect) return "no-element";

  // A zero-width or zero-height rect is what a hidden or not-yet-laid-out
  // element reports. Both are "not ready", not "no space".
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return "not-finite";
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.left)) return "not-finite";

  if (rect.width <= 0) return "zero-width";
  if (rect.height <= 0) return "zero-height";

  // The panel scrolled fully out of view. Presenting now would put the native
  // screen where the user cannot see it.
  if (rect.top + rect.height <= 0) return "scrolled-out";

  if (rect.height < MIN_PRESENTABLE_HEIGHT) return "too-small";

  return null;
}

/**
 * Build the geometry payload, or null when the region is not usable.
 *
 * `safeArea` is passed through unchanged: it is inset information for the
 * native side to honour if it needs to, not something this layer clamps.
 */
export function buildPresentationGeometry(
  rect: Rect | null | undefined,
  safeArea: SafeArea,
): PresentationGeometry | null {
  if (presentRegionRejection(rect) !== null) return null;
  const r = rect as Rect;
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    safeArea,
  };
}

/**
 * Round to whole points.
 *
 * `getBoundingClientRect` returns fractional pixels. UIKit will accept them,
 * but a fractional frame origin produces a half-pixel seam between the web
 * chrome and the native view -- visible as a 1px line of the page background
 * at certain scroll positions. Rounding removes the seam and costs at most half
 * a point of alignment.
 */
export function roundGeometry(g: PresentationGeometry): PresentationGeometry {
  return {
    top: Math.round(g.top),
    left: Math.round(g.left),
    width: Math.round(g.width),
    height: Math.round(g.height),
    safeArea: {
      top: Math.round(g.safeArea.top),
      bottom: Math.round(g.safeArea.bottom),
    },
  };
}
