"use client";

import Link from "next/link";
import { useState } from "react";
import { supabase } from "../../lib/supabase/supabase";

export default function LoginPage() {
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

      window.location.assign("/");
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

    if (!data.session) {
      setStatus("idle");
      setMode("signin");
      setMessage("Account created. Check your email to confirm, then sign in.");
      return;
    }

    window.location.assign("/");
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--paper)]">
      <div className="mx-auto w-full max-w-[520px] px-6 py-10">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-[var(--shadow)]">
          <div className="text-xs tracking-[0.22em] text-[var(--muted)]">
            {mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
          </div>

          <h1 className="mt-2 text-xl font-semibold text-[var(--ink)]">
            Reciprocity
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {mode === "signin"
              ? "Sign in with your email and password."
              : "Create an account with email and password."}
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

            <label className="block text-sm font-medium text-[var(--ink)]">
              Password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[rgba(11,59,46,.25)]"
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
              />
            </label>

            <button
              type="submit"
              disabled={status === "working"}
              className="w-full rounded-full bg-[var(--pine)] px-4 py-3 text-sm font-medium text-[var(--paper)] shadow-[0_10px_26px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] disabled:opacity-60"
            >
              {status === "working"
                ? "Working…"
                : mode === "signin"
                ? "Sign in"
                : "Create account"}
            </button>

            {message ? (
              <div className="text-sm text-[var(--muted)]">{message}</div>
            ) : null}

            {mode === "signin" ? (
              <div className="pt-1 text-right">
                <Link
                  href="/forgot-password"
                  className="text-sm text-[var(--muted)] underline underline-offset-4 hover:opacity-80"
                >
                  Forgot password?
                </Link>
              </div>
            ) : null}
          </form>

          <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted)]">
            {mode === "signin" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setMessage("");
                  setStatus("idle");
                }}
                className="underline underline-offset-4 hover:opacity-80"
              >
                Need an account? Create one
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setMessage("");
                  setStatus("idle");
                }}
                className="underline underline-offset-4 hover:opacity-80"
              >
                Already have an account? Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}