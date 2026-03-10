"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker, type ApiTeeInfo } from "@/app/components/ClubPicker";

export default function SubmitRoundPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournamentName, setTournamentName] = useState("");

  const [courseName, setCourseName] = useState("");
  const [tees, setTees] = useState<ApiTeeInfo[]>([]);
  const [selectedTee, setSelectedTee] = useState<string>("");
  const [grossScore, setGrossScore] = useState("");
  const [courseRating, setCourseRating] = useState("");
  const [slopeRating, setSlopeRating] = useState("");
  const [par, setPar] = useState("");
  const [playedAt, setPlayedAt] = useState(() => new Date().toISOString().split("T")[0]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id);
    });
  }, []);

  // Load tournament name
  useEffect(() => {
    async function loadName() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setTournamentName(json.tournament?.name ?? "");
      }
    }
    if (tournamentId) loadName();
  }, [tournamentId]);

  // Auto-fill tee data
  useEffect(() => {
    if (!selectedTee || tees.length === 0) return;
    const tee = tees.find((t) => t.name === selectedTee);
    if (tee) {
      if (tee.rating != null) setCourseRating(String(tee.rating));
      if (tee.slope != null) setSlopeRating(String(tee.slope));
      if (tee.par != null) setPar(String(tee.par));
    }
  }, [selectedTee, tees]);

  // Computed differential preview
  const gross = Number(grossScore) || 0;
  const rating = Number(courseRating) || 0;
  const slope = Number(slopeRating) || 0;
  const diffPreview = gross > 0 && rating > 0 && slope > 0
    ? Math.round(((113 / slope) * (gross - rating)) * 10) / 10
    : null;

  async function submit() {
    if (!courseName.trim()) { setError("Select a course"); return; }
    if (!grossScore) { setError("Enter your gross score"); return; }
    if (!courseRating) { setError("Enter the course rating"); return; }
    if (!slopeRating) { setError("Enter the slope rating"); return; }
    if (!playedAt) { setError("Enter the date played"); return; }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setSaving(false); return; }

      const res = await fetch(`/api/tournaments/${tournamentId}/rounds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          course_name: courseName.trim(),
          tee_name: selectedTee || null,
          gross_score: Number(grossScore),
          course_rating: Number(courseRating),
          slope_rating: Number(slopeRating),
          par: par ? Number(par) : null,
          played_at: playedAt,
        }),
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to submit"); setSaving(false); return; }

      router.push(`/tournaments/${tournamentId}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-[var(--pine)] font-medium">
          &larr; {tournamentName || "Tournament"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Submit a Round</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Enter your score and course details. The differential will be calculated automatically.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-5">
        {/* Course picker */}
        {userId && (
          <ClubPicker
            value={courseName}
            onChange={setCourseName}
            onTeesChange={setTees}
            userId={userId}
            placeholder="Search for the course you played..."
          />
        )}

        {/* Tee selector */}
        {tees.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Tees played</label>
            <div className="flex flex-wrap gap-2">
              {tees.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setSelectedTee(t.name)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    selectedTee === t.name
                      ? "border-[var(--pine)] bg-[var(--pine)]/5 text-[var(--pine)]"
                      : "border-[var(--border)] bg-white/80 text-[var(--ink)] hover:border-[var(--pine)]/30"
                  }`}
                >
                  <div>{t.name}</div>
                  {t.yards && <div className="text-[10px] text-[var(--muted)]">{t.yards} yds</div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Score */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Gross score</label>
          <input
            type="number"
            inputMode="numeric"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={grossScore}
            onChange={(e) => setGrossScore(e.target.value)}
            placeholder="e.g., 82"
          />
        </div>

        {/* Course rating & slope */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Course rating</label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
              value={courseRating}
              onChange={(e) => setCourseRating(e.target.value)}
              placeholder="e.g., 72.3"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Slope rating</label>
            <input
              type="text"
              inputMode="numeric"
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
              value={slopeRating}
              onChange={(e) => setSlopeRating(e.target.value)}
              placeholder="e.g., 131"
            />
          </div>
        </div>

        {/* Par (optional) */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Par <span className="normal-case text-[var(--muted)]">(optional)</span></label>
          <input
            type="number"
            inputMode="numeric"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={par}
            onChange={(e) => setPar(e.target.value)}
            placeholder="e.g., 72"
          />
        </div>

        {/* Date played */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Date played</label>
          <input
            type="date"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
          />
        </div>

        {/* Differential preview */}
        {diffPreview != null && (
          <div className="rounded-2xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-4 text-center">
            <div className="text-xs font-medium text-[var(--pine)] uppercase tracking-wide">Calculated differential</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-[var(--pine)]">
              {diffPreview.toFixed(1)}
            </div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              (113 &divide; {slope}) &times; ({gross} &minus; {rating})
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
          >
            {saving ? "Submitting..." : "Submit round"}
          </button>
          <Link
            href={`/tournaments/${tournamentId}`}
            className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
