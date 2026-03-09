"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    setStatus("working");
    setMessage("");

    if (!cleanEmail || !cleanPassword) {
      setStatus("error");
      setMessage("Email and password are required.");
      return;
    }

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      router.push("/");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    // Send welcome email (fire-and-forget)
    try {
      fetch("/api/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: cleanEmail }),
      });
    } catch {
      // Don't block signup if email fails
    }

    if (!data.session) {
      setStatus("idle");
      setMode("signin");
      setMessage("Account created. Check your email to confirm, then sign in.");
      return;
    }

    window.location.assign("/");
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
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {mode === "signin"
              ? "Sign in to continue to your matches."
              : "Join to start tracking your rounds."}
          </p>
        </div>

        {/* Mode toggle pill */}
        <div className="mx-auto mb-8 flex w-fit rounded-full border border-[var(--border)] bg-[var(--paper-2)] p-1">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setMessage("");
              setStatus("idle");
            }}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition-all ${
              mode === "signin"
                ? "bg-[var(--pine)] text-[var(--paper)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setMessage("");
              setStatus("idle");
            }}
            className={`rounded-full px-5 py-1.5 text-sm font-medium transition-all ${
              mode === "signup"
                ? "bg-[var(--pine)] text-[var(--paper)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            Sign up
          </button>
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
                autoComplete="email"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
                PASSWORD
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
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
              disabled={status === "working"}
              className="w-full rounded-xl bg-[var(--pine)] px-4 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
            >
              {status === "working"
                ? "Working..."
                : mode === "signin"
                ? "Sign in"
                : "Create account"}
            </button>
          </form>

          {/* Forgot password link */}
          {mode === "signin" && (
            <div className="mt-5 border-t border-[var(--border)] pt-4 text-center">
              <Link
                href="/forgot-password"
                className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
              >
                Forgot password?
              </Link>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 text-center text-xs text-[var(--muted)]">
          Private club competition, refined.
        </div>
      </div>
    </div>
  );
}
