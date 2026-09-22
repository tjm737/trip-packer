import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/AppContext";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

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
    statusBarStyle: "black-translucent",
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
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <ServiceWorkerRegistrar />
        </AppProvider>
      </body>
    </html>
  );
}
