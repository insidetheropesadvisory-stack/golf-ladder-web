"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker, type ApiTeeInfo } from "@/app/components/ClubPicker";

type TournamentMeta = {
  name: string;
  period_type: "weekly" | "monthly";
  period_count: number;
  start_date: string;
  end_date: string;
};

function computePeriodNumber(startDate: string, periodType: string, playedAt: string): number {
  const start = new Date(startDate + "T00:00:00");
  const played = new Date(playedAt + "T00:00:00");
  if (periodType === "weekly") {
    const diffMs = played.getTime() - start.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  } else {
    return (played.getFullYear() - start.getFullYear()) * 12 + (played.getMonth() - start.getMonth()) + 1;
  }
}

export default function SubmitRoundPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tournament, setTournament] = useState<TournamentMeta | null>(null);
  const [submittedPeriods, setSubmittedPeriods] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);

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

  // Load tournament info + which periods already have scores
  useEffect(() => {
    async function loadTournament() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`/api/tournaments/${tournamentId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const t = json.tournament;
        if (t) {
          setTournament({
            name: t.name,
            period_type: t.period_type,
            period_count: t.period_count,
            start_date: t.start_date,
            end_date: t.end_date,
          });
        }
        // Find which periods this user already submitted
        const myRounds = (json.rounds ?? []).filter((r: any) => r.user_id === session.user.id);
        setSubmittedPeriods(new Set(myRounds.map((r: any) => r.period_number)));
      }
    }
    if (tournamentId) loadTournament();
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

  // Computed values
  const gross = Number(grossScore) || 0;
  const rating = Number(courseRating) || 0;
  const slope = Number(slopeRating) || 0;
  const diffPreview = gross > 0 && rating > 0 && slope > 0
    ? Math.round(((113 / slope) * (gross - rating)) * 10) / 10
    : null;

  const unit = tournament?.period_type === "weekly" ? "Week" : "Month";
  const unitLower = unit.toLowerCase();

  // Figure out which period this round would go into
  const targetPeriod = tournament && playedAt
    ? computePeriodNumber(tournament.start_date, tournament.period_type, playedAt)
    : null;
  const periodInRange = targetPeriod != null && targetPeriod >= 1 && targetPeriod <= (tournament?.period_count ?? 0);
  const periodAlreadySubmitted = targetPeriod != null && submittedPeriods.has(targetPeriod);

  // 12-hour deadline check (client-side preview)
  const deadlinePassed = (() => {
    if (!playedAt) return false;
    const playedEnd = new Date(playedAt + "T23:59:59");
    const deadline = new Date(playedEnd.getTime() + 12 * 60 * 60 * 1000);
    return new Date() > deadline;
  })();

  function handleSubmitClick() {
    if (!courseName.trim()) { setError("Select a course"); return; }
    if (!grossScore) { setError("Enter your gross score"); return; }
    if (!courseRating) { setError("Enter the course rating"); return; }
    if (!slopeRating) { setError("Enter the slope rating"); return; }
    if (!playedAt) { setError("Enter the date played"); return; }
    setError(null);
    setConfirming(true);
  }

  async function submitConfirmed() {
    setSaving(true);
    setError(null);
    setConfirming(false);

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
          &larr; {tournament?.name || "Tournament"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Submit a Round</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Enter your score and course details. The differential will be calculated automatically.
        </p>
      </div>

      {/* Rules banner */}
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="text-[13px] text-amber-800 leading-snug space-y-1">
            <p><span className="font-bold">One score per {unitLower}.</span> Once submitted, your score is locked in and cannot be changed.</p>
            <p><span className="font-bold">12-hour deadline.</span> Scores must be entered within 12 hours of the round or the {unitLower} counts as N/A.</p>
          </div>
        </div>
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

        {/* Period info / warnings */}
        {tournament && playedAt && (
          <div className="space-y-2">
            {periodInRange && !periodAlreadySubmitted && !deadlinePassed && (
              <div className="rounded-xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 px-4 py-2.5 text-sm text-[var(--pine)]">
                This round counts for <span className="font-bold">{unit} {targetPeriod}</span>.
              </div>
            )}
            {periodAlreadySubmitted && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                You already submitted a score for {unit} {targetPeriod}. Only one score per {unitLower} is allowed.
              </div>
            )}
            {deadlinePassed && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                The 12-hour submission window for this date has closed. This round cannot be submitted.
              </div>
            )}
            {!periodInRange && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                This date falls outside the tournament period ({tournament.start_date} to {tournament.end_date}).
              </div>
            )}
          </div>
        )}

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
            onClick={handleSubmitClick}
            disabled={saving || periodAlreadySubmitted || deadlinePassed || !periodInRange}
            className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
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

      {/* Lock-in confirmation modal */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 shadow-2xl">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--ink)]">Lock in this score?</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">
                This will be your score for <span className="font-semibold text-[var(--ink)]">{unit} {targetPeriod}</span>.
                Once submitted, it <span className="font-semibold text-[var(--ink)]">cannot be changed</span>.
              </p>

              {diffPreview != null && (
                <div className="mt-4 rounded-xl bg-[var(--pine)]/5 py-3">
                  <div className="text-xs text-[var(--muted)]">{courseName} &middot; {gross} gross</div>
                  <div className="text-2xl font-bold tabular-nums text-[var(--pine)]">{diffPreview.toFixed(1)}</div>
                  <div className="text-xs text-[var(--muted)]">differential</div>
                </div>
              )}

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="flex-1 rounded-xl border border-[var(--border)] bg-white py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
                >
                  Go back
                </button>
                <button
                  type="button"
                  onClick={submitConfirmed}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-[var(--pine)] py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md disabled:opacity-60"
                >
                  {saving ? "Locking in..." : "Lock it in"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
