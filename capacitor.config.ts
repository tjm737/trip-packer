import type { CapacitorConfig } from "@capacitor/cli";

/*
 * Hosted-shell configuration.
 *
 * The app is served from a real origin (the Next.js server) rather than from
 * bundled files, because this codebase is not a static site: /trips/[id] is a
 * dynamic route and every write goes through /api/mutate. A static export has
 * neither, so pointing the WebView at the live origin is the only way to run
 * the existing app on a device without first rewriting its routing and
 * transport.
 *
 * TRIP_PACKER_URL comes from the environment so the same config works against
 * a laptop during development and the deployed host afterwards, with no edit
 * to this file.
 *
 * The default is PRODUCTION, not localhost, and that is deliberate. Capacitor
 * writes the resolved URL into ios/App/App/capacitor.config.json, a generated
 * file that is gitignored -- so it is not under version control and every
 * `npx cap sync ios` rewrites it from this expression. When localhost was the
 * default, a sync silently pointed a device build back at a laptop that was not
 * in the room: the WebView loads nothing, the app shows its empty state, and
 * there is no error anywhere to explain why. A default that fails loudly for
 * the simulator (you notice immediately and pass TRIP_PACKER_URL) is strictly
 * better than one that fails silently on hardware.
 *
 * To develop against a local server, opt in explicitly:
 *   TRIP_PACKER_URL=http://localhost:4000 npx cap sync ios
 *
 * Do not use 127.0.0.1 for the simulator. The dev server binds a dual-stack
 * socket that is IPv6-first, and the WebView's IPv4 resolution of 127.0.0.1
 * lands nowhere -- the same silent-empty-state failure described above.
 * `localhost` resolves through to the listener and works.
 *
 * On a physical device `localhost` means the phone itself, so there is no LAN
 * address to fall back to either -- use the deployed origin, or the Mac's LAN
 * address via TRIP_PACKER_URL during bring-up.
 *
 * The ATS block in ios/App/App/Info.plist keeps only the localhost/127.0.0.1
 * exceptions needed to develop against a plain-http dev server. The LAN-IP
 * exception that used to live there is gone -- it was a bring-up scaffold, and
 * leaving it in would have shipped a build that silently permitted cleartext
 * to a stale address on someone else's network. Since production is HTTPS,
 * `cleartext` below evaluates to false and no exemption is needed.
 */
const PRODUCTION_URL = "https://trips.planetracker.app";
const serverUrl = process.env.TRIP_PACKER_URL ?? PRODUCTION_URL;

const config: CapacitorConfig = {
  appId: "com.tylermorgan.tripplanner",
  appName: "TripPlanner",
  webDir: "public",

  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },

  ios: {
    contentInset: "always",
    backgroundColor: "#09090b",
  },
};

export default config;
