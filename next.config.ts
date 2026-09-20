import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Next.js blocks dev-only requests (/_next chunks, HMR) when the browser's
   * Origin/Referer host is not allowlisted — see
   * next/dist/server/lib/router-utils/block-cross-site-dev.js. Only localhost
   * variants are allowed by default, so opening the dev server from a phone on
   * the LAN (http://192.168.0.234:4000) got 403s on the client chunks.
   *
   * The symptom is nasty because it does not look like an error: the server
   * renders the shell normally, so the page *appears* to load, but hydration
   * never runs. Every button is dead and no data is fetched, because React
   * never attached to the DOM.
   *
   * Listed explicitly rather than with a wildcard so the LAN host is the only
   * thing trusted here. Only affects `next dev`; production is unaffected.
   */
  allowedDevOrigins: ["192.168.0.234"],
};

export default nextConfig;
