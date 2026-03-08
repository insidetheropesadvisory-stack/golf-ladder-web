import "./globals.css";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { createSupabaseServerClient } from "../lib/supabase/server";

export const metadata = {
  title: "Reciprocity",
  description: "Private club competition, refined.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const userEmail = error ? null : user?.email ?? null;

  return (
    <html lang="en">
      <body>
        <AppShell userEmail={userEmail}>{children}</AppShell>
      </body>
    </html>
  );
}