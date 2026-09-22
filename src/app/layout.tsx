import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/AppContext";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_THEME, THEME_STORAGE_KEY, themeClassName } from "@/lib/theme";

/*
 * Root layout. Deliberately minimal.
 *
 * It holds only what every route needs regardless of who is asking: fonts, the
 * HTML shell, the providers, and the service worker. It does NOT render the
 * sidebar or mobile nav.
 *
 * Those used to live here, which wrapped every page in the app shell. A
 * logged-out visitor to "/" therefore received a rendered "New Trip" button
 * whose click opened a creation dialog and then failed at the API with a 401 —
 * the interface advertising a capability the server denies. The chrome now lives
 * in src/app/(app)/layout.tsx, applied only to the authenticated route group, so
 * a URL that is public cannot accidentally inherit a create-trip control.
 *
 * AppProvider and Toaster stay at the root rather than moving into (app),
 * because the sign-in page uses toasts and LoginDialog calls the apiUrl helper
 * from the same client data layer.
 */

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TripPlanner — Plan Smarter, Stress Less",
  description: "Plan your trips and pack efficiently with organized checklists",
  appleWebApp: {
    capable: true,
    title: "TripPlanner",
    /*
     * `black-translucent` places dark status-bar text over the app's own
     * background, so it needs a LIGHT surface behind it to be legible. It was
     * set while the app was dark-only and appears to have been inverted from
     * the start — on the current dark theme the clock and battery render dark
     * on near-black and are barely readable.
     *
     * Pinned to `default`, which lets iOS choose the status-bar content colour
     * from the page's own `color-scheme` (set in globals.css and kept in sync
     * by `applyTheme`). That is the only value that can follow an in-app theme
     * toggle, since this metadata is resolved at launch and cannot be
     * re-evaluated from a class change.
     */
    statusBarStyle: "default",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/icons/apple-touch-icon.png",
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  /*
   * Two theme colours as a media-query pair, rather than one hardcoded value.
   *
   * This drives the browser/OS chrome — the address bar on Android, and the
   * status bar area on iOS where this ships as a Capacitor app. Pinning it to
   * the dark page colour (#09090b) meant a light-theme user got a black band
   * above a white page, which is the single most visible way a theme toggle can
   * look broken on a phone.
   *
   * The `light`/`dark` media queries key off `prefers-color-scheme`, which does
   * not know about our in-app toggle. To keep them honest, `applyTheme` also
   * sets `color-scheme` on <html>, and the values below are chosen to match
   * whichever *page* colour the user will actually be looking at in that OS
   * mode. It is a best-effort match for the system setting, since a browser
   * cannot recolour its own chrome from a page class.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
    return (
      <html lang="en" className={themeClassName(DEFAULT_THEME)} suppressHydrationWarning>
        <head>
          {/*
            Pre-paint theme resolution.

            This must be an inline, synchronous script in <head>; any React-based
            approach runs after hydration and the user sees a frame of the wrong
            theme first (the "flash of unthemed content"). It reads the cached
            choice and applies the class before the browser paints anything.

            Dark is the default, so the worst case if localStorage is
            unavailable (Safari private mode, disabled storage) is the dark
            theme — the app's existing appearance. The class is still set
            explicitly rather than left to the server-rendered value, because
            the server cannot know the user's stored preference and would
            otherwise paint dark over a light choice.

            Wrapped in try/catch: in private mode even *reading* localStorage
            can throw, and an exception here would abort the rest of the head
            and leave the page unstyled. Failing into dark is fine; failing to
            parse the document is not.

            `suppressHydrationWarning` on <html> is required because this script
            mutates the element's className before React hydrates, which React
            would otherwise report as a mismatch.
          */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem(${JSON.stringify(
                THEME_STORAGE_KEY
              )});var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(t==="light"?"light":"dark");if(t==="light"){r.style.colorScheme="light";}}catch(e){}})();`,
            }}
          />
        </head>
        <body className={inter.className}>
        <AppProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <ServiceWorkerRegistrar />
        </AppProvider>
      </body>
    </html>
  );
}
