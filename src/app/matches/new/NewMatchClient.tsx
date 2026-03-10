"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker } from "@/app/components/ClubPicker";
import { OpponentPicker } from "@/app/components/OpponentPicker";

type SelectedOpponent = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  clubs: string[];
};

export default function NewMatchPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [opponent, setOpponent] = useState<SelectedOpponent | null>(null);
  const [courseName, setCourseName] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [roundTime, setRoundTime] = useState("");

  const [guestFee, setGuestFee] = useState<number | null>(null);
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

    if (!opponent) {
      setStatus("Select an opponent.");
      setLoading(false);
      return;
    }

    if (opponent.id === meId) {
      setStatus("You can't challenge yourself.");
      setLoading(false);
      return;
    }

    const course = courseName.trim();
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

    const oppEmail = opponent.email ?? "";

    const { data, error } = await supabase
      .from("matches")
      .insert({
        creator_id: meId,
        opponent_id: opponent.id,
        opponent_email: oppEmail,
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
    if (oppEmail) {
      const matchUrl = `${window.location.origin}/matches/${data.id}`;
      try {
        await fetch("/api/send-invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: oppEmail,
            matchUrl,
            courseName: course,
            roundTime: roundTimeISO,
            hostEmail: meEmail,
            guestFee: guestFee,
          }),
        });
      } catch {
        console.warn("Invite email failed to send");
      }
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
        {meId ? (
          <OpponentPicker meId={meId} value={opponent} onChange={setOpponent} />
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
            Loading...
          </div>
        )}

        {meId ? (
          <div>
            <ClubPicker value={courseName} onChange={setCourseName} onGuestFeeChange={setGuestFee} userId={meId} />
            {guestFee != null && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50/50 px-3 py-2 text-sm">
                <span className="text-emerald-700 font-medium">Guest fee:</span>
                <span className="font-semibold text-emerald-800">${guestFee}</span>
                <span className="text-xs text-emerald-600/70">per round</span>
              </div>
            )}
          </div>
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
