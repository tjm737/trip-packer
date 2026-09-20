import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/AppContext";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TripPlanner — Plan Smarter, Stress Less",
  description: "Plan your trips and pack efficiently with organized checklists",
  // Installed to the iPhone home screen, this runs standalone rather than in
  // Safari chrome, which is what makes it feel like a native app.
  appleWebApp: {
    capable: true,
    title: "TripPlanner",
    statusBarStyle: "black-translucent",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    // iOS ignores SVG and the manifest for the home screen, so it needs an
    // explicit apple-touch-icon. The PNGs cover Android and desktop installs.
    apple: "/icons/apple-touch-icon.png",
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

// Without `width=device-width` iOS lays the page out at a 980px virtual
// viewport and scales it down to fit, so everything renders tiny and the
// responsive breakpoints never fire. `viewport-fit=cover` extends under the
// notch/Dynamic Island, paired with the safe-area padding in MobileNav.
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
          <TooltipProvider>
            <div className="flex">
              <Sidebar />
              <div className="flex-1 min-w-0 flex flex-col">
                <MobileNav />
                {/* Above the content, below the nav — never covers the itinerary. */}
                <OfflineBanner />
                <main className="flex-1 min-w-0">{children}</main>
              </div>
            </div>
          </TooltipProvider>
          <ServiceWorkerRegistrar />
        </AppProvider>
      </body>
    </html>
  );
}
