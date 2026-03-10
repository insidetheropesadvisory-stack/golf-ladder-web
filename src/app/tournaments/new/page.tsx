"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

export default function NewTournamentPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [periodType, setPeriodType] = useState<"weekly" | "monthly">("weekly");
  const [periodCount, setPeriodCount] = useState("4");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    // Default to next Monday
    const day = d.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    d.setDate(d.getDate() + daysUntilMonday);
    return d.toISOString().split("T")[0];
  });

  const count = Number(periodCount) || 0;
  const endDateStr = (() => {
    if (!startDate || count < 1) return "";
    const start = new Date(startDate + "T00:00:00");
    if (periodType === "weekly") {
      start.setDate(start.getDate() + count * 7);
    } else {
      start.setMonth(start.getMonth() + count);
    }
    return start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  })();

  async function create() {
    if (!name.trim()) { setError("Give your tournament a name."); return; }
    if (count < 1 || count > 52) { setError("Duration must be 1–52."); return; }
    if (!startDate) { setError("Pick a start date."); return; }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setSaving(false); return; }

      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          description: description.trim() || null,
          period_type: periodType,
          period_count: count,
          start_date: startDate,
        }),
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create"); setSaving(false); return; }

      router.push(`/tournaments/${json.tournament.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tournaments" className="text-sm text-[var(--pine)] font-medium">
          &larr; Tournaments
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New Tournament</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Set up a multi-week or multi-month competition with friends.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-5">
        {/* Name */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Tournament name</label>
          <input
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Summer Series 2026"
          />
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Description <span className="normal-case text-[var(--muted)]">(optional)</span></label>
          <textarea
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm resize-none"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Best differential each week wins..."
          />
        </div>

        {/* Period type */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Period type</label>
          <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-white/60 p-1">
            {(["weekly", "monthly"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPeriodType(t)}
                className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                  periodType === t
                    ? "bg-[var(--pine)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {t === "weekly" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
            Number of {periodType === "weekly" ? "weeks" : "months"}
          </label>
          <input
            type="number"
            min="1"
            max="52"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={periodCount}
            onChange={(e) => setPeriodCount(e.target.value)}
          />
        </div>

        {/* Start date */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Start date</label>
          <input
            type="date"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        {/* Summary */}
        {startDate && count >= 1 && (
          <div className="rounded-2xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-4">
            <div className="text-xs font-medium text-[var(--pine)] uppercase tracking-wide mb-2">Summary</div>
            <div className="text-sm text-[var(--ink)]">
              <strong>{count}</strong> {periodType === "weekly" ? "week" : "month"}{count !== 1 ? "s" : ""} starting{" "}
              <strong>{new Date(startDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong>
              {endDateStr && <> through <strong>{endDateStr}</strong></>}.
              Each {periodType === "weekly" ? "week" : "month"}, the lowest differential wins.
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={create}
            disabled={saving}
            className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
          >
            {saving ? "Creating..." : "Create tournament"}
          </button>
          <Link
            href="/tournaments"
            className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
