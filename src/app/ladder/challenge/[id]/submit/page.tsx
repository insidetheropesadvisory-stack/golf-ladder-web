"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker, type ApiTeeInfo } from "@/app/components/ClubPicker";

export default function LadderSubmitPage() {
  const params = useParams();
  const router = useRouter();
  const challengeId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [userId, setUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<any>(null);
  const [existingRound, setExistingRound] = useState<any>(null);

  const [courseName, setCourseName] = useState("");
  const [tees, setTees] = useState<ApiTeeInfo[]>([]);
  const [selectedTee, setSelectedTee] = useState("");
  const [courseRating, setCourseRating] = useState("");
  const [slopeRating, setSlopeRating] = useState("");
  const [par, setPar] = useState("");
  const [playedAt, setPlayedAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [courseApiId, setCourseApiId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUserId(session.user.id);
    });
  }, []);

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/ladder-matches/${challengeId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setChallenge(json.challenge);

        const myRound = (json.rounds ?? []).find((r: any) => r.user_id === session.user.id);
        if (myRound) setExistingRound(myRound);
      }
    }
    if (challengeId) load();
  }, [challengeId]);

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

  const deadlinePassed = challenge
    ? new Date() > new Date(challenge.deadline + "T23:59:59")
    : false;

  const dateOutOfRange = challenge && playedAt
    ? playedAt < challenge.created_at.split("T")[0] || playedAt > challenge.deadline
    : false;

  async function startRound() {
    if (!courseName.trim()) { setError("Select a course"); return; }
    if (!selectedTee.trim()) { setError("Select or enter the tee you played"); return; }
    if (!courseRating) { setError("Enter the course rating"); return; }
    if (!slopeRating) { setError("Enter the slope rating"); return; }
    if (!playedAt) { setError("Enter the date played"); return; }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setSaving(false); return; }

      const res = await fetch(`/api/ladder-matches/${challengeId}/rounds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          course_name: courseName.trim(),
          tee_name: selectedTee || null,
          course_rating: Number(courseRating),
          slope_rating: Number(slopeRating),
          par: par ? Number(par) : null,
          played_at: playedAt,
          golf_course_api_id: courseApiId ? Number(courseApiId) : null,
        }),
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to start round"); setSaving(false); return; }

      router.push(`/ladder/challenge/${challengeId}/score/${json.round.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/ladder/challenge/${challengeId}`} className="text-sm text-[var(--pine)] font-medium">
          &larr; Challenge
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Submit Your Round</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Each player chooses their own course and tee. Your handicap differential determines the winner.
        </p>
      </div>

      {/* Existing round banner */}
      {existingRound && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-amber-800">
              {existingRound.completed
                ? "You already submitted a round for this challenge."
                : "You have a round in progress."}
            </div>
            {!existingRound.completed && (
              <Link
                href={`/ladder/challenge/${challengeId}/score/${existingRound.id}`}
                className="rounded-lg bg-[var(--gold)] px-3 py-1.5 text-xs font-semibold text-[var(--pine)]"
              >
                Continue scoring
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Rules */}
      <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="text-[13px] text-amber-800 leading-snug space-y-1">
            <p><span className="font-bold">Any course, any tee.</span> Your score is normalized by slope and course rating.</p>
            <p><span className="font-bold">Deadline: {challenge?.deadline ?? "—"}</span>. Your round must be completed by then.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-5">
        {userId && (
          <ClubPicker
            value={courseName}
            onChange={setCourseName}
            onTeesChange={setTees}
            onCourseApiIdChange={setCourseApiId}
            userId={userId}
            placeholder="Search for the course you played..."
          />
        )}

        {tees.length > 0 ? (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Tees played</label>
            <div className="flex flex-wrap gap-2">
              {tees.map((t) => {
                const hasData = t.rating != null && t.slope != null;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => hasData && setSelectedTee(t.name)}
                    disabled={!hasData}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                      !hasData
                        ? "border-[var(--border)] bg-black/[0.02] text-[var(--muted)] cursor-not-allowed opacity-60"
                        : selectedTee === t.name
                        ? "border-[var(--pine)] bg-[var(--pine)]/5 text-[var(--pine)]"
                        : "border-[var(--border)] bg-white/80 text-[var(--ink)] hover:border-[var(--pine)]/30"
                    }`}
                  >
                    <div>{t.name}</div>
                    {hasData ? (
                      t.yards && <div className="text-[10px] text-[var(--muted)]">{t.yards} yds</div>
                    ) : (
                      <div className="text-[10px] text-amber-600">Coming soon</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : courseName.trim() ? (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Tee played</label>
            <input
              type="text"
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
              value={selectedTee}
              onChange={(e) => setSelectedTee(e.target.value)}
              placeholder="e.g., Blue, White, Gold"
            />
          </div>
        ) : null}

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

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Date played</label>
          <input
            type="date"
            className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
          />
        </div>

        {dateOutOfRange && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            Round must be played within the challenge window.
          </div>
        )}

        {deadlinePassed && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            The challenge deadline has passed.
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={startRound}
            disabled={saving || deadlinePassed || dateOutOfRange || !!existingRound}
            className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Starting..." : "Start scoring"}
          </button>
          <Link
            href={`/ladder/challenge/${challengeId}`}
            className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}
