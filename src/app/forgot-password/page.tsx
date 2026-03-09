"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/supabase";

export default function ForgotPasswordPage() {

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;

    setStatus("sending");
    setMessage("");

    const origin = window.location.origin;
    const redirectTo = `${origin}/auth/callback/complete?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo,
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
    setMessage("Password reset email sent. Check your inbox.");
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
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Enter your email and we&apos;ll send a reset link.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-[0_4px_24px_rgba(0,0,0,.06)] sm:p-8">
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
                EMAIL
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@club.com"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
                autoComplete="email"
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
              disabled={status === "sending"}
              className="w-full rounded-xl bg-[var(--pine)] px-4 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
            >
              {status === "sending" ? "Sending..." : "Send reset link"}
            </button>
          </form>

          <div className="mt-5 border-t border-[var(--border)] pt-4 text-center">
            <Link
              href="/login"
              className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Back to sign in
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-[var(--muted)]">
          Private club competition, refined.
        </div>
      </div>
    </div>
  );
}
