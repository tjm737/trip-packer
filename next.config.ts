import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /*
   * Pin the build root to this directory.
   *
   * Turbopack infers the root by walking upwards looking for a lockfile, and
   * /Users/tylermorgan is itself a git repo with its own package-lock.json.
   * Without this, every build warns:
   *
   *   ⚠ Next.js ignored package-lock.json in /Users/tylermorgan because it is
   *     outside the current Git repository
   *
   * and root inference can otherwise pick up the parent's files. Resolving
   * against __dirname keeps this correct regardless of the checkout location or
   * the cwd the build is invoked from. The parent directory is left untouched:
   * its lockfile is real, just not this project's.
   */
  turbopack: {
    root: path.resolve(__dirname),
  },

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
