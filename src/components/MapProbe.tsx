"use client";

import { useEffect, useState } from "react";

/*
 * Publishes what Leaflet actually rendered, for the iOS UI test to read.
 *
 * Why this exists: the map is Leaflet inside a WKWebView, and neither of the
 * obvious ways to check it works.
 *
 *   - A screenshot cannot tell "tiles drawn" from "grey rectangle left behind",
 *     and the vision model has misjudged this specific case more than once.
 *   - XCUITest cannot evaluate JavaScript in a WKWebView, so a test cannot just
 *     ask `document.querySelectorAll` itself.
 *
 * So the page reports on itself. The counts come from the live DOM -- and
 * `leaflet-tile-loaded` is the meaningful one, because Leaflet only applies that
 * class after the image has actually decoded. A count of <img> tags would prove
 * nothing; a count of decoded tiles proves the map is really drawing.
 *
 * Rendered as real text rather than an aria-label on an empty node, because
 * XCUITest reads static text reliably and empty nodes inconsistently.
 *
 * Invisible to the eye but present in the accessibility tree: 1px, transparent
 * text, no pointer events. It does not affect layout.
 */
export function MapProbe({
  paneExists,
  tiles,
  loaded,
  errored,
  pins,
}: {
  paneExists: boolean;
  tiles: number;
  loaded: number;
  errored: number;
  pins: number;
}) {
  /*
   * Only mount in the iOS shell. The probe is test scaffolding and has no place
   * in a browser, where the regression tests already cover the map.
   */
  const [isApp, setIsApp] = useState(false);
  useEffect(() => {
    // Capacitor injects this global; absent in a plain browser.
    setIsApp(typeof window !== "undefined" && "Capacitor" in window);
  }, []);
  if (!isApp) return null;

  const report = `MAPPROBE tiles=${tiles} loaded=${loaded} errored=${errored} pins=${pins} pane=${paneExists ? 1 : 0}`;

  return (
    <span
      aria-hidden={false}
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
        fontSize: 1,
      }}
    >
      {report}
    </span>
  );
}
