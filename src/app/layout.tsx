import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";

export const metadata = {
  title: "Reciprocity",
  description: "Private club competition, refined.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}