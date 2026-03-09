"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

export default function ExchangePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const next = searchParams.get("next") || "/";

    if (!code) {
      router.replace(next);
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          setError(error.message);
          return;
        }
        router.replace(next);
      })
      .catch((e) => {
        setError(e?.message ?? "Failed to exchange code");
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--paper)]">
        <div className="text-center">
          <div className="text-sm text-red-600">{error}</div>
          <a href="/forgot-password" className="mt-2 block text-sm text-[var(--muted)] underline">
            Request a new reset link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--paper)]">
      <div className="text-sm text-[var(--muted)]">Verifying...</div>
    </div>
  );
}
