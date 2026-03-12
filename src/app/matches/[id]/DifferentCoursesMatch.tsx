"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";
import { ClubPicker, type ApiTeeInfo } from "@/app/components/ClubPicker";
import {
  type MatchRow,
  type MatchRound,
  type MatchHole,
  type TeeData,
  type CourseData,
  DEFAULT_HOLES,
  getTeeRating,
  getTeeTotalYards,
  getHolePar,
  getHoleYards,
  getHoleHandicap,
  buildStrokeHoles,
  calcDifferential,
  matchPlayScoreText,
  diffClass,
} from "./lib";

type ViewState = "overview" | "submit-round" | "score-round";

export default function DifferentCoursesMatch({ matchId }: { matchId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [rounds, setRounds] = useState<MatchRound[]>([]);
  const [allHoles, setAllHoles] = useState<MatchHole[]>([]);
  const [myHandicap, setMyHandicap] = useState<number | null>(null);
  const [oppHandicap, setOppHandicap] = useState<number | null>(null);
  const [oppDisplayName, setOppDisplayName] = useState<string | null>(null);

  const [viewState, setViewState] = useState<ViewState>("overview");

  // Round submission
  const [courseName, setCourseName] = useState("");
  const [tees, setTees] = useState<ApiTeeInfo[]>([]);
  const [selectedTee, setSelectedTee] = useState("");
  const [courseRating, setCourseRating] = useState("");
  const [slopeRating, setSlopeRating] = useState("");
  const [par, setPar] = useState("");
  const [playedAt, setPlayedAt] = useState(() => new Date().toISOString().split("T")[0]);
  const [courseApiId, setCourseApiId] = useState<string | null>(null);

  // Scoring
  const [holeNo, setHoleNo] = useState(1);
  const [strokesInput, setStrokesInput] = useState("");
  const strokesInputRef = useRef<HTMLInputElement>(null);

  // Course data for scoring UI
  const [courseData, setCourseData] = useState<CourseData | null>(null);

  // Accept/decline state
  const [responding, setResponding] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const totalHoles = match?.hole_count ?? DEFAULT_HOLES;

  const myRound = useMemo(() => rounds.find(r => r.user_id === meId), [rounds, meId]);
  const oppRound = useMemo(() => rounds.find(r => r.user_id !== meId), [rounds, meId]);
  const myHoles = useMemo(() => myRound ? allHoles.filter(h => h.match_round_id === myRound.id) : [], [allHoles, myRound]);
  const oppHoles = useMemo(() => oppRound ? allHoles.filter(h => h.match_round_id === oppRound.id) : [], [allHoles, oppRound]);

  const oppId = useMemo(() => {
    if (!meId || !match) return null;
    return meId === match.creator_id ? match.opponent_id : match.creator_id;
  }, [meId, match]);

  const opponentLabel = useMemo(() => {
    if (oppDisplayName) return oppDisplayName;
    if (!meId || !match) return "Opponent";
    if (meId === match.creator_id) return match.opponent_email || "Opponent";
    return "Opponent";
  }, [meId, match, oppDisplayName]);

  const isMatchPlay = match?.format === "match_play";
  const useHcp = match?.use_handicap === true;
  const isCompleted = match?.completed === true || match?.status === "completed";
  const isProposed = match?.status === "proposed" || match?.terms_status === "pending";
  const isCreator = meId != null && meId === match?.creator_id;
  const isActive = match?.terms_status === "accepted" || match?.status === "active";

  const isOpponent = isProposed &&
    meEmail != null &&
    match?.opponent_email != null &&
    meEmail.trim().toLowerCase() === match.opponent_email.trim().toLowerCase();

  const myScored = useMemo(() => {
    const s = new Set<number>();
    for (const h of myHoles) {
      if (typeof h.strokes === "number") s.add(h.hole_no);
    }
    return s;
  }, [myHoles]);

  const myTotal = useMemo(() => {
    let t = 0;
    for (const h of myHoles) {
      if (typeof h.strokes === "number") t += h.strokes;
    }
    return myScored.size > 0 ? t : null;
  }, [myHoles, myScored]);

  const oppTotal = useMemo(() => {
    let t = 0;
    for (const h of oppHoles) {
      if (typeof h.strokes === "number") t += h.strokes;
    }
    return oppHoles.length > 0 ? t : null;
  }, [oppHoles]);

  // Load match data
  useEffect(() => {
    if (!matchId) return;

    let handled = false;

    function handleSession(session: { user: { id: string; email?: string } } | null) {
      const u = session?.user;
      if (!u) { setLoading(false); return; }
      setMeId(u.id);
      setMeEmail(u.email ?? null);

      (async () => {
        try {
          setLoading(true);
          const tok = (await supabase.auth.getSession()).data.session?.access_token;
          const headers: Record<string, string> = tok ? { Authorization: `Bearer ${tok}` } : {};

          // Fetch match
          const { data: matchData } = await supabase
            .from("matches")
            .select("id, creator_id, opponent_id, opponent_email, course_name, status, completed, terms_status, format, use_handicap, round_time, guest_fee, is_ladder_match, hole_count, golf_course_api_id, selected_tee, opponent_tee, play_mode")
            .eq("id", matchId)
            .single();

          if (!matchData) { setStatus("Match not found"); setLoading(false); return; }
          setMatch(matchData as MatchRow);

          // Fetch rounds + holes via API
          const roundsRes = await fetch(`/api/matches/${matchId}/rounds`, { headers });
          if (roundsRes.ok) {
            const rj = await roundsRes.json();
            setRounds(rj.rounds ?? []);
            setAllHoles(rj.holes ?? []);
          }

          // Fetch profiles
          const m = matchData;
          const otherPlayerId = u.id === m.creator_id ? m.opponent_id : m.creator_id;
          const ids = [u.id, otherPlayerId].filter(Boolean) as string[];
          if (ids.length > 0) {
            const { data: profData } = await supabase
              .from("profiles")
              .select("id, handicap_index, display_name")
              .in("id", ids);
            if (profData) {
              for (const p of profData as any[]) {
                if (p.id === u.id) setMyHandicap(p.handicap_index ?? null);
                else { setOppHandicap(p.handicap_index ?? null); setOppDisplayName(p.display_name ?? null); }
              }
            }
          }

          setLoading(false);
        } catch (e: any) {
          setStatus(e?.message ?? "Failed to load");
          setLoading(false);
        }
      })();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      handled = true;
      handleSession(s);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, [matchId]);

  // Load course data when scoring
  useEffect(() => {
    if (!myRound?.golf_course_api_id) return;
    fetch(`/api/golf-courses?id=${myRound.golf_course_api_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.course?.tees) setCourseData(json.course);
        else if (json?.tees) setCourseData(json);
      })
      .catch(() => {});
  }, [myRound?.golf_course_api_id]);

  const activeTee: TeeData | null = useMemo(() => {
    if (!courseData?.tees || !myRound?.tee_name) return null;
    return courseData.tees[myRound.tee_name] ?? null;
  }, [courseData, myRound?.tee_name]);

  // Auto-fill tee data for round submission
  useEffect(() => {
    if (!selectedTee || tees.length === 0) return;
    const tee = tees.find(t => t.name === selectedTee);
    if (tee) {
      if (tee.rating != null) setCourseRating(String(tee.rating));
      if (tee.slope != null) setSlopeRating(String(tee.slope));
      if (tee.par != null) setPar(String(tee.par));
    }
  }, [selectedTee, tees]);

  // Match play scoring data
  const matchPlayData = useMemo(() => {
    if (!isMatchPlay || !myRound || !oppRound) return null;
    if (!useHcp || myHandicap == null || oppHandicap == null) {
      // Gross match play across courses - just compare hole-by-hole
      let p1Won = 0, p2Won = 0, halved = 0;
      for (let h = 1; h <= totalHoles; h++) {
        const s1 = myHoles.find(r => r.hole_no === h)?.strokes;
        const s2 = oppHoles.find(r => r.hole_no === h)?.strokes;
        if (s1 == null || s2 == null) continue;
        if (s1 < s2) p1Won++;
        else if (s2 < s1) p2Won++;
        else halved++;
      }
      return { p1Won, p2Won, halved };
    }

    // Net match play with cross-course handicap
    const myPar = Number(myRound.par ?? 72);
    const oppPar = Number(oppRound.par ?? 72);
    const myCourseHcp = Math.round(myHandicap * (Number(myRound.slope_rating) / 113) + (Number(myRound.course_rating) - myPar));
    const oppCourseHcp = Math.round(oppHandicap * (Number(oppRound.slope_rating) / 113) + (Number(oppRound.course_rating) - oppPar));

    const diff = Math.abs(myCourseHcp - oppCourseHcp);
    const iReceiveStrokes = myCourseHcp > oppCourseHcp;

    // Build stroke holes on the receiver's own tee
    const receiverTee = iReceiveStrokes ? activeTee : null; // opponent tee data not loaded
    const strokeMap = buildStrokeHoles(receiverTee, diff);

    let p1Won = 0, p2Won = 0, halved = 0;
    for (let h = 1; h <= totalHoles; h++) {
      let s1 = myHoles.find(r => r.hole_no === h)?.strokes ?? null;
      let s2 = oppHoles.find(r => r.hole_no === h)?.strokes ?? null;
      if (s1 == null || s2 == null) continue;

      const strokesOnHole = strokeMap.get(h) ?? 0;
      if (strokesOnHole > 0) {
        if (iReceiveStrokes) s1 -= strokesOnHole;
        else s2 -= strokesOnHole;
      }

      if (s1 < s2) p1Won++;
      else if (s2 < s1) p2Won++;
      else halved++;
    }
    return { p1Won, p2Won, halved };
  }, [isMatchPlay, useHcp, myHandicap, oppHandicap, myRound, oppRound, myHoles, oppHoles, totalHoles, activeTee]);

  // Stroke map for current user's display (match play with handicap)
  const strokeHolesMap = useMemo(() => {
    if (!isMatchPlay || !useHcp || myHandicap == null || oppHandicap == null || !myRound || !oppRound) {
      return new Map<number, number>();
    }
    const myPar = Number(myRound.par ?? 72);
    const oppPar = Number(oppRound.par ?? 72);
    const myCourseHcp = Math.round(myHandicap * (Number(myRound.slope_rating) / 113) + (Number(myRound.course_rating) - myPar));
    const oppCourseHcp = Math.round(oppHandicap * (Number(oppRound.slope_rating) / 113) + (Number(oppRound.course_rating) - oppPar));
    const diff = Math.abs(myCourseHcp - oppCourseHcp);
    const iReceive = myCourseHcp > oppCourseHcp;
    // Only show dots on MY holes if I'm receiving strokes
    return iReceive ? buildStrokeHoles(activeTee, diff) : new Map();
  }, [isMatchPlay, useHcp, myHandicap, oppHandicap, myRound, oppRound, activeTee]);

  const strokeReceiver = useMemo(() => {
    if (!useHcp || myHandicap == null || oppHandicap == null || !myRound || !oppRound) return null;
    const myPar = Number(myRound.par ?? 72);
    const oppPar = Number(oppRound.par ?? 72);
    const myCH = myHandicap * (Number(myRound.slope_rating) / 113) + (Number(myRound.course_rating) - myPar);
    const oppCH = oppHandicap * (Number(oppRound.slope_rating) / 113) + (Number(oppRound.course_rating) - oppPar);
    if (myCH > oppCH) return "me";
    if (oppCH > myCH) return "opp";
    return null;
  }, [useHcp, myHandicap, oppHandicap, myRound, oppRound]);

  // Differentials
  const myDiff = myRound?.differential != null ? Number(myRound.differential) : null;
  const oppDiff = oppRound?.differential != null ? Number(oppRound.differential) : null;

  // Result data
  const resultData = useMemo(() => {
    if (isMatchPlay && matchPlayData) {
      const { p1Won, p2Won } = matchPlayData;
      if (p1Won > p2Won) return { myWins: true, oppWins: false, isTie: false };
      if (p2Won > p1Won) return { myWins: false, oppWins: true, isTie: false };
      return { myWins: false, oppWins: false, isTie: true };
    }
    // Stroke play (differential comparison)
    if (myDiff == null || oppDiff == null) return { myWins: false, oppWins: false, isTie: false };
    return {
      myWins: myDiff < oppDiff,
      oppWins: oppDiff < myDiff,
      isTie: myDiff === oppDiff,
    };
  }, [isMatchPlay, matchPlayData, myDiff, oppDiff]);

  // Keyboard nav
  const navigateToHole = useCallback((h: number) => {
    if (h < 1 || h > totalHoles) return;
    setHoleNo(h);
    const existing = myHoles.find(r => r.hole_no === h);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
    setTimeout(() => strokesInputRef.current?.focus(), 50);
  }, [myHoles, totalHoles]);

  useEffect(() => {
    if (viewState !== "score-round") return;
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isStrokesInput = target === strokesInputRef.current;
      const isOtherInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (isOtherInput && !isStrokesInput) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); navigateToHole(holeNo - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); navigateToHole(holeNo + 1); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewState, holeNo, navigateToHole]);

  async function respondToMatch(action: "accept" | "decline") {
    setResponding(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/respond-match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        matchId,
        action,
        ...(action === "decline" && declineReason ? { reason: declineReason } : {}),
      }),
    });
    const json = await res.json();
    setResponding(false);
    if (!res.ok) { setStatus(json.error || "Failed to respond"); return; }
    if (action === "decline") router.push("/matches");
    else window.location.reload();
  }

  async function startRound() {
    if (!courseName.trim()) { setStatus("Select a course"); return; }
    if (!courseRating) { setStatus("Enter the course rating"); return; }
    if (!slopeRating) { setStatus("Enter the slope rating"); return; }
    if (!playedAt) { setStatus("Enter the date played"); return; }

    setSaving(true);
    setStatus(null);

    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      if (!tok) { setStatus("Not signed in"); setSaving(false); return; }

      const res = await fetch(`/api/matches/${matchId}/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
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
      if (!res.ok) { setStatus(json.error ?? "Failed to start round"); setSaving(false); return; }

      setRounds(prev => [...prev, json.round]);
      setViewState("score-round");
      setHoleNo(1);
      setStrokesInput("");
      setSaving(false);
    } catch (e: any) {
      setStatus(e?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  async function saveHole() {
    if (!myRound) return;
    setStatus(null);
    const strokes = Number(strokesInput);
    if (!Number.isFinite(strokes) || strokes < 1 || strokes > 20) {
      setStatus("Enter valid strokes (1-20).");
      return;
    }

    setSaving(true);

    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/matches/${matchId}/rounds/${myRound.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ hole_no: holeNo, strokes }),
      });

      const json = await res.json();
      setSaving(false);

      if (!res.ok) { setStatus(json.error ?? "Failed to save"); return; }

      // Update local holes state
      setAllHoles(prev => {
        const next = [...prev];
        const idx = next.findIndex(h => h.match_round_id === myRound.id && h.hole_no === holeNo);
        const newHole: MatchHole = { id: "", match_round_id: myRound.id, hole_no: holeNo, strokes };
        if (idx >= 0) next[idx] = { ...next[idx], strokes };
        else next.push(newHole);
        return next;
      });

      if (json.completed) {
        setRounds(prev => prev.map(r => r.id === myRound.id ? { ...r, completed: true, gross_score: json.gross_score, differential: json.differential } : r));
        if (json.matchCompleted) {
          setMatch(prev => prev ? { ...prev, completed: true, status: "completed" } : prev);
        }
      }

      // Auto-advance to next hole
      if (holeNo < totalHoles) {
        const next = holeNo + 1;
        setHoleNo(next);
        const existing = allHoles.find(h => h.match_round_id === myRound.id && h.hole_no === next);
        setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
      }
    } catch (e: any) {
      setSaving(false);
      setStatus(e?.message ?? "Failed to save");
    }
  }

  async function deleteHoleScore() {
    if (!myRound) return;
    const existing = myHoles.find(h => h.hole_no === holeNo);
    if (!existing || existing.strokes == null) return;

    try {
      const tok = (await supabase.auth.getSession()).data.session?.access_token;
      await fetch(`/api/matches/${matchId}/rounds/${myRound.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ hole_no: holeNo }),
      });

      setAllHoles(prev => prev.filter(h => !(h.match_round_id === myRound.id && h.hole_no === holeNo)));
      setStrokesInput("");
    } catch (e: any) {
      setStatus(e?.message ?? "Failed to delete");
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "75ms" }} />
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "150ms" }} />
        </div>
      </div>
    );
  }

  // ---- ROUND SUBMISSION VIEW ----
  if (viewState === "submit-round") {
    return (
      <div className="space-y-6">
        <div>
          <button onClick={() => setViewState("overview")} className="text-sm text-[var(--pine)] font-medium">
            &larr; Back to match
          </button>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Submit Your Round</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Play any course, any tee. Your handicap differential determines the winner.
          </p>
        </div>

        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div className="text-[13px] text-amber-800 leading-snug space-y-1">
              <p><span className="font-bold">Any course, any tee.</span> Your score is normalized by slope and course rating.</p>
            </div>
          </div>
        </div>

        {status && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{status}</div>
        )}

        <div className="space-y-5">
          {meId && (
            <ClubPicker
              value={courseName}
              onChange={setCourseName}
              onTeesChange={setTees}
              onCourseApiIdChange={(id) => setCourseApiId(id)}
              userId={meId}
              placeholder="Search for the course you played..."
            />
          )}

          {tees.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Tees played</label>
              <div className="flex flex-wrap gap-2">
                {tees.map(t => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setSelectedTee(t.name)}
                    className={cx(
                      "rounded-xl border px-3 py-2 text-sm font-medium transition",
                      selectedTee === t.name
                        ? "border-[var(--pine)] bg-[var(--pine)]/5 text-[var(--pine)]"
                        : "border-[var(--border)] bg-white/80 text-[var(--ink)] hover:border-[var(--pine)]/30"
                    )}
                  >
                    <div>{t.name}</div>
                    {t.yards && <div className="text-[10px] text-[var(--muted)]">{t.yards} yds</div>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Course rating</label>
              <input
                type="text"
                inputMode="decimal"
                className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
                value={courseRating}
                onChange={e => setCourseRating(e.target.value)}
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
                onChange={e => setSlopeRating(e.target.value)}
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
              onChange={e => setPar(e.target.value)}
              placeholder="e.g., 72"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Date played</label>
            <input
              type="date"
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
              value={playedAt}
              onChange={e => setPlayedAt(e.target.value)}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={startRound}
              disabled={saving}
              className="rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Starting..." : "Start scoring"}
            </button>
            <button
              type="button"
              onClick={() => setViewState("overview")}
              className="rounded-xl border border-[var(--border)] bg-white px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- SCORING VIEW ----
  if (viewState === "score-round" && myRound && !myRound.completed) {
    return (
      <div className="space-y-5">
        <div>
          <button onClick={() => setViewState("overview")} className="text-sm text-[var(--pine)] font-medium">
            &larr; Back to match
          </button>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Score Your Round</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {myRound.course_name}{myRound.tee_name ? ` · ${myRound.tee_name} tees` : ""}
          </p>
        </div>

        {status && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{status}</div>
        )}

        {/* Scoring input */}
        <div className="overflow-hidden rounded-2xl border-2 border-[var(--pine)]/20 bg-gradient-to-b from-white to-[var(--paper)] shadow-sm">
          <div className="border-b border-[var(--border)] bg-[var(--pine)]/5 px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pine)] text-sm font-bold text-white">
                  {holeNo}
                </span>
                <div>
                  <div className="text-sm font-bold tracking-tight">Hole {holeNo} of {totalHoles}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {myScored.has(holeNo) ? "Scored" : "Not scored yet"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  {isMatchPlay ? "Holes won" : "Running total"}
                </div>
                <div className="text-lg font-bold text-[var(--pine)]">
                  {isMatchPlay ? (matchPlayData?.p1Won ?? 0) : (myTotal ?? 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-5">
            {activeTee && (
              <div className="mb-4 flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--paper-2)] px-4 py-2.5">
                {getHolePar(activeTee, holeNo) != null && (
                  <div className="text-xs text-[var(--muted)]">
                    Par <span className="font-bold text-[var(--ink)]">{getHolePar(activeTee, holeNo)}</span>
                  </div>
                )}
                {getHoleYards(activeTee, holeNo) != null && (
                  <div className="text-xs text-[var(--muted)]">
                    <span className="font-bold text-[var(--ink)]">{getHoleYards(activeTee, holeNo)}</span> yds
                  </div>
                )}
                {getHoleHandicap(activeTee, holeNo) != null && (
                  <div className="text-xs text-[var(--muted)]">
                    HDCP <span className="font-bold text-[var(--ink)]">{getHoleHandicap(activeTee, holeNo)}</span>
                  </div>
                )}
                {isMatchPlay && useHcp && strokeHolesMap.has(holeNo) && (
                  <div className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    {strokeReceiver === "me" ? "You get" : "Opp gets"} {strokeHolesMap.get(holeNo)} stroke{(strokeHolesMap.get(holeNo) ?? 0) > 1 ? "s" : ""}
                  </div>
                )}
                <div className="ml-auto text-[10px] text-[var(--muted)]">{myRound.tee_name} tees</div>
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your strokes</label>
                <input
                  ref={strokesInputRef}
                  className="mt-2 w-full rounded-xl border-2 border-[var(--border)] bg-white px-4 py-3.5 text-center text-2xl font-bold tracking-tight outline-none transition focus:border-[var(--pine)] focus:ring-2 focus:ring-[var(--pine)]/20"
                  inputMode="numeric"
                  value={strokesInput}
                  onChange={e => setStrokesInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveHole(); } }}
                  placeholder="0"
                />
              </div>
              <button
                className="rounded-xl bg-[var(--pine)] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
                onClick={saveHole}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {myScored.has(holeNo) && (
                <button
                  type="button"
                  onClick={deleteHoleScore}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-3.5 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                >
                  Undo
                </button>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span>Enter to save. Arrow keys to navigate holes.</span>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] disabled:opacity-40"
                onClick={() => navigateToHole(holeNo - 1)}
                disabled={holeNo <= 1}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Previous
              </button>
              <div className="text-xs font-medium text-[var(--muted)]">
                {myScored.size} of {totalHoles} scored
              </div>
              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] disabled:opacity-40"
                onClick={() => navigateToHole(holeNo + 1)}
                disabled={!myScored.has(holeNo) || holeNo >= totalHoles}
              >
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Live mini scorecard */}
        {renderMiniScorecard(myHoles, myScored, activeTee, holeNo, totalHoles, strokeHolesMap, navigateToHole)}
      </div>
    );
  }

  // ---- OVERVIEW ----
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div>
        <div className="mb-1 inline-flex items-center rounded-full bg-purple-100/80 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700">
          Different Courses
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {isMatchPlay ? "Match Play" : "Stroke Play"} Challenge
        </h1>
        <div className="mt-1 text-xs text-[var(--muted)] sm:text-sm">
          Each player plays their own course. {isMatchPlay ? "Net scores compared hole-by-hole." : "Handicap differentials compared."}
        </div>
      </div>

      {/* Format badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-black/[0.04] px-3 py-1 text-xs font-medium text-[var(--ink)]">
          {isMatchPlay ? "Match Play" : "Stroke Play"}
        </span>
        {useHcp && (
          <span className="inline-flex items-center rounded-full bg-amber-100/80 px-3 py-1 text-xs font-medium text-amber-800">
            Net Scoring (Handicap)
          </span>
        )}
        {useHcp && isMatchPlay && myHandicap != null && oppHandicap != null && strokeHolesMap.size > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            {strokeReceiver === "me" ? "You" : opponentLabel} get{strokeReceiver === "me" ? "" : "s"} {strokeHolesMap.size} stroke{strokeHolesMap.size !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Accept/decline for opponent */}
      {isOpponent && (
        <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-5 shadow-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--pine)]">Challenge Received</div>
          <p className="text-sm">
            <span className="font-semibold">{match?.creator_email || "The match creator"}</span> has challenged you.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li><span className="font-medium text-[var(--muted)]">Format:</span> {isMatchPlay ? "Match Play" : "Stroke Play"}{useHcp ? " (Net)" : ""}</li>
            <li><span className="font-medium text-[var(--muted)]">Mode:</span> Different Courses - play at any course</li>
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => respondToMatch("accept")}
              disabled={responding}
              className="rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
            >
              {responding ? "Responding..." : "Accept Challenge"}
            </button>
            {!showDecline ? (
              <button
                type="button"
                onClick={() => setShowDecline(true)}
                disabled={responding}
                className="rounded-xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:text-red-600 disabled:opacity-60"
              >
                Decline
              </button>
            ) : null}
          </div>
          {showDecline && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
              <textarea
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none"
                rows={2}
                placeholder="Reason for declining..."
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => respondToMatch("decline")} disabled={responding} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  Confirm Decline
                </button>
                <button onClick={() => { setShowDecline(false); setDeclineReason(""); }} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)]">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Waiting for opponent */}
      {isProposed && isCreator && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-4 text-sm text-amber-800">
          <span className="font-semibold">Waiting for response</span> -- your opponent has not yet accepted or declined.
        </div>
      )}

      {/* Player round cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* My card */}
        <div className={cx(
          "rounded-2xl border p-5",
          isCompleted && resultData.myWins
            ? "border-emerald-300 bg-gradient-to-br from-emerald-100 to-emerald-50 ring-2 ring-emerald-300/50"
            : "border-emerald-200/50 bg-gradient-to-br from-emerald-50/80 to-emerald-50/30"
        )}>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            You {isCompleted && resultData.myWins ? "- Winner" : isCompleted && resultData.isTie ? "- Tie" : ""}
          </div>
          {myRound ? (
            <>
              <div className="mt-2 text-sm font-medium">{myRound.course_name}</div>
              {myRound.tee_name && <div className="text-xs text-emerald-600/70">{myRound.tee_name} tees</div>}
              {isMatchPlay ? (
                <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-800">
                  {matchPlayData?.p1Won ?? 0}
                  <span className="ml-1 text-sm font-medium text-emerald-600/70">holes won</span>
                </div>
              ) : (
                <>
                  <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-800">
                    {myRound.completed ? myRound.gross_score ?? myTotal : myTotal ?? "--"}
                  </div>
                  {myRound.completed && myDiff != null && (
                    <div className="text-xs text-emerald-600/60">Differential: {myDiff}</div>
                  )}
                </>
              )}
              <div className="mt-1 text-xs text-emerald-600/60">
                {myRound.completed ? "Completed" : `${myScored.size}/${totalHoles} holes scored`}
              </div>
              {myRound.completed && (
                <div className="mt-1 text-xs text-emerald-600/40">
                  Rating: {myRound.course_rating} &middot; Slope: {myRound.slope_rating}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mt-3 text-sm text-emerald-700/70">No round submitted yet</div>
              {isActive && (
                <button
                  type="button"
                  onClick={() => setViewState("submit-round")}
                  className="mt-3 rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
                >
                  Submit your round
                </button>
              )}
            </>
          )}
          {myRound && !myRound.completed && isActive && (
            <button
              type="button"
              onClick={() => { setViewState("score-round"); setHoleNo(1); setStrokesInput(""); }}
              className="mt-3 rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px"
            >
              Continue scoring
            </button>
          )}
        </div>

        {/* Opponent card */}
        <div className={cx(
          "rounded-2xl border p-5",
          isCompleted && resultData.oppWins
            ? "border-slate-300 bg-gradient-to-br from-slate-100 to-slate-50 ring-2 ring-slate-300/50"
            : "border-slate-200/50 bg-gradient-to-br from-slate-50/80 to-slate-50/30"
        )}>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {opponentLabel} {isCompleted && resultData.oppWins ? "- Winner" : isCompleted && resultData.isTie ? "- Tie" : ""}
          </div>
          {oppRound ? (
            <>
              <div className="mt-2 text-sm font-medium">{oppRound.course_name}</div>
              {oppRound.tee_name && <div className="text-xs text-slate-400">{oppRound.tee_name} tees</div>}
              {isMatchPlay ? (
                <div className="mt-2 text-4xl font-bold tracking-tight text-slate-700">
                  {matchPlayData?.p2Won ?? "--"}
                  <span className="ml-1 text-sm font-medium text-slate-400">holes won</span>
                </div>
              ) : (
                <>
                  <div className="mt-2 text-4xl font-bold tracking-tight text-slate-700">
                    {oppRound.completed ? oppRound.gross_score ?? oppTotal : oppTotal ?? "--"}
                  </div>
                  {oppRound.completed && oppDiff != null && (
                    <div className="text-xs text-slate-400">Differential: {oppDiff}</div>
                  )}
                </>
              )}
              <div className="mt-1 text-xs text-slate-400">
                {oppRound.completed ? "Completed" : `${oppHoles.filter(h => h.strokes != null).length}/${totalHoles} holes scored`}
              </div>
              {oppRound.completed && (
                <div className="mt-1 text-xs text-slate-400/60">
                  Rating: {oppRound.course_rating} &middot; Slope: {oppRound.slope_rating}
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 text-sm text-slate-400">Waiting for opponent to submit round</div>
          )}
        </div>
      </div>

      {/* Match play live status */}
      {isMatchPlay && matchPlayData && !isCompleted && (
        <div className="rounded-2xl border border-[var(--border)] bg-white/60 px-5 py-3 text-center">
          <div className="text-sm font-semibold text-[var(--ink)]">
            {matchPlayScoreText(matchPlayData.p1Won, matchPlayData.p2Won, matchPlayData.p1Won + matchPlayData.p2Won + matchPlayData.halved)}
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            {matchPlayData.p1Won + matchPlayData.p2Won + matchPlayData.halved} holes compared &middot; {matchPlayData.halved} halved
            {useHcp ? " (net)" : ""}
          </div>
        </div>
      )}

      {/* Completed banner */}
      {isCompleted && (
        <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-center shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
            Match Complete &middot; {isMatchPlay ? "Match Play" : "Stroke Play"}{useHcp ? " (Net)" : ""}
          </div>
          <div className="mt-2 text-lg font-bold text-[var(--ink)]">
            {resultData.myWins ? "You won!" : resultData.oppWins ? "You lost." : resultData.isTie ? "It's a tie." : "Final scores are in."}
          </div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {isMatchPlay && matchPlayData ? (
              <>{matchPlayData.p1Won} - {matchPlayData.p2Won} ({matchPlayData.halved} halved){useHcp ? " with handicap strokes" : ""}</>
            ) : (
              myDiff != null && oppDiff != null && (
                <>Differential: {myDiff} vs {oppDiff}</>
              )
            )}
          </div>
        </div>
      )}

      {/* Waiting for both rounds */}
      {!isCompleted && isActive && myRound?.completed && !oppRound?.completed && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-4 text-center">
          <div className="text-sm font-semibold text-amber-800">Waiting for opponent</div>
          <div className="mt-1 text-xs text-amber-700/70">
            You&apos;ve completed your round. Waiting for {opponentLabel} to finish.
          </div>
        </div>
      )}

      {status && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{status}</div>
      )}

      <Link href="/matches" className="inline-block text-sm text-[var(--muted)] transition hover:text-[var(--ink)]">
        &larr; Back to matches
      </Link>
    </div>
  );
}

// Mini scorecard for the scoring view
function renderMiniScorecard(
  holes: MatchHole[],
  scored: Set<number>,
  tee: TeeData | null,
  currentHole: number,
  totalHoles: number,
  strokeMap: Map<number, number>,
  onNav: (h: number) => void,
) {
  const front = Array.from({ length: 9 }, (_, i) => i + 1);
  const back = Array.from({ length: 9 }, (_, i) => i + 10);

  function sumRange(holeNos: number[]) {
    let t = 0;
    for (const h of holeNos) {
      const score = holes.find(r => r.hole_no === h)?.strokes;
      if (typeof score === "number") t += score;
    }
    return scored.size > 0 ? t : 0;
  }

  function parRange(holeNos: number[]) {
    if (!tee) return null;
    let t = 0;
    for (const h of holeNos) {
      const p = getHolePar(tee, h);
      if (p == null) return null;
      t += p;
    }
    return t;
  }

  const hasTeeData = tee != null;
  const hasHdcp = hasTeeData && getHoleHandicap(tee!, 1) != null;

  const labelCx = "sticky left-0 z-10 w-[44px] min-w-[44px] max-w-[44px] px-2";
  const holeCx = "w-[28px] min-w-[28px] px-0";
  const sumW = "w-[36px] min-w-[36px] px-1.5";
  const sumCellCx = "border-l border-slate-200/80";

  function renderNine(holeNos: number[], label: string, showTotal: boolean) {
    const parTotal = parRange(holeNos);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] tabular-nums" style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
          <thead>
            <tr className="bg-slate-50/80">
              <th className={cx(labelCx, "bg-slate-50 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400")}>Hole</th>
              {holeNos.map(h => (
                <th key={h} className={cx(holeCx, "py-1.5 text-center font-semibold cursor-pointer transition", h === currentHole ? "text-emerald-600" : "text-slate-500")} onClick={() => onNav(h)}>{h}</th>
              ))}
              <th className={cx(sumW, "py-1.5 text-center font-bold text-slate-700 bg-slate-100/60", sumCellCx)}>{label}</th>
              {showTotal && <th className={cx(sumW, "py-1.5 text-center font-bold text-slate-700 bg-slate-100/60", sumCellCx)}>Tot</th>}
            </tr>
          </thead>
          <tbody>
            {hasTeeData && (
              <tr className="border-t border-slate-100 bg-white">
                <td className={cx(labelCx, "bg-white py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400")}>Par</td>
                {holeNos.map(h => (
                  <td key={h} className={cx(holeCx, "py-1 text-center text-slate-600")}>{getHolePar(tee!, h) ?? ""}</td>
                ))}
                <td className={cx(sumW, "py-1 text-center font-bold text-slate-700 bg-slate-50/60", sumCellCx)}>{parTotal ?? ""}</td>
                {showTotal && <td className={cx(sumW, "py-1 text-center font-bold text-slate-700 bg-slate-50/60", sumCellCx)}>{parRange(front) != null && parRange(back) != null ? (parRange(front)! + parRange(back)!) : ""}</td>}
              </tr>
            )}
            {hasHdcp && (
              <tr className="border-t border-slate-100 bg-[#fefcf8]">
                <td className={cx(labelCx, "bg-[#fefcf8] py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400")}>Hdcp</td>
                {holeNos.map(h => (
                  <td key={h} className={cx(holeCx, "py-1 text-center", strokeMap.has(h) ? "font-bold text-amber-600" : "text-slate-400")}>
                    {getHoleHandicap(tee!, h) ?? ""}
                    {strokeMap.has(h) && <span className="ml-px inline-block h-1 w-1 rounded-full bg-amber-500 align-super" />}
                  </td>
                ))}
                <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>
                {showTotal && <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>}
              </tr>
            )}
            <tr className="border-t-2 border-slate-200 bg-[#f4faf6]">
              <td className={cx(labelCx, "bg-[#f4faf6] py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600")}>Score</td>
              {holeNos.map(h => {
                const s = holes.find(r => r.hole_no === h)?.strokes ?? undefined;
                const par = hasTeeData ? getHolePar(tee!, h) : null;
                return (
                  <td key={h} className={cx(holeCx, "py-1.5 text-center cursor-pointer transition", h === currentHole && "bg-emerald-100/60")} onClick={() => onNav(h)}>
                    <span className={cx("relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", s != null ? diffClass(s, par) : "text-slate-200")}>
                      {s ?? "\u2013"}
                    </span>
                  </td>
                );
              })}
              <td className={cx(sumW, "py-1.5 text-center font-bold text-emerald-700 bg-emerald-50/60", sumCellCx)}>{sumRange(holeNos) || ""}</td>
              {showTotal && <td className={cx(sumW, "py-1.5 text-center font-bold text-emerald-700 bg-emerald-50/60", sumCellCx)}>{(sumRange(front) + sumRange(back)) || ""}</td>}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="bg-slate-50 px-4 py-3 flex items-center justify-between border-b border-slate-200">
        <div className="text-[13px] font-bold tracking-tight text-slate-800">Scorecard</div>
        <div className="text-[11px] text-slate-400">{scored.size}/{totalHoles} scored</div>
      </div>
      {renderNine(front, "Out", false)}
      <div className="border-t border-slate-200">
        {renderNine(back, "In", true)}
      </div>
      {strokeMap.size > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-2 flex items-center gap-3 text-[10px] text-slate-400">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Stroke</span>
        </div>
      )}
    </div>
  );
}
