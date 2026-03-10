import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { ServiceWorker } from "./components/ServiceWorker";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata = {
  title: "Reciprocity",
  description: "Private club competition, refined.",
  manifest: "/manifest.json",
  themeColor: "#0b3b2e",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent" as const,
    title: "Reciprocity",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
        <ServiceWorker />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}