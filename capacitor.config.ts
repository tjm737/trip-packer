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
 * The default is localhost, which is right for the simulator: it shares the
 * host's network stack, so localhost resolves to the Mac running `next dev`.
 * Do not change this to 127.0.0.1. The dev server binds a dual-stack socket
 * that is IPv6-first, and the WebView's IPv4 resolution of 127.0.0.1 lands
 * nowhere — the app then renders its empty state with no error and no
 * connection to the server, which reads exactly like a data bug. localhost
 * resolves through to the listener and works.
 *
 * A physical device is a different story — localhost there means the phone
 * itself, so set TRIP_PACKER_URL to the Mac's LAN address before running on
 * hardware.
 *
 * cleartext is enabled only so a plain-http dev host works during bring-up. A
 * deployed host is HTTPS and does not need it — see the ATS note in
 * ios/App/App/Info.plist.
 */
const serverUrl = process.env.TRIP_PACKER_URL ?? "http://127.0.0.1:4000";

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
