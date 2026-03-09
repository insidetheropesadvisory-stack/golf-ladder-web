"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const p = password;
    const c = confirm;

    setMessage("");

    if (p.length < 8) {
      setStatus("error");
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (p !== c) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("saving");

    // Ensure we actually have a session (the callback route should have created one)
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setStatus("error");
      setMessage("Reset link is invalid or expired. Please request a new one.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: p });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("done");
    setMessage("Password updated. You're signed in.");

    // Take them back into the app
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-[420px]">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="text-[11px] tracking-[0.32em] text-[var(--muted)]">
            RECIPROCITY
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--ink)]">
            Set new password
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Choose a new password for your account.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-[0_4px_24px_rgba(0,0,0,.06)] sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
                NEW PASSWORD
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="block text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
                CONFIRM PASSWORD
              </label>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                autoComplete="new-password"
              />
            </div>

            {message ? (
              <div
                className={
                  status === "error"
                    ? "rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
                    : "rounded-xl bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)]"
                }
              >
                {message}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={status === "saving"}
              className="w-full rounded-xl bg-[var(--pine)] px-4 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
            >
              {status === "saving" ? "Saving..." : "Update password"}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-[var(--muted)]">
          Private club competition, refined.
        </div>
      </div>
    </div>
  );
}
