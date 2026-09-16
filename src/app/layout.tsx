import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/AppContext";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TripPacker — Pack Smarter, Stress Less",
  description: "Plan your trips and pack efficiently with organized checklists",
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
          <div className="flex">
            <Sidebar />
            <main className="flex-1 min-w-0">{children}</main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
