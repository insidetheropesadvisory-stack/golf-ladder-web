"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker } from "@/app/components/ClubPicker";

export default function NewMatchPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [opponentEmail, setOpponentEmail] = useState("");
  const [courseName, setCourseName] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [roundTime, setRoundTime] = useState("");

  const [format, setFormat] = useState<"stroke_play" | "match_play">("stroke_play");
  const [useHandicap, setUseHandicap] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const preset = sp.get("course");
    if (preset) setCourseName(preset);

    let handled = false;

    function handleUser(user: { id: string; email?: string } | null | undefined) {
      if (!user) {
        setStatus("You're not signed in.");
        return;
      }
      setMeId(user.id);
      setMeEmail(user.email ?? null);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      handleUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createMatch(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    if (!meId || !meEmail) {
      setStatus("You're not signed in.");
      setLoading(false);
      return;
    }

    const opp = opponentEmail.trim().toLowerCase();
    const me = meEmail.trim().toLowerCase();
    const course = courseName.trim();

    if (!opp) {
      setStatus("Enter an opponent email.");
      setLoading(false);
      return;
    }

    if (opp === me) {
      setStatus("Opponent email must be different from your email.");
      setLoading(false);
      return;
    }

    if (!course) {
      setStatus("Pick a club/course.");
      setLoading(false);
      return;
    }

    // Build round_time ISO string from date + time inputs
    let roundTimeISO: string | null = null;
    if (roundDate) {
      const timePart = roundTime || "00:00";
      roundTimeISO = new Date(`${roundDate}T${timePart}`).toISOString();
    }

    const { data, error } = await supabase
      .from("matches")
      .insert({
        creator_id: meId,
        opponent_email: opp,
        course_name: course,
        status: "proposed",
        round_time: roundTimeISO,

        format,
        use_handicap: useHandicap,
        terms_status: "pending",
        terms_last_proposed_by: meId,
        terms_last_proposed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    // Send invite email to opponent
    const matchUrl = `${window.location.origin}/matches/${data.id}`;
    try {
      await fetch("/api/send-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: opp,
          matchUrl,
          courseName: course,
          roundTime: roundTimeISO,
          hostEmail: meEmail,
        }),
      });
    } catch {
      // Don't block match creation if email fails
      console.warn("Invite email failed to send");
    }

    setLoading(false);
    router.push(`/matches/${data.id}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Match</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick a club, propose terms, and challenge your opponent.
        </p>
      </div>

      <form onSubmit={createMatch} className="space-y-5">
        <div className="space-y-1">
          <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
            OPPONENT EMAIL
          </label>
          <input
            className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
            type="email"
            value={opponentEmail}
            onChange={(e) => setOpponentEmail(e.target.value)}
            placeholder="opponent@email.com"
            required
            autoComplete="email"
          />
          <div className="text-xs text-[var(--muted)]">
            They'll get an email invite with a link to the match.
          </div>
        </div>

        {meId ? (
          <ClubPicker value={courseName} onChange={setCourseName} userId={meId} />
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
            Loading clubs...
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
              DATE
            </label>
            <input
              type="date"
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={roundDate}
              onChange={(e) => setRoundDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
              TEE TIME
            </label>
            <input
              type="time"
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={roundTime}
              onChange={(e) => setRoundTime(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5">
          <div className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
            MATCH TERMS
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Format</label>
              <select
                className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none"
                value={format}
                onChange={(e) => setFormat(e.target.value as any)}
              >
                <option value="stroke_play">Stroke Play</option>
                <option value="match_play">Match Play</option>
              </select>
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                id="useHandicap"
                type="checkbox"
                checked={useHandicap}
                onChange={(e) => setUseHandicap(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)]"
              />
              <label htmlFor="useHandicap" className="text-sm font-medium">
                Use handicap (net scoring)
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Creating..." : "Create match"}
          </button>

          <Link
            href="/matches"
            className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Cancel
          </Link>
        </div>

        {status && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {status}
          </div>
        )}
      </form>
    </div>
  );
}
