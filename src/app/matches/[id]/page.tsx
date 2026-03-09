"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

type MatchRow = {
  id: string;
  creator_id: string;
  opponent_id: string | null;
  opponent_email: string;
  course_name: string;
  status: string;
  terms_status: string | null;
  format: "stroke_play" | "match_play";
  use_handicap: boolean;
};

type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
  locked: boolean;
};

const TOTAL_HOLES = 18;

function toStringParam(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return null;
}

function sumStrokes(rows: HoleRow[], playerId: string | null) {
  if (!playerId) return null;
  let total = 0;
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") total += r.strokes;
  }
  return total;
}

function nextUnscoredHole(rows: HoleRow[], playerId: string) {
  const scored = new Set<number>();
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") {
      scored.add(r.hole_no);
    }
  }
  for (let h = 1; h <= TOTAL_HOLES; h++) {
    if (!scored.has(h)) return h;
  }
  return TOTAL_HOLES;
}

export default function MatchScoringPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = toStringParam((params as any)?.id ?? (params as any)?.matchId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [match, setMatch] = useState<MatchRow | null>(null);
  const [holes, setHoles] = useState<HoleRow[]>([]);

  const [holeNo, setHoleNo] = useState<number>(1);
  const [strokesInput, setStrokesInput] = useState<string>("");

  useEffect(() => {
    if (!matchId) return;

    let unsub: (() => void) | null = null;

    let handled = false;

    function handleSession(session: { user: { id: string; email?: string } } | null) {
      const sessionUser = session?.user ?? null;

      if (!sessionUser) {
        setMeId(null);
        setMeEmail(null);
        setMatch(null);
        setHoles([]);
        setStatus("Auth session missing");
        setLoading(false);
        return;
      }

      setMeId(sessionUser.id);
      setMeEmail(sessionUser.email ?? null);

      (async () => {
      try {
        setLoading(true);
        setStatus(null);

        const { data: matchData, error: matchErr } = await supabase
          .from("matches")
          .select(
            "id, creator_id, opponent_id, opponent_email, course_name, status, terms_status, format, use_handicap"
          )
          .eq("id", matchId)
          .single();

        if (matchErr) {
          setStatus(matchErr.message);
          setLoading(false);
          return;
        }

        setMatch(matchData as MatchRow);

        const { data: holeData, error: holeErr } = await supabase
          .from("holes")
          .select("match_id, hole_no, player_id, strokes, locked")
          .eq("match_id", matchId);

        if (holeErr) {
          setStatus(holeErr.message);
          setLoading(false);
          return;
        }

        const rows = (holeData ?? []) as HoleRow[];
        setHoles(rows);

        const nextHole = nextUnscoredHole(rows, sessionUser.id);
        setHoleNo(nextHole);

        const existing = rows.find(
          (r) => r.player_id === sessionUser.id && r.hole_no === nextHole
        );
        setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");

        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setStatus(e?.message ?? "Failed to load match");
        setLoading(false);
      }
    })();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      handleSession(session);
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleSession(session);
    });

    unsub = () => subscription.unsubscribe();
    return () => { unsub?.(); };
  }, [matchId]);

  const myScoresByHole = useMemo(() => {
    const m = new Map<number, number>();
    if (!meId) return m;

    for (const r of holes) {
      if (r.player_id === meId && typeof r.strokes === "number") {
        m.set(r.hole_no, r.strokes);
      }
    }

    return m;
  }, [holes, meId]);

  const myTotal = useMemo(() => sumStrokes(holes, meId), [holes, meId]);
  const oppTotal = useMemo(
    () => sumStrokes(holes, match?.opponent_id ?? null),
    [holes, match?.opponent_id]
  );

  const opponentLabel = useMemo(
    () => match?.opponent_email || "Opponent",
    [match]
  );

  function goPrev() {
    if (!meId) return;

    const prev = Math.max(1, holeNo - 1);
    setHoleNo(prev);

    const existing = holes.find((r) => r.player_id === meId && r.hole_no === prev);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
  }

  function goNext() {
    if (!meId) return;

    if (!myScoresByHole.has(holeNo)) {
      setStatus("Enter your strokes for this hole first.");
      return;
    }

    const next = Math.min(TOTAL_HOLES, holeNo + 1);
    setHoleNo(next);

    const existing = holes.find((r) => r.player_id === meId && r.hole_no === next);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
  }

  async function saveHole() {
    if (!matchId || !meId) return;

    setStatus(null);

    const strokes = Number(strokesInput);
    if (!Number.isFinite(strokes) || strokes < 1 || strokes > 20) {
      setStatus("Enter a valid strokes number (1–20).");
      return;
    }

    setSaving(true);

    const { data, error } = await supabase
      .from("holes")
      .upsert(
        {
          match_id: matchId,
          hole_no: holeNo,
          player_id: meId,
          strokes,
          locked: false,
        },
        { onConflict: "match_id,hole_no,player_id" }
      )
      .select("match_id, hole_no, player_id, strokes, locked");

    setSaving(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    const saved = (data ?? []) as HoleRow[];

    setHoles((prev) => {
      const next = [...prev];
      for (const row of saved) {
        const idx = next.findIndex(
          (r) =>
            r.match_id === row.match_id &&
            r.hole_no === row.hole_no &&
            r.player_id === row.player_id
        );
        if (idx >= 0) next[idx] = row;
        else next.push(row);
      }
      return next;
    });

    if (holeNo < TOTAL_HOLES) {
      const nextHole = holeNo + 1;
      setHoleNo(nextHole);

      const existing = holes.find(
        (r) => r.player_id === meId && r.hole_no === nextHole
      );
      setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    }
  }

  const [deletingMatch, setDeletingMatch] = useState(false);

  const isProposed =
    match?.status === "proposed" || match?.terms_status === "pending";
  const isCreator = meId != null && meId === match?.creator_id;
  const canDelete = isProposed && isCreator;

  async function deleteMatch() {
    if (!matchId || !confirm("Delete this proposed match? This cannot be undone.")) return;

    setDeletingMatch(true);

    const { error: holesErr } = await supabase
      .from("holes")
      .delete()
      .eq("match_id", matchId);

    if (holesErr) {
      console.warn("holes delete error:", holesErr.message);
    }

    const { data, error } = await supabase
      .from("matches")
      .delete()
      .eq("id", matchId)
      .select("id");

    setDeletingMatch(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    if (!data || data.length === 0) {
      setStatus("Could not delete match — you may not have permission.");
      return;
    }

    router.push("/matches");
  }

  if (!matchId) return <main className="p-8">Missing match id.</main>;
  if (loading) return <main className="p-8">Loading…</main>;

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm opacity-70">{match?.course_name ?? "Match"}</div>
            <h1 className="text-2xl font-semibold">Scorecard</h1>
            <div className="mt-1 text-sm opacity-60">
              Hole-by-hole scoring • totals update automatically
            </div>
          </div>

          {canDelete && (
            <button
              type="button"
              onClick={deleteMatch}
              disabled={deletingMatch}
              className="shrink-0 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              {deletingMatch ? "Deleting..." : "Delete match"}
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <div className="text-sm opacity-70">You</div>
            <div className="text-2xl font-semibold">{myTotal ?? 0}</div>
            <div className="text-xs opacity-70">{meEmail ?? ""}</div>
          </div>

          <div className="rounded-xl border p-4">
            <div className="text-sm opacity-70">{opponentLabel}</div>
            <div className="text-2xl font-semibold">{oppTotal ?? "—"}</div>
            <div className="text-xs opacity-70">
              {match?.opponent_id ? "Opponent can score" : "Opponent not linked yet"}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              Hole {holeNo} / {TOTAL_HOLES}
            </div>
            <div className="text-sm opacity-70">
              Running total: <span className="font-semibold">{myTotal ?? 0}</span>
            </div>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-sm font-medium">Your strokes</label>
              <input
                className="mt-1 w-full rounded-lg border p-2"
                inputMode="numeric"
                value={strokesInput}
                onChange={(e) => setStrokesInput(e.target.value)}
                placeholder="e.g. 4"
              />
              <div className="mt-1 text-xs opacity-70">
                Save to advance. “Next” is locked until this hole has a score.
              </div>
            </div>

            <button
              className="rounded-lg border px-4 py-2 disabled:opacity-60"
              onClick={saveHole}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              className="rounded-lg border px-3 py-2 disabled:opacity-60"
              onClick={goPrev}
              disabled={holeNo <= 1}
            >
              Previous
            </button>

            <button
              className="rounded-lg border px-3 py-2 disabled:opacity-60"
              onClick={goNext}
              disabled={!myScoresByHole.has(holeNo) || holeNo >= TOTAL_HOLES}
            >
              Next
            </button>
          </div>
        </div>

        <div className="rounded-2xl border p-5">
          <div className="mb-3 font-semibold">Your holes</div>
          <div className="grid grid-cols-6 gap-2 text-sm sm:grid-cols-9">
            {Array.from({ length: TOTAL_HOLES }, (_, i) => i + 1).map((h) => {
              const v = myScoresByHole.get(h);
              return (
                <div key={h} className="rounded-lg border p-2 text-center">
                  <div className="text-xs opacity-60">H{h}</div>
                  <div className="font-semibold">{v ?? "—"}</div>
                </div>
              );
            })}
          </div>
        </div>

        {status && <div className="text-sm text-red-600">{status}</div>}
      </div>
    </main>
  );
}