"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export default function ForgotPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

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
    <div className="min-h-[calc(100vh-56px)] bg-[var(--paper)]">
      <div className="mx-auto w-full max-w-[520px] px-6 py-10">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-[var(--shadow)]">
          <div className="text-xs tracking-[0.22em] text-[var(--muted)]">
            RESET PASSWORD
          </div>
          <h1 className="mt-2 text-xl font-semibold text-[var(--ink)]">
            Reciprocity
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Enter your email and we’ll send a reset link.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-[var(--ink)]">
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@club.com"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[rgba(11,59,46,.25)]"
                autoComplete="email"
              />
            </label>

            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-full bg-[var(--pine)] px-4 py-3 text-sm font-medium text-[var(--paper)] shadow-[0_10px_26px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] disabled:opacity-60"
            >
              {status === "sending" ? "Sending…" : "Send reset link"}
            </button>

            {message ? (
              <div className="text-sm text-[var(--muted)]">{message}</div>
            ) : null}
          </form>

          <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
            <Link
              href="/login"
              className="underline underline-offset-4 hover:opacity-80"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}