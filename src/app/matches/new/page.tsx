"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker } from "@/app/components/ClubPicker";

function TopoPattern() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-[0.08]" aria-hidden="true">
      <defs>
        <pattern id="topo" width="160" height="160" patternUnits="userSpaceOnUse">
          <path d="M10,30 C40,10 70,10 100,30 C130,50 150,50 170,30" fill="none" stroke="black" strokeWidth="1" />
          <path d="M-10,70 C20,50 60,55 90,75 C120,95 150,95 180,70" fill="none" stroke="black" strokeWidth="1" />
          <path d="M10,110 C45,90 70,95 95,115 C120,135 150,135 170,110" fill="none" stroke="black" strokeWidth="1" />
          <circle cx="120" cy="45" r="2" fill="black" />
          <circle cx="55" cy="95" r="2" fill="black" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#topo)" />
    </svg>
  );
}

export default function NewMatchPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [opponentEmail, setOpponentEmail] = useState("");
  const [courseName, setCourseName] = useState("");

  const [format, setFormat] = useState<"stroke_play" | "match_play">("stroke_play");
  const [useHandicap, setUseHandicap] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load user + prefill from /clubs “Create match” link: /matches/new?course=...
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setStatus("You're not signed in.");
        return;
      }
      setMeId(user.id);
      setMeEmail(user.email ?? null);

      const preset = sp.get("course");
      if (preset) setCourseName(preset);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createMatch(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setStatus("You're not signed in.");
      setLoading(false);
      return;
    }

    const opp = opponentEmail.trim().toLowerCase();
    const me = (user.email ?? "").trim().toLowerCase();
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

    const { data, error } = await supabase
      .from("matches")
      .insert({
        creator_id: user.id,
        opponent_email: opp,
        course_name: course,
        status: "proposed",

        format,
        use_handicap: useHandicap,
        terms_status: "pending",
        terms_last_proposed_by: user.id,
        terms_last_proposed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    setLoading(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    router.push(`/matches/${data.id}`);
  }

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header card */}
        <div className="relative overflow-hidden rounded-3xl border bg-white/65 backdrop-blur">
          <TopoPattern />
          <div className="relative p-6 sm:p-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-widest text-black/55">RECIPROCITY</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">New Match</h1>
                <p className="mt-1 text-sm text-black/60">
                  Pick a club, propose terms, and keep scoring clean.
                </p>
                {meEmail && (
                  <div className="mt-2 text-xs text-black/50">
                    Signed in as <span className="font-medium text-black/70">{meEmail}</span>
                  </div>
                )}
              </div>

              <Link
                href="/matches"
                className="rounded-xl border bg-white/70 px-3 py-2 text-sm font-semibold hover:bg-white"
              >
                Back
              </Link>
            </div>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-3xl border bg-white/65 p-6 backdrop-blur">
          <form onSubmit={createMatch} className="space-y-5">
            <div className="space-y-1">
              <label className="text-sm font-medium">Opponent email</label>
              <input
                className="w-full rounded-2xl border bg-white/70 px-3 py-2 text-sm outline-none focus:bg-white"
                type="email"
                value={opponentEmail}
                onChange={(e) => setOpponentEmail(e.target.value)}
                placeholder="opponent@email.com"
                required
                autoComplete="email"
              />
              <div className="text-xs text-black/55">We’ll match them by email when they join.</div>
            </div>

            {/* ✅ New: My Clubs first + CT list + logos */}
            {meId ? (
              <ClubPicker value={courseName} onChange={setCourseName} userId={meId} />
            ) : (
              <div className="rounded-2xl border bg-white/70 p-4 text-sm text-black/60">
                Loading clubs…
              </div>
            )}

            <div className="rounded-3xl border bg-white/70 p-5">
              <div className="font-semibold">Match terms (proposed)</div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Format</label>
                  <select
                    className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
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
                    className="h-4 w-4"
                  />
                  <label htmlFor="useHandicap" className="text-sm font-medium">
                    Use handicap (net scoring)
                  </label>
                </div>
              </div>

              <div className="mt-3 text-xs text-black/55">
                MVP note: net uses a simple approximation until we add official course data (slope/rating/tees).
              </div>
            </div>

            <button
              className="inline-flex items-center rounded-2xl border bg-emerald-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? "Creating…" : "Create match"}
            </button>

            {status && <div className="text-sm text-red-600">{status}</div>}
          </form>
        </div>
      </div>
    </main>
  );
}