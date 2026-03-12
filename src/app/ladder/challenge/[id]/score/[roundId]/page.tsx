"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";

const TOTAL_HOLES = 18;

type RoundData = {
  id: string;
  challenge_id: string;
  user_id: string;
  course_name: string;
  tee_name: string | null;
  course_rating: number;
  slope_rating: number;
  par: number | null;
  gross_score: number | null;
  differential: number | null;
  completed: boolean;
  golf_course_api_id: number | null;
};

type HoleInfo = {
  number: number;
  par: number | null;
  yardage: number;
  handicap: number | null;
};

export default function LadderScoringPage() {
  const params = useParams();
  const challengeId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const roundId = typeof params?.roundId === "string" ? params.roundId : Array.isArray(params?.roundId) ? params.roundId[0] : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<RoundData | null>(null);
  const [scores, setScores] = useState<Map<number, number>>(new Map());

  const [holeNo, setHoleNo] = useState(1);
  const [strokesInput, setStrokesInput] = useState("");
  const [completed, setCompleted] = useState(false);
  const [grossScore, setGrossScore] = useState<number | null>(null);
  const [differential, setDifferential] = useState<number | null>(null);
  const [challengeResolved, setChallengeResolved] = useState(false);
  const [holeData, setHoleData] = useState<HoleInfo[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) { setError("Not signed in"); setLoading(false); return; }

        const res = await fetch(`/api/ladder-matches/${challengeId}/rounds/${roundId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError(json.error ?? "Failed to load round");
          setLoading(false);
          return;
        }

        const json = await res.json();
        const r = json.round as RoundData;
        setRound(r);
        setCompleted(r.completed);

        if (r.completed) {
          setGrossScore(r.gross_score);
          setDifferential(r.differential);
        }

        const scoreMap = new Map<number, number>();
        for (const h of (json.holes ?? []) as { hole_no: number; strokes: number }[]) {
          if (typeof h.strokes === "number") scoreMap.set(h.hole_no, h.strokes);
        }
        setScores(scoreMap);

        if (!r.completed) {
          for (let h = 1; h <= TOTAL_HOLES; h++) {
            if (!scoreMap.has(h)) { setHoleNo(h); break; }
          }
        }

        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
        setLoading(false);
      }
    }
    if (challengeId && roundId) load();
  }, [challengeId, roundId]);

  // Fetch hole-by-hole course data when round has a golf_course_api_id
  useEffect(() => {
    async function fetchCourseData() {
      if (!round?.golf_course_api_id || !round?.tee_name) return;
      try {
        const res = await fetch(`/api/golf-courses?courseId=${round.golf_course_api_id}`);
        if (!res.ok) return;
        const json = await res.json();
        const tee = json.course?.tees?.[round.tee_name];
        if (tee?.holes && Array.isArray(tee.holes)) {
          setHoleData(tee.holes as HoleInfo[]);
        }
      } catch {}
    }
    fetchCourseData();
  }, [round?.golf_course_api_id, round?.tee_name]);

  const runningTotal = useMemo(() => {
    let total = 0;
    for (const [, s] of scores) total += s;
    return total;
  }, [scores]);

  const parTotal = round?.par ?? null;

  // Hole info lookup
  const getHole = useCallback((h: number): HoleInfo | undefined => {
    return holeData.find((hi) => hi.number === h);
  }, [holeData]);

  // Par-relative styling matching the regular match scorecard
  function diffClass(strokes: number | undefined, par: number | null | undefined): string {
    if (strokes == null || par == null) return "";
    const d = strokes - par;
    if (d <= -2) return "font-bold text-white";
    if (d === -1) return "font-bold text-white";
    if (d === 0) return "text-[var(--ink)]";
    if (d === 1) return "text-[var(--muted)]";
    return "font-bold text-white";
  }
  function diffBg(strokes: number | undefined, par: number | null | undefined): string {
    if (strokes == null || par == null) return "";
    const d = strokes - par;
    if (d <= -2) return "bg-[var(--gold)]";
    if (d === -1) return "bg-[var(--pine)]";
    if (d === 0) return "bg-white border border-[var(--border)]";
    if (d === 1) return "bg-[#F0EADD]";
    return "bg-[#8B1A1A]";
  }

  const navigateToHole = useCallback((h: number) => {
    if (h < 1 || h > TOTAL_HOLES) return;
    setHoleNo(h);
    const existing = scores.get(h);
    setStrokesInput(existing != null ? String(existing) : "");
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [scores]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target === inputRef.current;
      const isOther = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (isOther && !isInput) return;

      if (e.key === "ArrowLeft") { e.preventDefault(); navigateToHole(holeNo - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navigateToHole(holeNo + 1); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [holeNo, navigateToHole]);

  async function saveHole() {
    if (!round || completed) return;
    const strokes = Number(strokesInput);
    if (!strokes || strokes < 1 || strokes > 20) {
      setError("Enter strokes (1-20)");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError("Not signed in"); setSaving(false); return; }

      const res = await fetch(`/api/ladder-matches/${challengeId}/rounds/${roundId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ hole_no: holeNo, strokes }),
      });

      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to save"); setSaving(false); return; }

      setScores((prev) => {
        const next = new Map(prev);
        next.set(holeNo, strokes);
        return next;
      });

      if (json.completed) {
        setCompleted(true);
        setGrossScore(json.gross_score);
        setDifferential(json.differential);
        if (json.challenge_resolved) setChallengeResolved(true);
      } else {
        for (let h = holeNo + 1; h <= TOTAL_HOLES; h++) {
          if (!scores.has(h) && h !== holeNo) {
            navigateToHole(h);
            break;
          }
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    }
    setSaving(false);
  }

  async function deleteHole() {
    if (!round || completed) return;
    if (!scores.has(holeNo)) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/ladder-matches/${challengeId}/rounds/${roundId}?hole_no=${holeNo}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        setScores((prev) => {
          const next = new Map(prev);
          next.delete(holeNo);
          return next;
        });
        setStrokesInput("");
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-black/[0.03]" />
        <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        <div className="h-32 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error && !round) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">{error}</div>
        <Link href={`/ladder/challenge/${challengeId}`} className="mt-3 inline-block text-sm text-[var(--pine)] underline">
          Back to challenge
        </Link>
      </div>
    );
  }

  if (!round) return null;

  // Completed state
  if (completed) {
    return (
      <div className="space-y-5">
        <div>
          <Link href={`/ladder/challenge/${challengeId}`} className="text-sm text-[var(--pine)] font-medium">
            &larr; Challenge
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Round Complete!</h1>
        </div>

        {challengeResolved && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-center text-sm text-emerald-800 font-medium">
            Both rounds are in — the challenge has been resolved!
            <Link href={`/ladder/challenge/${challengeId}`} className="block mt-1 text-[var(--pine)] underline">
              View results
            </Link>
          </div>
        )}

        <div className="rounded-2xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-6 text-center">
          <div className="text-sm font-medium text-[var(--pine)] uppercase tracking-wide">Your Score</div>
          <div className="mt-2 text-4xl font-bold tabular-nums text-[var(--ink)]">{grossScore}</div>
          {parTotal && grossScore && (
            <div className="mt-1 text-sm text-[var(--muted)]">
              {grossScore - parTotal === 0 ? "Even" : grossScore - parTotal > 0 ? `+${grossScore - parTotal}` : grossScore - parTotal}
            </div>
          )}
          <div className="mt-3 text-xs text-[var(--muted)]">Differential</div>
          <div className="text-2xl font-bold tabular-nums text-[var(--pine)]">{differential?.toFixed(1)}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">{round.course_name}{round.tee_name ? ` · ${round.tee_name}` : ""}</div>
          <div className="mt-0.5 text-[10px] text-[var(--muted)]">Rating {round.course_rating} / Slope {round.slope_rating}</div>
        </div>

        {/* Scorecard — matches regular match style */}
        {(() => {
          const front = Array.from({ length: 9 }, (_, i) => i + 1);
          const back = Array.from({ length: 9 }, (_, i) => i + 10);
          const hasTeeData = holeData.length > 0;
          const hasYards = hasTeeData && (getHole(1)?.yardage ?? 0) > 0;
          const hasHdcp = hasTeeData && getHole(1)?.handicap != null;

          function parRange(holeNos: number[]) {
            if (!hasTeeData) return null;
            let t = 0;
            for (const h of holeNos) { const p = getHole(h)?.par; if (p == null) return null; t += p; }
            return t;
          }
          function yardsRange(holeNos: number[]) {
            if (!hasTeeData) return null;
            let t = 0;
            for (const h of holeNos) { const y = getHole(h)?.yardage; if (y == null) return null; t += y; }
            return t;
          }
          function sumRange(holeNos: number[]) {
            let t = 0;
            for (const h of holeNos) t += scores.get(h) ?? 0;
            return t;
          }

          const parOut = parRange(front);
          const parIn = parRange(back);
          const yardsOut = yardsRange(front);
          const yardsIn = yardsRange(back);

          const labelCx = "sticky left-0 z-10 w-[44px] min-w-[44px] max-w-[44px] px-2";
          const holeCx = "w-[28px] min-w-[28px] px-0";
          const sumW = "w-[36px] min-w-[36px] px-1.5";
          const sumCellCx = "border-l border-[var(--border)]/60";

          function renderNine(holeNos: number[], label: string, parTotal: number | null, yardsTotal: number | null, showTotal: boolean) {
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums" style={{ fontFamily: "var(--font-body), sans-serif" }}>
                  <thead>
                    <tr className="bg-[var(--pine)]">
                      <th className={cx(labelCx, "bg-[var(--pine)] py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#F5F0E8]")}>Hole</th>
                      {holeNos.map(h => (
                        <th key={h} className={cx(holeCx, "py-1.5 text-center font-semibold text-[#F5F0E8]")}>{h}</th>
                      ))}
                      <th className={cx(sumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", sumCellCx)}>{label}</th>
                      {showTotal && <th className={cx(sumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", sumCellCx)}>Tot</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {hasYards && (
                      <tr className="border-t border-[var(--border)]/40 bg-[var(--paper)]">
                        <td className={cx(labelCx, "bg-[var(--paper)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Yds</td>
                        {holeNos.map(h => (
                          <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--gold)]")}>{getHole(h)?.yardage ?? ""}</td>
                        ))}
                        <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{yardsTotal ?? ""}</td>
                        {showTotal && <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{yardsOut != null && yardsIn != null ? yardsOut + yardsIn : ""}</td>}
                      </tr>
                    )}
                    {hasTeeData && (
                      <tr className="border-t border-[var(--border)]/40 bg-[var(--paper-2)]">
                        <td className={cx(labelCx, "bg-[var(--paper-2)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]")}>Par</td>
                        {holeNos.map(h => (
                          <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--ink)]")}>{getHole(h)?.par ?? ""}</td>
                        ))}
                        <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{parTotal ?? ""}</td>
                        {showTotal && <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{parOut != null && parIn != null ? parOut + parIn : ""}</td>}
                      </tr>
                    )}
                    {hasHdcp && (
                      <tr className="border-t border-[var(--border)]/40 bg-[#fefcf8]">
                        <td className={cx(labelCx, "bg-[#fefcf8] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Hdcp</td>
                        {holeNos.map(h => (
                          <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--muted)]")}>{getHole(h)?.handicap ?? ""}</td>
                        ))}
                        <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>
                        {showTotal && <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>}
                      </tr>
                    )}
                    <tr className="border-t-2 border-[var(--border)] bg-[var(--pine)]/5">
                      <td className={cx(labelCx, "bg-[var(--pine)]/5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pine)]")}>Score</td>
                      {holeNos.map(h => {
                        const s = scores.get(h);
                        const par = getHole(h)?.par ?? null;
                        return (
                          <td key={h} className={cx(holeCx, "py-1.5 text-center")}>
                            <span className={cx("relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", s != null ? diffClass(s, par) : "text-[var(--muted)]/30", s != null ? diffBg(s, par) : "")}>
                              {s ?? ""}
                            </span>
                          </td>
                        );
                      })}
                      <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{sumRange(holeNos) || ""}</td>
                      {showTotal && <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{grossScore ?? ""}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          }

          return (
            <div>
              <div className="section-flag section-flag--green mb-3">Scorecard</div>
              <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] overflow-hidden">
                <div className="bg-[var(--pine)] px-4 py-2.5 flex items-center justify-between">
                  <div className="text-[12px] font-bold tracking-tight text-[#F5F0E8]" style={{ fontFamily: "var(--font-heading)" }}>Final Score</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[#F5F0E8]/70">
                    {round.tee_name && <span className="font-medium text-[#F5F0E8]">{round.tee_name}</span>}
                    {round.tee_name && <span className="text-[var(--gold)]">&middot;</span>}
                    <span>18 Holes</span>
                  </div>
                </div>

                {!hasTeeData && (
                  <div className="px-4 py-2.5 text-[11px] text-[var(--muted)] bg-[var(--paper)] border-b border-[var(--border)]/60">
                    Course data unavailable — hole details not shown.
                  </div>
                )}

                {renderNine(front, "Out", parOut, yardsOut, false)}
                <div className="border-t-2 border-[var(--border)]">
                  {renderNine(back, "In", parIn, yardsIn, true)}
                </div>

                {hasTeeData && (
                  <div className="border-t border-[var(--border)]/60 bg-[var(--paper)] px-4 py-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Eagle+</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--pine)]" /> Birdie</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)] bg-white" /> Par</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F0EADD]" /> Bogey</span>
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#8B1A1A]" /> Dbl+</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        <Link
          href={`/ladder/challenge/${challengeId}`}
          className="inline-block rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
        >
          Back to challenge
        </Link>
      </div>
    );
  }

  // Active scoring
  return (
    <div className="space-y-5">
      <div>
        <Link href={`/ladder/challenge/${challengeId}`} className="text-sm text-[var(--pine)] font-medium">
          &larr; Challenge
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">{round.course_name}</h1>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-[var(--ink)]">{runningTotal}</div>
            <div className="text-[10px] text-[var(--muted)]">{scores.size}/{TOTAL_HOLES} holes</div>
          </div>
        </div>
        {round.tee_name && (
          <div className="text-xs text-[var(--muted)]">{round.tee_name} tees</div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      )}

      {/* Current hole scoring */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5">
        <div className="text-center">
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide">Hole</div>
          <div className="text-4xl font-bold text-[var(--ink)]">{holeNo}</div>
          {(() => {
            const hole = getHole(holeNo);
            if (!hole) return null;
            return (
              <div className="mt-1.5 flex items-center justify-center gap-3 text-xs text-[var(--muted)]">
                {hole.par != null && <span>Par <span className="font-semibold text-[var(--ink)]">{hole.par}</span></span>}
                {hole.yardage > 0 && <span>{hole.yardage} yds</span>}
                {hole.handicap != null && <span>Hdcp {hole.handicap}</span>}
              </div>
            );
          })()}
        </div>

        <div className="mt-5">
          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-4 text-center text-2xl font-bold outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm tabular-nums"
            value={strokesInput}
            onChange={(e) => setStrokesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); saveHole(); }
            }}
            placeholder="—"
            min={1}
            max={20}
            autoFocus
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={saveHole}
            disabled={saving || !strokesInput}
            className="flex-1 rounded-xl bg-[var(--pine)] py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {scores.has(holeNo) && (
            <button
              type="button"
              onClick={deleteHole}
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
            >
              Undo
            </button>
          )}
        </div>

        {/* Hole navigation */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigateToHole(holeNo - 1)}
            disabled={holeNo <= 1}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--pine)] disabled:opacity-30"
          >
            &larr; Prev
          </button>
          <span className="text-xs text-[var(--muted)]">Hole {holeNo} of {TOTAL_HOLES}</span>
          <button
            type="button"
            onClick={() => navigateToHole(holeNo + 1)}
            disabled={holeNo >= TOTAL_HOLES}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--pine)] disabled:opacity-30"
          >
            Next &rarr;
          </button>
        </div>
      </div>

      {/* Live scorecard — matches regular match style */}
      {(() => {
        const front = Array.from({ length: 9 }, (_, i) => i + 1);
        const back = Array.from({ length: 9 }, (_, i) => i + 10);
        const hasTeeData = holeData.length > 0;
        const hasYards = hasTeeData && (getHole(1)?.yardage ?? 0) > 0;
        const hasHdcp = hasTeeData && getHole(1)?.handicap != null;

        function parRange(holeNos: number[]) {
          if (!hasTeeData) return null;
          let t = 0;
          for (const h of holeNos) { const p = getHole(h)?.par; if (p == null) return null; t += p; }
          return t;
        }
        function yardsRange(holeNos: number[]) {
          if (!hasTeeData) return null;
          let t = 0;
          for (const h of holeNos) { const y = getHole(h)?.yardage; if (y == null) return null; t += y; }
          return t;
        }
        function sumMyRange(holeNos: number[]) {
          let t = 0;
          for (const h of holeNos) t += scores.get(h) ?? 0;
          return scores.size > 0 ? t : 0;
        }

        const frontPar = parRange(front);
        const backPar = parRange(back);
        const frontYards = yardsRange(front);
        const backYards = yardsRange(back);

        const labelCx = "sticky left-0 z-10 w-[44px] min-w-[44px] max-w-[44px] px-2";
        const holeCx = "w-[28px] min-w-[28px] px-0";
        const sumW = "w-[36px] min-w-[36px] px-1.5";
        const sumCellCx = "border-l border-[var(--border)]/60";

        function renderLiveNine(holeNos: number[], label: string, parTotal: number | null, yardsTotal: number | null, showTotal: boolean) {
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums" style={{ fontFamily: "var(--font-body), sans-serif" }}>
                <thead>
                  <tr className="bg-[var(--pine)]">
                    <th className={cx(labelCx, "bg-[var(--pine)] py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#F5F0E8]")}>Hole</th>
                    {holeNos.map(h => (
                      <th
                        key={h}
                        className={cx(holeCx, "py-1.5 text-center font-semibold cursor-pointer transition", h === holeNo ? "text-[var(--gold)]" : "text-[#F5F0E8]")}
                        onClick={() => navigateToHole(h)}
                      >{h}</th>
                    ))}
                    <th className={cx(sumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", sumCellCx)}>{label}</th>
                    {showTotal && <th className={cx(sumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", sumCellCx)}>Tot</th>}
                  </tr>
                </thead>
                <tbody>
                  {hasYards && (
                    <tr className="border-t border-[var(--border)]/40 bg-[var(--paper)]">
                      <td className={cx(labelCx, "bg-[var(--paper)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Yds</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(holeCx, "py-1 text-center", h === holeNo ? "font-semibold text-[var(--gold)]" : "text-[var(--gold)]")}>{getHole(h)?.yardage ?? ""}</td>
                      ))}
                      <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{yardsTotal ?? ""}</td>
                      {showTotal && <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{frontYards != null && backYards != null ? frontYards + backYards : ""}</td>}
                    </tr>
                  )}
                  {hasTeeData && (
                    <tr className="border-t border-[var(--border)]/40 bg-[var(--paper-2)]">
                      <td className={cx(labelCx, "bg-[var(--paper-2)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]")}>Par</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(holeCx, "py-1 text-center", h === holeNo ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]")}>{getHole(h)?.par ?? ""}</td>
                      ))}
                      <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{parTotal ?? ""}</td>
                      {showTotal && <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{frontPar != null && backPar != null ? frontPar + backPar : ""}</td>}
                    </tr>
                  )}
                  {hasHdcp && (
                    <tr className="border-t border-[var(--border)]/40 bg-[#fefcf8]">
                      <td className={cx(labelCx, "bg-[#fefcf8] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Hdcp</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--muted)]")}>{getHole(h)?.handicap ?? ""}</td>
                      ))}
                      <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>
                      {showTotal && <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>}
                    </tr>
                  )}
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--pine)]/5">
                    <td className={cx(labelCx, "bg-[var(--pine)]/5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pine)]")}>Score</td>
                    {holeNos.map(h => {
                      const s = scores.get(h);
                      const par = getHole(h)?.par ?? null;
                      return (
                        <td
                          key={h}
                          className={cx(holeCx, "py-1.5 text-center cursor-pointer transition", h === holeNo && "bg-[var(--gold)]/10")}
                          onClick={() => navigateToHole(h)}
                        >
                          <span className={cx(
                            "relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                            s != null ? diffClass(s, par) : "text-[var(--muted)]/30",
                            s != null ? diffBg(s, par) : ""
                          )}>
                            {s ?? "\u2013"}
                          </span>
                        </td>
                      );
                    })}
                    <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{sumMyRange(holeNos) || ""}</td>
                    {showTotal && <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{(sumMyRange(front) + sumMyRange(back)) || ""}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <div>
            <div className="section-flag section-flag--green mb-3">Scorecard</div>
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] overflow-hidden">
              <div className="bg-[var(--pine)] px-4 py-2.5 flex items-center justify-between">
                <div className="text-[12px] font-bold tracking-tight text-[#F5F0E8]" style={{ fontFamily: "var(--font-heading)" }}>Live Score</div>
                <div className="flex items-center gap-1.5 text-[11px] text-[#F5F0E8]/70">
                  {round.tee_name && <span className="font-medium text-[#F5F0E8]">{round.tee_name}</span>}
                  {round.tee_name && <span className="text-[var(--gold)]">&middot;</span>}
                  <span>{scores.size}/{TOTAL_HOLES} scored</span>
                </div>
              </div>

              {!hasTeeData && (
                <div className="px-4 py-2.5 text-[11px] text-[var(--muted)] bg-[var(--paper)] border-b border-[var(--border)]/60">
                  Course data unavailable — hole details not shown.
                </div>
              )}

              {renderLiveNine(front, "Out", frontPar, frontYards, false)}
              <div className="border-t-2 border-[var(--border)]">
                {renderLiveNine(back, "In", backPar, backYards, true)}
              </div>

              {hasTeeData && (
                <div className="border-t border-[var(--border)]/60 bg-[var(--paper)] px-4 py-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Eagle+</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--pine)]" /> Birdie</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)] bg-white" /> Par</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F0EADD]" /> Bogey</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#8B1A1A]" /> Dbl+</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
