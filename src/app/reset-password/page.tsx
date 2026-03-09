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
    setMessage("Password updated. You’re signed in.");

    // Take them back into the app
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[var(--paper)]">
      <div className="mx-auto w-full max-w-[520px] px-4 py-6 sm:px-6 sm:py-10">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-4 shadow-[var(--shadow)] sm:p-6">
          <div className="text-xs tracking-[0.22em] text-[var(--muted)]">
            SET NEW PASSWORD
          </div>
          <h1 className="mt-2 text-xl font-semibold text-[var(--ink)]">
            Reciprocity
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Choose a new password for your account.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-[var(--ink)]">
              New password
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[rgba(11,59,46,.25)]"
                autoComplete="new-password"
              />
            </label>

            <label className="block text-sm font-medium text-[var(--ink)]">
              Confirm password
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                placeholder="••••••••"
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[rgba(11,59,46,.25)]"
                autoComplete="new-password"
              />
            </label>

            <button
              type="submit"
              disabled={status === "saving"}
              className="w-full rounded-full bg-[var(--pine)] px-4 py-3 text-sm font-medium text-[var(--paper)] shadow-[0_10px_26px_rgba(0,0,0,.18)] transition hover:-translate-y-[1px] disabled:opacity-60"
            >
              {status === "saving" ? "Saving…" : "Update password"}
            </button>

            {message ? (
              <div className="text-sm text-[var(--muted)]">{message}</div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}