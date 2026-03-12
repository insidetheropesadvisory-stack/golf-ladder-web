"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";
import dynamic from "next/dynamic";

const DifferentCoursesMatch = dynamic(() => import("./DifferentCoursesMatch"), { ssr: false });

type MatchRow = {
  id: string;
  creator_id: string;
  creator_email?: string;
  opponent_id: string | null;
  opponent_email: string;
  course_name: string;
  status: string;
  completed: boolean;
  terms_status: string | null;
  format: "stroke_play" | "match_play";
  use_handicap: boolean;
  round_time: string | null;
  guest_fee: number | null;
  is_ladder_match: boolean;
  hole_count?: number;
  golf_course_api_id?: string | number | null;
  selected_tee?: string | null;
  opponent_tee?: string | null;
  play_mode?: "same_course" | "different_courses";
};

type TeeData = {
  par?: number;
  total_yards?: number;
  totalYards?: number;
  course_rating?: number;
  courseRating?: number;
  slope?: number;
  bogey_rating?: number;
  holes?: Array<{
    number?: number;
    hole?: number;
    par?: number;
    yardage?: number;
    yards?: number;
    handicap?: number | null;
  }>;
};

type CourseData = {
  id: number;
  club_name?: string;
  course_name?: string;
  tees?: Record<string, TeeData>;
};

function getTeeRating(tee: TeeData) { return tee.course_rating ?? (tee as any).courseRating ?? null; }
function getTeeTotalYards(tee: TeeData) { return tee.total_yards ?? (tee as any).totalYards ?? null; }
function getHolePar(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.par ?? null;
}
function getHoleYards(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.yardage ?? h?.yards ?? null;
}
function getHoleHandicap(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.handicap ?? null;
}

/**
 * Build a set of hole numbers where the receiver gets a stroke,
 * based on USGA handicap hole allocation.
 * handicap index 1 = hardest hole, 18 = easiest.
 * If diff > 18, wrap around (2 strokes on hardest holes).
 */
function buildStrokeHoles(tee: TeeData | null, strokeDiff: number): Map<number, number> {
  const strokeMap = new Map<number, number>(); // holeNo → strokes received
  if (!tee?.holes || strokeDiff <= 0) return strokeMap;

  // Build sorted list of holes by handicap index (1 = hardest first)
  const holesWithHdcp = tee.holes
    .filter(h => h.handicap != null)
    .sort((a, b) => (a.handicap ?? 99) - (b.handicap ?? 99));

  if (holesWithHdcp.length === 0) {
    // Fallback: distribute strokes sequentially holes 1..N
    for (let i = 0; i < strokeDiff && i < 18; i++) {
      strokeMap.set(i + 1, (strokeMap.get(i + 1) ?? 0) + 1);
    }
    return strokeMap;
  }

  // Distribute strokes: first pass = 1 stroke per hole in handicap order,
  // second pass (if diff > 18) = 2nd stroke per hole, etc.
  let remaining = strokeDiff;
  while (remaining > 0) {
    for (const h of holesWithHdcp) {
      if (remaining <= 0) break;
      const holeNo = h.number ?? h.hole ?? 0;
      if (holeNo < 1 || holeNo > 18) continue;
      strokeMap.set(holeNo, (strokeMap.get(holeNo) ?? 0) + 1);
      remaining--;
    }
  }

  return strokeMap;
}

type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
  locked: boolean;
};

const DEFAULT_HOLES = 18;

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

/** Compute match play result: holes won by each player */
function matchPlayResult(
  rows: HoleRow[],
  player1: string,
  player2: string,
  totalHoles = DEFAULT_HOLES
): { p1Holes: number; p2Holes: number; halved: number } {
  let p1Holes = 0;
  let p2Holes = 0;
  let halved = 0;

  for (let h = 1; h <= totalHoles; h++) {
    const s1 = rows.find((r) => r.player_id === player1 && r.hole_no === h)?.strokes;
    const s2 = rows.find((r) => r.player_id === player2 && r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;
    if (s1 < s2) p1Holes++;
    else if (s2 < s1) p2Holes++;
    else halved++;
  }
  return { p1Holes, p2Holes, halved };
}

/** Compute match play result with net scoring (handicap strokes distributed by hole handicap index) */
function matchPlayNetResult(
  rows: HoleRow[],
  player1: string,
  player2: string,
  hcp1: number,
  hcp2: number,
  tee: TeeData | null,
  totalHoles = DEFAULT_HOLES
): { p1Holes: number; p2Holes: number; halved: number } {
  const diff = Math.round(Math.abs(hcp1 - hcp2));
  const receiverId = hcp1 > hcp2 ? player1 : player2;
  const strokeHoles = buildStrokeHoles(tee, diff);

  let p1Holes = 0;
  let p2Holes = 0;
  let halved = 0;

  for (let h = 1; h <= totalHoles; h++) {
    let s1 = rows.find((r) => r.player_id === player1 && r.hole_no === h)?.strokes;
    let s2 = rows.find((r) => r.player_id === player2 && r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;

    // Apply handicap strokes based on hole difficulty ranking
    const strokesOnHole = strokeHoles.get(h) ?? 0;
    if (strokesOnHole > 0) {
      if (receiverId === player1) s1 = s1 - strokesOnHole;
      else s2 = s2 - strokesOnHole;
    }

    if (s1 < s2) p1Holes++;
    else if (s2 < s1) p2Holes++;
    else halved++;
  }
  return { p1Holes, p2Holes, halved };
}

/** Format match play score text like "3 & 2" or "1 up" */
function matchPlayScoreText(
  myHoles: number,
  oppHoles: number,
  holesPlayed: number,
  totalHoles = DEFAULT_HOLES
): string {
  const diff = Math.abs(myHoles - oppHoles);
  const remaining = totalHoles - holesPlayed;

  if (diff === 0) return "All square";

  const leader = myHoles > oppHoles ? "You lead" : "Opponent leads";

  // If match is over (diff > remaining), show "X & Y"
  if (diff > remaining && remaining > 0) {
    return `${leader} ${diff} & ${remaining}`;
  }
  if (remaining === 0) {
    return `${diff} ${diff === 1 ? "hole" : "holes"} ${myHoles > oppHoles ? "up" : "down"}`;
  }
  return `${leader} ${diff} ${diff === 1 ? "hole" : "holes"}`;
}

function nextUnscoredHole(rows: HoleRow[], playerId: string, totalHoles = DEFAULT_HOLES) {
  const scored = new Set<number>();
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") {
      scored.add(r.hole_no);
    }
  }
  for (let h = 1; h <= totalHoles; h++) {
    if (!scored.has(h)) return h;
  }
  return totalHoles;
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
  const [clubId, setClubId] = useState<string | null>(null);
  const [holes, setHoles] = useState<HoleRow[]>([]);
  const totalHoles = match?.hole_count ?? DEFAULT_HOLES;

  const [holeNo, setHoleNo] = useState<number>(1);
  const [strokesInput, setStrokesInput] = useState<string>("");
  const [responding, setResponding] = useState(false);
  const [acceptTee, setAcceptTee] = useState<string | null>(null);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [myHandicap, setMyHandicap] = useState<number | null>(null);
  const [oppHandicap, setOppHandicap] = useState<number | null>(null);
  const [oppDisplayName, setOppDisplayName] = useState<string | null>(null);
  const [courseData, setCourseData] = useState<CourseData | null>(null);
  const [selectedTee, setSelectedTee] = useState<string | null>(null);
  const strokesInputRef = useRef<HTMLInputElement>(null);

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
            "id, creator_id, opponent_id, opponent_email, course_name, status, completed, terms_status, format, use_handicap, round_time, guest_fee, is_ladder_match, hole_count, golf_course_api_id, selected_tee, opponent_tee, play_mode"
          )
          .eq("id", matchId)
          .single();

        if (matchErr) {
          setStatus(matchErr.message);
          setLoading(false);
          return;
        }

        setMatch(matchData as MatchRow);

        // Look up club by course name for linking
        if (matchData.course_name) {
          supabase
            .from("clubs")
            .select("id")
            .ilike("name", matchData.course_name)
            .maybeSingle()
            .then(({ data: clubData }) => {
              if (clubData?.id) setClubId(clubData.id);
            });
        }

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

        // Load profiles for both players
        const m = matchData as MatchRow;
        const otherPlayerId = sessionUser.id === m.creator_id ? m.opponent_id : m.creator_id;
        const playerIds = [sessionUser.id, otherPlayerId].filter(Boolean) as string[];
        if (playerIds.length > 0) {
          const { data: profData } = await supabase
            .from("profiles")
            .select("id, handicap_index, display_name")
            .in("id", playerIds);
          if (profData) {
            for (const p of profData as any[]) {
              if (p.id === sessionUser.id) {
                setMyHandicap(p.handicap_index ?? null);
              } else {
                setOppHandicap(p.handicap_index ?? null);
                setOppDisplayName(p.display_name ?? null);
              }
            }
          }
        }

        // Fetch course data from Golf Course API if available
        if (m.golf_course_api_id) {
          try {
            const cRes = await fetch(`/api/golf-courses?id=${m.golf_course_api_id}`);
            if (cRes.ok) {
              const cJson = await cRes.json();
              const course = cJson.course ?? cJson;
              if (course && course.tees) {
                setCourseData(course as CourseData);
                const teeNames = Object.keys(course.tees);
                // Use per-player tee: creator uses selected_tee, opponent uses opponent_tee
                const isCreator = sessionUser.id === m.creator_id;
                const myTee = isCreator ? m.selected_tee : m.opponent_tee;
                if (myTee && teeNames.includes(myTee)) {
                  setSelectedTee(myTee);
                } else if (m.selected_tee && teeNames.includes(m.selected_tee)) {
                  setSelectedTee(m.selected_tee);
                } else if (teeNames.length > 0) {
                  setSelectedTee(teeNames[0]);
                }
              }
            }
          } catch {
            // Course data is optional; ignore failures
          }
        }

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

  // The "other player" is whoever the current user is NOT
  const oppId = useMemo(() => {
    if (!meId || !match) return null;
    if (meId === match.creator_id) return match.opponent_id;
    return match.creator_id;
  }, [meId, match]);

  const oppTotal = useMemo(
    () => sumStrokes(holes, oppId),
    [holes, oppId]
  );

  const opponentLabel = useMemo(() => {
    if (oppDisplayName) return oppDisplayName;
    if (!meId || !match) return "Opponent";
    if (meId === match.creator_id) return match.opponent_email || "Opponent";
    return "Opponent";
  }, [meId, match, oppDisplayName]);

  const isMatchPlay = match?.format === "match_play";
  const useHcp = match?.use_handicap === true;

  // Net totals (stroke play with handicap)
  const myNetTotal = useMemo(() => {
    if (!useHcp || myTotal == null || myHandicap == null) return myTotal;
    return Math.round(myTotal - myHandicap);
  }, [myTotal, myHandicap, useHcp]);

  const oppNetTotal = useMemo(() => {
    if (!useHcp || oppTotal == null || oppHandicap == null) return oppTotal;
    return Math.round(oppTotal - oppHandicap);
  }, [oppTotal, oppHandicap, useHcp]);

  // Current tee data for course info display
  const activeTee: TeeData | null = useMemo(() => {
    if (!courseData?.tees || !selectedTee) return null;
    return courseData.tees[selectedTee] ?? null;
  }, [courseData, selectedTee]);

  const teeNames = useMemo(() => {
    if (!courseData?.tees) return [];
    return Object.keys(courseData.tees).sort((a, b) => {
      const ra = courseData.tees![a]?.course_rating ?? (courseData.tees![a] as any)?.courseRating ?? 0;
      const rb = courseData.tees![b]?.course_rating ?? (courseData.tees![b] as any)?.courseRating ?? 0;
      return rb - ra;
    });
  }, [courseData]);

  // Tee locks once the player has entered any score or match is done
  const teeLocked = useMemo(() => {
    if (match?.completed || match?.status === "completed") return true;
    return myScoresByHole.size > 0;
  }, [match?.completed, match?.status, myScoresByHole.size]);

  // Handicap stroke distribution for match play
  const strokeHolesMap = useMemo(() => {
    if (!isMatchPlay || !useHcp || myHandicap == null || oppHandicap == null) return new Map<number, number>();
    const diff = Math.round(Math.abs(myHandicap - oppHandicap));
    return buildStrokeHoles(activeTee, diff);
  }, [isMatchPlay, useHcp, myHandicap, oppHandicap, activeTee]);

  // Who receives strokes
  const strokeReceiver = useMemo(() => {
    if (!useHcp || myHandicap == null || oppHandicap == null) return null;
    if (myHandicap > oppHandicap) return "me";
    if (oppHandicap > myHandicap) return "opp";
    return null;
  }, [useHcp, myHandicap, oppHandicap]);

  // Match play hole-by-hole results
  const matchPlayData = useMemo(() => {
    if (!isMatchPlay || !meId || !oppId) return null;
    if (useHcp && myHandicap != null && oppHandicap != null) {
      return matchPlayNetResult(holes, meId, oppId, myHandicap, oppHandicap, activeTee);
    }
    return matchPlayResult(holes, meId, oppId);
  }, [holes, meId, oppId, isMatchPlay, useHcp, myHandicap, oppHandicap, activeTee]);

  // The "display" totals depend on format
  const myDisplayTotal = isMatchPlay ? null : (useHcp ? myNetTotal : myTotal);
  const oppDisplayTotal = isMatchPlay ? null : (useHcp ? oppNetTotal : oppTotal);

  // Determine winner based on format
  const resultData = useMemo(() => {
    if (isMatchPlay && matchPlayData) {
      const { p1Holes, p2Holes } = matchPlayData;
      if (p1Holes > p2Holes) return { myWins: true, oppWins: false, isTie: false };
      if (p2Holes > p1Holes) return { myWins: false, oppWins: true, isTie: false };
      return { myWins: false, oppWins: false, isTie: true };
    }

    // Stroke play
    const mdt = useHcp ? myNetTotal : myTotal;
    const odt = useHcp ? oppNetTotal : oppTotal;
    if (mdt == null || odt == null) return { myWins: false, oppWins: false, isTie: false };
    return {
      myWins: mdt < odt,
      oppWins: odt < mdt,
      isTie: mdt === odt,
    };
  }, [isMatchPlay, matchPlayData, myTotal, oppTotal, myNetTotal, oppNetTotal, useHcp]);

  // Keyboard navigation for scorecard
  const navigateToHole = useCallback((h: number) => {
    if (!meId || h < 1 || h > totalHoles) return;
    setHoleNo(h);
    const existing = holes.find((r) => r.player_id === meId && r.hole_no === h);
    setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    setStatus(null);
    // Refocus the input after navigation
    setTimeout(() => strokesInputRef.current?.focus(), 50);
  }, [meId, holes]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Only handle when not in a text input other than the strokes input
      const target = e.target as HTMLElement;
      const isStrokesInput = target === strokesInputRef.current;
      const isOtherInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      if (isOtherInput && !isStrokesInput) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateToHole(holeNo - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateToHole(holeNo + 1);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [holeNo, navigateToHole]);

  function clearHole() {
    if (!matchId || !meId) return;
    setStrokesInput("");
    strokesInputRef.current?.focus();
  }

  async function deleteHoleScore() {
    if (!matchId || !meId) return;
    const existing = holes.find((r) => r.player_id === meId && r.hole_no === holeNo);
    if (!existing || existing.strokes == null) return;

    const { error } = await supabase
      .from("holes")
      .delete()
      .eq("match_id", matchId)
      .eq("hole_no", holeNo)
      .eq("player_id", meId);

    if (error) { setStatus(error.message); return; }

    setHoles((prev) => prev.filter(
      (r) => !(r.match_id === matchId && r.hole_no === holeNo && r.player_id === meId)
    ));
    setStrokesInput("");
    strokesInputRef.current?.focus();
  }

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

    const next = Math.min(totalHoles, holeNo + 1);
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
      setStatus("Enter a valid strokes number (1-20).");
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

    // Check if player just completed all 18 holes — notify opponent
    const updatedHoles = [...holes];
    for (const row of saved) {
      const idx = updatedHoles.findIndex(
        (r) => r.match_id === row.match_id && r.hole_no === row.hole_no && r.player_id === row.player_id
      );
      if (idx >= 0) updatedHoles[idx] = row;
      else updatedHoles.push(row);
    }
    const myHolesScored = new Set(
      updatedHoles.filter((r) => r.player_id === meId && r.strokes != null).map((r) => r.hole_no)
    );
    const wasComplete = myScoresByHole.size >= totalHoles;
    const nowComplete = myHolesScored.size >= totalHoles;

    if (nowComplete && !wasComplete && matchId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        fetch("/api/send-notification", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            type: "scoring_complete",
            matchId,
            matchUrl: window.location.href,
          }),
        }).catch(() => {});
      } catch {}
    }

    if (holeNo < totalHoles) {
      const nextHole = holeNo + 1;
      setHoleNo(nextHole);

      const existing = holes.find(
        (r) => r.player_id === meId && r.hole_no === nextHole
      );
      setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    }
  }

  const [completing, setCompleting] = useState(false);

  const allScoredByMe = myScoresByHole.size >= totalHoles;
  const isCompleted = match?.completed === true || match?.status === "completed";
  const isActive = match?.terms_status === "accepted" || match?.status === "active";

  const DEADLINE_MS = 12 * 60 * 60 * 1000;

  // Scoring locked until match is accepted AND tee time has arrived
  const scoringLocked = useMemo(() => {
    // Block scoring if match hasn't been accepted yet
    if (match?.terms_status === "pending" || match?.status === "proposed") return true;
    // Block scoring until tee time (if a round_time is set)
    if (!match?.round_time) return false;
    try {
      return new Date(match.round_time).getTime() > Date.now();
    } catch {
      return false;
    }
  }, [match?.round_time, match?.terms_status, match?.status]);

  // Match is expired if past the 12h deadline
  const isExpired = useMemo(() => {
    if (!match?.round_time) return false;
    if (match.status === "expired") return true;
    try {
      const deadline = new Date(match.round_time).getTime() + DEADLINE_MS;
      return Date.now() > deadline && !match.completed && match.status !== "completed";
    } catch {
      return false;
    }
  }, [match?.round_time, match?.status, match?.completed]);

  // Deadline label for active matches
  const deadlineLabel = useMemo(() => {
    if (!match?.round_time || scoringLocked || isExpired) return null;
    try {
      const deadline = new Date(match.round_time).getTime() + DEADLINE_MS;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return "Expired";
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      if (hours > 0) return `${hours}h ${mins}m remaining to score`;
      return `${mins}m remaining to score`;
    } catch {
      return null;
    }
  }, [match?.round_time, scoringLocked, isExpired]);

  const teeTimeLabel = useMemo(() => {
    if (!match?.round_time) return null;
    try {
      const d = new Date(match.round_time);
      return d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return match.round_time;
    }
  }, [match?.round_time]);

  // Count opponent scored holes
  const oppScoredCount = useMemo(() => {
    if (!oppId) return 0;
    const scored = new Set<number>();
    for (const r of holes) {
      if (r.player_id === oppId && typeof r.strokes === "number") scored.add(r.hole_no);
    }
    return scored.size;
  }, [holes, oppId]);

  const allScoredByOpp = oppScoredCount >= totalHoles;

  // Ladder matches: hide opponent scores until both players have completed all holes
  const isLadderScoreHidden = match?.is_ladder_match === true && !isCompleted && !(allScoredByMe && allScoredByOpp);

  // Match play: clinched when lead > remaining holes
  const matchPlayClinched = useMemo(() => {
    if (!isMatchPlay || !matchPlayData) return false;
    const { p1Holes, p2Holes, halved } = matchPlayData;
    const holesPlayed = p1Holes + p2Holes + halved;
    const remaining = totalHoles - holesPlayed;
    const lead = Math.abs(p1Holes - p2Holes);
    return lead > remaining;
  }, [isMatchPlay, matchPlayData]);

  // Determine if match can be completed
  const canComplete = useMemo(() => {
    if (!isActive || isCompleted) return false;
    if (isMatchPlay) {
      // Match play: both players must have scored the same holes they played,
      // AND either all 18 played or the match is clinched
      const holesPlayed = matchPlayData
        ? matchPlayData.p1Holes + matchPlayData.p2Holes + matchPlayData.halved
        : 0;
      const bothScored = allScoredByMe && allScoredByOpp;
      const bothScoredThrough = myScoresByHole.size >= holesPlayed && oppScoredCount >= holesPlayed;
      return (bothScored || (matchPlayClinched && bothScoredThrough));
    }
    // Stroke play: both players must have scored all 18 holes
    return allScoredByMe && allScoredByOpp;
  }, [isActive, isCompleted, isMatchPlay, allScoredByMe, allScoredByOpp, matchPlayClinched, matchPlayData, myScoresByHole.size, oppScoredCount]);

  async function completeMatch() {
    if (!matchId || !meId) return;
    if (!confirm("Mark this match as completed? Scores will be locked.")) return;

    setCompleting(true);
    setStatus(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/matches/${matchId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      });

      const result = await res.json();

      if (!res.ok) {
        setCompleting(false);
        setStatus(result.error ?? "Failed to complete match");
        return;
      }

      setCompleting(false);
      setMatch((prev) => prev ? { ...prev, completed: true, status: "completed" } : prev);
    } catch (e: any) {
      setCompleting(false);
      setStatus(e?.message ?? "Failed to complete match");
    }
  }

  const [deletingMatch, setDeletingMatch] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);

  // Dispute state
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDetails, setDisputeDetails] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const [disputeFiled, setDisputeFiled] = useState(false);

  const DISPUTE_REASONS = [
    "Incorrect score entered",
    "Opponent did not play the round",
    "Wrong course or tees used",
    "Handicap index is inaccurate",
    "Rules violation during play",
    "Other",
  ];

  async function submitDispute() {
    if (!matchId || !disputeReason) return;
    setSubmittingDispute(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fullReason = disputeDetails
        ? `${disputeReason} — ${disputeDetails}`
        : disputeReason;
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ type: "dispute", matchId, reason: fullReason }),
      });
      if (res.ok) {
        setDisputeFiled(true);
        setShowDispute(false);
      } else {
        const json = await res.json();
        setStatus(json.error || "Failed to submit dispute");
      }
    } catch (e: any) {
      setStatus(e?.message || "Failed to submit dispute");
    }
    setSubmittingDispute(false);
  }

  // Reschedule state
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleCourse, setRescheduleCourse] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  const canReschedule = useMemo(() => {
    if (!match || isCompleted || isExpired) return false;
    if (match.status === "expired") return false;
    // Can reschedule active or proposed matches
    const isParticipant = meId === match.creator_id || meId === match.opponent_id;
    if (!isParticipant) return false;
    // Can't reschedule if scoring started
    return holes.filter((h) => typeof h.strokes === "number").length === 0;
  }, [match, isCompleted, isExpired, meId, holes]);

  async function rescheduleMatch() {
    if (!matchId) return;
    setRescheduling(true);
    setStatus(null);

    const update: Record<string, any> = {};

    if (rescheduleDate || rescheduleTime) {
      const date = rescheduleDate || (match?.round_time ? new Date(match.round_time).toISOString().split("T")[0] : "");
      const time = rescheduleTime || "08:00";
      if (date) {
        update.round_time = `${date}T${time}:00`;
      }
    }

    if (rescheduleCourse.trim() && rescheduleCourse.trim() !== match?.course_name) {
      update.course_name = rescheduleCourse.trim();
    }

    if (Object.keys(update).length === 0) {
      setStatus("No changes to save");
      setRescheduling(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/matches/${matchId}/reschedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(update),
      });
      const json = await res.json();
      setRescheduling(false);

      if (!res.ok) {
        setStatus(json.error || "Failed to reschedule");
        return;
      }

      // Update local state
      setMatch((prev) => prev ? { ...prev, ...update } : prev);
      setShowReschedule(false);
      setRescheduleDate("");
      setRescheduleTime("");
      setRescheduleCourse("");
    } catch (e: any) {
      setRescheduling(false);
      setStatus(e?.message || "Failed to reschedule");
    }
  }

  const isProposed =
    match?.status === "proposed" || match?.terms_status === "pending";
  const isCreator = meId != null && meId === match?.creator_id;
  const canDelete = isProposed && isCreator;

  const isOpponent =
    isProposed &&
    meEmail != null &&
    match?.opponent_email != null &&
    meEmail.trim().toLowerCase() === match.opponent_email.trim().toLowerCase();

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
        ...(action === "accept" && acceptTee ? { opponent_tee: acceptTee } : {}),
      }),
    });
    const json = await res.json();
    setResponding(false);
    if (!res.ok) {
      setStatus(json.error || "Failed to respond");
      return;
    }
    if (action === "decline") {
      router.push("/matches");
    } else {
      window.location.reload();
    }
  }

  async function deleteMatch() {
    if (!matchId || !confirm("Delete this proposed match? This cannot be undone.")) return;

    setDeletingMatch(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ matchId }),
      });

      const json = await res.json();
      setDeletingMatch(false);

      if (!res.ok) {
        setStatus(json.error || "Failed to delete match");
        return;
      }

      router.push("/matches");
    } catch (e: any) {
      setDeletingMatch(false);
      setStatus(e?.message || "Failed to delete match");
    }
  }

  if (!matchId) return <div className="p-4 text-sm text-[var(--muted)]">Missing match id.</div>;

  // Route to DifferentCoursesMatch component for different_courses play mode
  if (match?.play_mode === "different_courses") {
    return <DifferentCoursesMatch matchId={matchId} />;
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-20 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "75ms" }} />
          <div className="h-24 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "150ms" }} />
        </div>
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "225ms" }} />
        <div className="h-32 animate-pulse rounded-2xl border border-[var(--border)] bg-gradient-to-br from-[var(--paper-2)] to-[var(--paper)]" style={{ animationDelay: "300ms" }} />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          {clubId ? (
            <Link
              href={`/clubs/${clubId}`}
              className="mb-1 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--pine)]"
            >
              {match?.course_name ?? "Match"}
              <span className="text-[var(--gold)]">&rsaquo;</span>
            </Link>
          ) : (
            <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              {match?.course_name ?? "Match"}
            </div>
          )}
          <h1
            className="text-[28px] font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Scorecard
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="text-[12px] text-[var(--muted)]"
              style={{ fontStyle: "italic" }}
            >
              Hole-by-hole scoring — totals update automatically
            </span>
            <span className="rounded-[3px] border border-[var(--border)] bg-[var(--paper-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--ink)]" style={{ fontFamily: "var(--font-body)" }}>
              {isMatchPlay ? "Match Play" : "Stroke Play"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {canReschedule && (
            <button
              type="button"
              onClick={() => {
                setShowReschedule(!showReschedule);
                if (!showReschedule) {
                  // Pre-fill with current values
                  if (match?.round_time) {
                    const d = new Date(match.round_time);
                    setRescheduleDate(d.toISOString().split("T")[0]);
                    setRescheduleTime(d.toTimeString().slice(0, 5));
                  }
                  setRescheduleCourse(match?.course_name || "");
                }
              }}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 hover:border-blue-300 sm:px-4 sm:py-2 sm:text-sm"
            >
              Reschedule
            </button>
          )}
          {canDelete && (
            <>
              <button
                type="button"
                onClick={async () => {
                  setSendingReminder(true);
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    await fetch("/api/send-notification", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                      },
                      body: JSON.stringify({
                        type: "pending_reminder",
                        matchId,
                        matchUrl: window.location.href,
                      }),
                    });
                    setReminderSent(true);
                  } catch {}
                  setSendingReminder(false);
                }}
                disabled={sendingReminder || reminderSent}
                className="rounded-lg border border-[var(--pine)]/20 bg-[var(--pine)]/5 px-3 py-1.5 text-xs font-semibold text-[var(--pine)] transition hover:bg-[var(--pine)]/10 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
              >
                {reminderSent ? "Reminder sent" : sendingReminder ? "Sending..." : "Send reminder"}
              </button>
              <button
                type="button"
                onClick={deleteMatch}
                disabled={deletingMatch}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 hover:border-red-300 disabled:opacity-50 sm:px-4 sm:py-2 sm:text-sm"
              >
                {deletingMatch ? "Deleting..." : "Delete"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Reschedule form */}
      {showReschedule && canReschedule && (
        <div className="rounded-2xl border-2 border-blue-200/60 bg-blue-50/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-blue-800">Reschedule match</div>
              <div className="mt-0.5 text-xs text-blue-600/70">Update the date, time, or course. Your opponent will be notified.</div>
            </div>
            <button
              type="button"
              onClick={() => setShowReschedule(false)}
              className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-600 transition hover:bg-blue-50"
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-[var(--muted)]">Date</label>
              <input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--muted)]">Time</label>
              <input
                type="time"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">Course</label>
            <input
              type="text"
              value={rescheduleCourse}
              onChange={(e) => setRescheduleCourse(e.target.value)}
              placeholder="Course name"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>

          <button
            type="button"
            onClick={rescheduleMatch}
            disabled={rescheduling}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {rescheduling ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}

      {/* Opponent: Accept / Decline challenge */}
      {isOpponent && (
        <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-5 shadow-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--pine)]">
            Challenge Received
          </div>
          <p className="text-sm text-[var(--fg)]">
            <span className="font-semibold">{match?.creator_email || "The match creator"}</span> has challenged you to a round.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--fg)]">
            <li><span className="font-medium text-[var(--muted)]">Course:</span> {clubId ? <Link href={`/clubs/${clubId}`} className="font-semibold text-[var(--pine)] underline">{match?.course_name}</Link> : match?.course_name}</li>
            <li><span className="font-medium text-[var(--muted)]">Format:</span> {match?.format === "match_play" ? "Match Play" : "Stroke Play"}</li>
            <li><span className="font-medium text-[var(--muted)]">Handicap:</span> {match?.use_handicap ? "Yes" : "No"}</li>
            {match?.round_time && (
              <li><span className="font-medium text-[var(--muted)]">Round time:</span> {new Date(match.round_time).toLocaleString()}</li>
            )}
            {match?.guest_fee != null && (
              <li><span className="font-medium text-[var(--muted)]">Guest fee:</span> <span className="font-semibold">${match.guest_fee}</span> <span className="text-xs text-[var(--muted)]">(payable at the club)</span></li>
            )}
          </ul>
          {/* Tee selection for opponent on accept */}
          {teeNames.length > 0 && (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                Select your tees
                {match?.selected_tee && <span className="ml-2 normal-case font-normal">(Creator is playing {match.selected_tee})</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {teeNames.map((name) => {
                  const tee = courseData?.tees?.[name];
                  const isActive = acceptTee === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setAcceptTee(name)}
                      className={cx(
                        "rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                        isActive
                          ? "bg-[var(--pine)] text-white shadow-sm"
                          : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--paper)]"
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              {acceptTee && (() => {
                const tee = courseData?.tees?.[acceptTee];
                if (!tee) return null;
                return (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                    {tee.slope != null && <span>Slope: <span className="font-semibold text-[var(--ink)]">{tee.slope}</span></span>}
                    {getTeeRating(tee) != null && <span>Rating: <span className="font-semibold text-[var(--ink)]">{getTeeRating(tee)}</span></span>}
                    {tee.par != null && <span>Par: <span className="font-semibold text-[var(--ink)]">{tee.par}</span></span>}
                    {getTeeTotalYards(tee) != null && <span>Yards: <span className="font-semibold text-[var(--ink)]">{getTeeTotalYards(tee)}</span></span>}
                  </div>
                );
              })()}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => respondToMatch("accept")}
                disabled={responding}
                className="rounded-xl bg-[var(--pine)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:shadow-none disabled:translate-y-0"
              >
                {responding ? "Responding..." : "Accept Challenge"}
              </button>
              {!showDecline ? (
                <button
                  type="button"
                  onClick={() => setShowDecline(true)}
                  disabled={responding}
                  className="rounded-xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--paper)] hover:border-red-200 hover:text-red-600 disabled:opacity-60"
                >
                  Decline
                </button>
              ) : null}
            </div>
            {showDecline && (
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 space-y-3">
                <div className="text-sm font-medium text-red-800">Why are you declining?</div>
                <textarea
                  className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-red-300 focus:border-red-300 focus:ring-1 focus:ring-red-200"
                  rows={2}
                  placeholder="e.g. Schedule conflict, already have a match that day..."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => respondToMatch("decline")}
                    disabled={responding}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
                  >
                    {responding ? "Declining..." : "Confirm Decline"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowDecline(false); setDeclineReason(""); }}
                    disabled={responding}
                    className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-white disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Creator: waiting indicator */}
      {isProposed && isCreator && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-4 text-sm text-amber-800">
          <span className="font-semibold">Waiting for response</span> -- your opponent has not yet accepted or declined this match.
        </div>
      )}

      {/* Format details */}
      <div className="flex flex-wrap items-center gap-2">
        {useHcp && (
          <span className="rounded-[3px] border border-[var(--gold)]/40 bg-[var(--gold-light)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--gold)]">
            Net (Handicap)
          </span>
        )}
        {useHcp && isMatchPlay && myHandicap != null && oppHandicap != null && Math.round(Math.abs(myHandicap - oppHandicap)) > 0 && (
          <span className="rounded-[3px] border border-[var(--gold)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--gold)]">
            {strokeReceiver === "me" ? "You" : opponentLabel} get{strokeReceiver === "me" ? "" : "s"} {Math.round(Math.abs(myHandicap - oppHandicap))} stroke{Math.round(Math.abs(myHandicap - oppHandicap)) !== 1 ? "s" : ""}
          </span>
        )}
        {match?.guest_fee != null && !isCreator && (
          <span className="rounded-[3px] border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
            Guest fee: ${match.guest_fee}
          </span>
        )}
      </div>

      {/* Tee info */}
      {teeNames.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="section-flag section-flag--green">Your tees</div>
            <div className="flex-1 h-[2px] bg-[var(--gold)]/30" />
            {teeLocked && (
              <span className="rounded-[3px] border border-[var(--gold)]/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
                Locked
              </span>
            )}
          </div>
          {!teeLocked && !isCompleted && (
            <div className="text-[11px] text-[var(--muted)]" style={{ fontStyle: "italic" }}>
              Tee selection locks once you enter your first score.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {teeNames.map((name) => {
              const isActive = selectedTee === name;
              const isGoldTee = name.toLowerCase() === "gold" || name.toLowerCase() === "golden";
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    if (teeLocked) return;
                    setSelectedTee(name);
                    if (matchId && meId && match) {
                      const field = meId === match.creator_id ? "selected_tee" : "opponent_tee";
                      supabase.from("matches").update({ [field]: name }).eq("id", matchId).then(() => {
                        setMatch((prev) => prev ? { ...prev, [field]: name } : prev);
                      });
                    }
                  }}
                  disabled={teeLocked}
                  className={cx(
                    "rounded-[3px] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.08em] transition",
                    isActive
                      ? isGoldTee ? "bg-[var(--gold)] text-[var(--pine)]" : "bg-[var(--pine)] text-[var(--paper)]"
                      : teeLocked
                        ? "border border-[var(--border)] bg-[var(--paper)] text-[var(--muted)] cursor-not-allowed"
                        : "border border-[var(--border)] bg-[var(--paper-2)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--ink)]/20"
                  )}
                  style={{ fontFamily: "var(--font-body)" }}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {activeTee && (
            <div className="flex items-center divide-x divide-[var(--border)] text-[12px]">
              {[
                activeTee.slope != null && { label: "Slope", value: activeTee.slope },
                getTeeRating(activeTee) != null && { label: "Rating", value: getTeeRating(activeTee) },
                activeTee.par != null && { label: "Par", value: activeTee.par },
                getTeeTotalYards(activeTee) != null && { label: "Yards", value: getTeeTotalYards(activeTee)?.toLocaleString() },
              ].filter(Boolean).map((s: any, i) => (
                <div key={s.label} className={cx("flex items-center gap-1.5", i > 0 ? "pl-3" : "", "pr-3")}>
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">{s.label}</span>
                  <span className="font-bold text-[var(--pine)]">{s.value}</span>
                </div>
              ))}
            </div>
          )}
          {/* Show opponent's tee if different */}
          {(() => {
            const oppTeeName = meId === match?.creator_id ? match?.opponent_tee : match?.selected_tee;
            if (oppTeeName && oppTeeName !== selectedTee) {
              const oppTee = courseData?.tees?.[oppTeeName];
              return (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  {opponentLabel} is playing <span className="font-semibold text-[var(--ink)]">{oppTeeName}</span> tees
                  {oppTee && getTeeRating(oppTee) != null && <span className="ml-2">(Rating: {getTeeRating(oppTee)}, Slope: {oppTee.slope})</span>}
                </div>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* Score summary cards */}
      <div className="grid grid-cols-2 gap-3">
        {(() => {
          const { myWins, oppWins, isTie } = isCompleted ? resultData : { myWins: false, oppWins: false, isTie: false };

          return (
            <>
              {/* YOU card — dark green */}
              <div className="relative rounded-[6px] bg-[var(--pine)] p-4 overflow-hidden">
                {myHandicap != null && (
                  <div className="absolute top-3 right-3 rounded-[3px] bg-[var(--gold)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--pine)]">
                    {myHandicap}
                  </div>
                )}
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">
                  You {isCompleted && myWins ? "— Winner" : isCompleted && isTie ? "— Tie" : ""}
                </div>
                {isMatchPlay ? (
                  <>
                    <div className="mt-2 text-[48px] leading-none tracking-tight text-[var(--paper)]" style={{ fontFamily: "var(--font-heading)" }}>
                      {matchPlayData ? matchPlayData.p1Holes : 0}
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--paper)]/50">holes won</div>
                  </>
                ) : (
                  <>
                    <div className="mt-2 text-[48px] leading-none tracking-tight text-[var(--paper)]" style={{ fontFamily: "var(--font-heading)" }}>
                      {useHcp ? myNetTotal ?? 0 : myTotal ?? 0}
                    </div>
                    {useHcp && myTotal != null && myHandicap != null && (
                      <div className="mt-1 text-[11px] text-[var(--paper)]/40">
                        Gross: {myTotal}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[11px] text-[var(--paper)]/40">{meEmail ?? ""}</div>
                  </>
                )}
              </div>

              {/* OPPONENT card — white */}
              {oppId ? (
                <Link
                  href={`/players/${oppId}`}
                  className="relative rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-4 block transition hover:shadow-sm hover:-translate-y-px"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                      Opponent {isCompleted && oppWins ? "— Winner" : isCompleted && isTie ? "— Tie" : ""}
                    </div>
                    <svg className="h-3.5 w-3.5 text-[var(--gold)]" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                  {isLadderScoreHidden ? (
                    <div className="mt-3 flex flex-col items-center gap-2 py-2">
                      <div className="flex items-center gap-2 rounded-full bg-[var(--pine)] px-4 py-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--gold)]">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
                        </svg>
                        <span className="text-[12px] font-bold text-[var(--gold)]">Awaiting opponent</span>
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">
                        Scores revealed when both players finish
                      </div>
                    </div>
                  ) : isMatchPlay ? (
                    <>
                      <div className="mt-2 text-[48px] leading-none tracking-tight text-[var(--pine)]" style={{ fontFamily: "var(--font-heading)" }}>
                        {matchPlayData ? matchPlayData.p2Holes : "—"}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--muted)]">holes won</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-2 text-[48px] leading-none tracking-tight text-[var(--pine)]" style={{ fontFamily: "var(--font-heading)" }}>
                        {useHcp ? (oppNetTotal ?? "—") : (oppTotal ?? "—")}
                      </div>
                      {useHcp && oppTotal != null && oppHandicap != null && (
                        <div className="mt-1 text-[11px] text-[var(--muted)]">
                          Gross: {oppTotal} &middot; HCP: {oppHandicap}
                        </div>
                      )}
                      <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                        {opponentLabel}
                      </div>
                    </>
                  )}
                </Link>
              ) : (
                <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-4">
                  <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    Opponent
                  </div>
                  <div className="mt-2 text-[48px] leading-none tracking-tight text-[var(--muted)]" style={{ fontFamily: "var(--font-heading)" }}>—</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">Not linked yet</div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Match play live status */}
      {isMatchPlay && matchPlayData && !isCompleted && (
        <div className="rounded-2xl border border-[var(--border)] bg-white/60 px-5 py-3 text-center">
          <div className="text-sm font-semibold text-[var(--ink)]">
            {matchPlayScoreText(matchPlayData.p1Holes, matchPlayData.p2Holes, matchPlayData.p1Holes + matchPlayData.p2Holes + matchPlayData.halved)}
          </div>
          <div className="mt-0.5 text-xs text-[var(--muted)]">
            {matchPlayData.p1Holes + matchPlayData.p2Holes + matchPlayData.halved} holes played &middot; {matchPlayData.halved} halved
            {useHcp ? " (net)" : ""}
          </div>
        </div>
      )}

      {/* Expired banner */}
      {isExpired && !isCompleted && (
        <div className="rounded-2xl border-2 border-red-200 bg-gradient-to-br from-red-50 to-white p-5 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-red-800">Match Expired</div>
          <div className="mt-1 text-sm text-red-600/80">
            The 12-hour scoring window has closed. Scores were not submitted in time.
          </div>
          <Link
            href="/matches"
            className="mt-4 inline-flex items-center rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            Back to matches
          </Link>
        </div>
      )}

      {/* Scoring deadline countdown */}
      {!isCompleted && !isExpired && !scoringLocked && deadlineLabel && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-3 flex items-center gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <div>
            <div className="text-sm font-semibold text-amber-800">{deadlineLabel}</div>
            <div className="text-xs text-amber-700/70">Scores must be entered within 12 hours of tee time or the match expires.</div>
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
              <>
                {matchPlayData.p1Holes} - {matchPlayData.p2Holes} ({matchPlayData.halved} halved)
                {useHcp ? " with handicap strokes" : ""}
              </>
            ) : (
              myDisplayTotal != null && oppDisplayTotal != null && (
                <>
                  {myDisplayTotal} vs {oppDisplayTotal}
                  {useHcp ? " (net)" : ""}
                  {" "}({Math.abs(myDisplayTotal - oppDisplayTotal)} stroke{Math.abs(myDisplayTotal - oppDisplayTotal) !== 1 ? "s" : ""} {myDisplayTotal < oppDisplayTotal ? "ahead" : myDisplayTotal > oppDisplayTotal ? "behind" : "even"})
                </>
              )
            )}
          </div>
        </div>
      )}

      {/* Full 18-hole scorecard summary (completed matches) */}
      {isCompleted && (() => {
        const myHoleScores = new Map<number, number>();
        const oppHoleScores = new Map<number, number>();
        for (const r of holes) {
          if (r.player_id === meId && typeof r.strokes === "number") myHoleScores.set(r.hole_no, r.strokes);
          if (r.player_id === oppId && typeof r.strokes === "number") oppHoleScores.set(r.hole_no, r.strokes);
        }

        const front = Array.from({ length: 9 }, (_, i) => i + 1);
        const back = Array.from({ length: 9 }, (_, i) => i + 10);

        function sumRange(scores: Map<number, number>, holeNos: number[]) {
          let t = 0;
          for (const h of holeNos) { t += scores.get(h) ?? 0; }
          return t;
        }
        function parForRange(holeNos: number[]) {
          if (!activeTee) return null;
          let t = 0;
          for (const h of holeNos) { const p = getHolePar(activeTee, h); if (p == null) return null; t += p; }
          return t;
        }
        function yardsForRange(holeNos: number[]) {
          if (!activeTee) return null;
          let t = 0;
          for (const h of holeNos) { const y = getHoleYards(activeTee, h); if (y == null) return null; t += y; }
          return t;
        }

        const parOut = parForRange(front);
        const parIn = parForRange(back);
        const yardsOut = yardsForRange(front);
        const yardsIn = yardsForRange(back);

        function diffClass(strokes: number | undefined, par: number | null) {
          if (strokes == null || par == null) return "";
          const d = strokes - par;
          if (d <= -2) return "font-bold text-white";
          if (d === -1) return "font-bold text-white";
          if (d === 0) return "text-[var(--ink)]";
          if (d === 1) return "text-[var(--muted)]";
          return "font-bold text-white";
        }
        function diffBg(strokes: number | undefined, par: number | null) {
          if (strokes == null || par == null) return "";
          const d = strokes - par;
          if (d <= -2) return "bg-[var(--gold)]";
          if (d === -1) return "bg-[var(--pine)]";
          if (d === 0) return "bg-white border border-[var(--border)]";
          if (d === 1) return "bg-[#F0EADD]";
          return "bg-[#8B1A1A]";
        }

        const hasTeeData = activeTee != null;
        const hasYards = hasTeeData && getHoleYards(activeTee!, 1) != null;
        const hasHdcp = hasTeeData && getHoleHandicap(activeTee!, 1) != null;

        const sumCellCx = "border-l border-[var(--border)]/60";

        const labelCx = "sticky left-0 z-10 w-[44px] min-w-[44px] max-w-[44px] px-2";
        const holeCx = "w-[28px] min-w-[28px] px-0";
        const sumW = "w-[36px] min-w-[36px] px-1.5";

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
                        <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--gold)]")}>{getHoleYards(activeTee!, h) ?? ""}</td>
                      ))}
                      <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{yardsTotal ?? ""}</td>
                      {showTotal && <td className={cx(sumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", sumCellCx)}>{getTeeTotalYards(activeTee!) ?? ""}</td>}
                    </tr>
                  )}
                  {hasTeeData && (
                    <tr className="border-t border-[var(--border)]/40 bg-[var(--paper-2)]">
                      <td className={cx(labelCx, "bg-[var(--paper-2)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]")}>Par</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(holeCx, "py-1 text-center text-[var(--ink)]")}>{getHolePar(activeTee!, h) ?? ""}</td>
                      ))}
                      <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{parTotal ?? ""}</td>
                      {showTotal && <td className={cx(sumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", sumCellCx)}>{parOut != null && parIn != null ? parOut + parIn : ""}</td>}
                    </tr>
                  )}
                  {hasHdcp && (
                    <tr className="border-t border-[var(--border)]/40 bg-[#fefcf8]">
                      <td className={cx(labelCx, "bg-[#fefcf8] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Hdcp</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(holeCx, "py-1 text-center", strokeHolesMap.has(h) ? "font-bold text-[var(--gold)]" : "text-[var(--muted)]")}>
                          {getHoleHandicap(activeTee!, h) ?? ""}
                          {strokeHolesMap.has(h) && <span className="ml-px inline-block h-1 w-1 rounded-full bg-[var(--gold)] align-super" />}
                        </td>
                      ))}
                      <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>
                      {showTotal && <td className={cx(sumW, "py-1 bg-[#fdf9f0]", sumCellCx)}></td>}
                    </tr>
                  )}
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--pine)]/5">
                    <td className={cx(labelCx, "bg-[var(--pine)]/5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pine)]")}>You</td>
                    {holeNos.map(h => {
                      const s = myHoleScores.get(h);
                      const par = hasTeeData ? getHolePar(activeTee!, h) : null;
                      return (
                        <td key={h} className={cx(holeCx, "py-1.5 text-center")}>
                          <span className={cx("relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", s != null ? diffClass(s, par) : "text-[var(--muted)]/30", s != null ? diffBg(s, par) : "")}>
                            {s ?? ""}
                          </span>
                        </td>
                      );
                    })}
                    <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{sumRange(myHoleScores, holeNos) || ""}</td>
                    {showTotal && <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", sumCellCx)}>{myTotal ?? ""}</td>}
                  </tr>
                  <tr className="border-t border-[var(--border)]/40 bg-[var(--paper)]/50">
                    <td className={cx(labelCx, "bg-[var(--paper)]/50 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] truncate")}>{opponentLabel}</td>
                    {holeNos.map(h => {
                      const s = oppHoleScores.get(h);
                      const par = hasTeeData ? getHolePar(activeTee!, h) : null;
                      return (
                        <td key={h} className={cx(holeCx, "py-1.5 text-center")}>
                          <span className={cx("relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]", s != null ? diffClass(s, par) : "text-[var(--muted)]/30", s != null ? diffBg(s, par) : "")}>
                            {s ?? ""}
                          </span>
                        </td>
                      );
                    })}
                    <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--muted)] bg-[var(--paper)]/50", sumCellCx)}>{sumRange(oppHoleScores, holeNos) || ""}</td>
                    {showTotal && <td className={cx(sumW, "py-1.5 text-center font-bold text-[var(--muted)] bg-[var(--paper)]/50", sumCellCx)}>{oppTotal ?? ""}</td>}
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
                  {selectedTee && <span className="font-medium text-[#F5F0E8]">{selectedTee}</span>}
                  {selectedTee && <span className="text-[var(--gold)]">&middot;</span>}
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

              <div className="border-t border-[var(--border)]/60 bg-[var(--paper)] px-4 py-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
                <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Eagle+</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--pine)]" /> Birdie</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)] bg-white" /> Par</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F0EADD]" /> Bogey</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#8B1A1A]" /> Dbl+</span>
                {strokeHolesMap.size > 0 && (
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Stroke</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Complete match button */}
      {!isCompleted && !isExpired && isActive && canComplete && (
        <div className="rounded-2xl border-2 border-[var(--pine)]/30 bg-gradient-to-br from-[var(--pine)]/5 to-white p-5 text-center">
          <div className="text-sm font-semibold text-[var(--ink)]">
            {isMatchPlay && matchPlayClinched ? "Match clinched!" : "All holes scored!"}
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {isMatchPlay && matchPlayData ? (
              <>Holes won: {matchPlayData.p1Holes} - {matchPlayData.p2Holes} ({matchPlayData.halved} halved){useHcp ? " (net)" : ""}</>
            ) : (
              <>
                Your {useHcp ? "net " : ""}total: {useHcp ? myNetTotal : myTotal}
                {" "}&middot;{" "}
                {match?.is_ladder_match ? "Opponent score will be revealed" : <>Opponent: {useHcp ? oppNetTotal : oppTotal}</>}
                {" "}&middot; Ready to finalize?
              </>
            )}
          </div>
          <button
            type="button"
            onClick={completeMatch}
            disabled={completing}
            className="mt-4 rounded-xl bg-[var(--pine)] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
          >
            {completing ? "Completing..." : "Complete Match"}
          </button>
        </div>
      )}

      {/* Waiting for opponent scores */}
      {!isCompleted && !isExpired && isActive && allScoredByMe && !canComplete && (
        <div className="rounded-[6px] bg-[var(--pine)] border-l-[3px] border-l-[var(--gold)] px-5 py-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--gold)]">Waiting for opponent</div>
          <div className="mt-1 text-[12px] text-[var(--paper)]/60">
            {match?.is_ladder_match
              ? "You\u2019ve scored all your holes. Your opponent\u2019s progress is hidden until they finish."
              : <>You&apos;ve scored all your holes. Your opponent has scored {oppScoredCount} of {totalHoles}.</>
            }
          </div>
        </div>
      )}

      {/* Scoring locked — pending acceptance or tee time */}
      {!isCompleted && scoringLocked && !isProposed && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--pine)]/10">
            <svg className="h-6 w-6 text-[var(--pine)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-[var(--ink)]">Scoring opens at tee time</div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            Scoring will be available closer to your tee time on{" "}
            <span className="font-medium text-[var(--ink)]">{teeTimeLabel}</span>.
          </div>
        </div>
      )}

      {/* Scoring locked — waiting for opponent to accept */}
      {!isCompleted && isProposed && !isOpponent && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-amber-800">Waiting for opponent to accept</div>
          <div className="mt-1 text-sm text-amber-700/70">
            Scoring will open once {opponentLabel} accepts this match.
          </div>
        </div>
      )}

      {/* Scoring input area */}
      {!isCompleted && !scoringLocked && !isExpired && (
        <div className="overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] shadow-sm">
          {/* Hole header */}
          <div className="border-b border-[var(--border)] bg-[var(--paper)] px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--pine)] shadow-sm"
                  style={{ fontFamily: "var(--font-heading)", fontSize: "16px", fontWeight: 600 }}
                >
                  {holeNo}
                </span>
                <div>
                  <div className="text-[16px] font-semibold text-[var(--ink)]" style={{ fontFamily: "var(--font-heading)" }}>
                    Hole {holeNo} of {totalHoles}
                  </div>
                  <div className="text-[11px]">
                    {myScoresByHole.has(holeNo)
                      ? <span className="pill-live">Scored</span>
                      : <span className="text-[var(--muted)]">Not scored yet</span>
                    }
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                  {isMatchPlay ? "Holes won" : useHcp ? "Net total" : "Running total"}
                </div>
                <div
                  className="text-[28px] leading-none text-[var(--pine)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {isMatchPlay ? (matchPlayData?.p1Holes ?? 0) : (useHcp ? myNetTotal ?? 0 : myTotal ?? 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4">
            {/* Par / Yards / Tee info strip */}
            {activeTee && (
              <div className="mb-4 rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] px-3.5 py-2.5">
                <div className="flex items-center gap-0 text-[12px]">
                  {getHolePar(activeTee, holeNo) != null && (
                    <span>Par <span className="font-bold text-[var(--ink)]">{getHolePar(activeTee, holeNo)}</span></span>
                  )}
                  {getHoleYards(activeTee, holeNo) != null && (
                    <><span className="mx-2 text-[var(--gold)]">&middot;</span><span><span className="font-bold text-[var(--ink)]">{getHoleYards(activeTee, holeNo)}</span> yds</span></>
                  )}
                  {getHoleHandicap(activeTee, holeNo) != null && (
                    <><span className="mx-2 text-[var(--gold)]">&middot;</span><span className="text-[var(--muted)]">HDCP {getHoleHandicap(activeTee, holeNo)}</span></>
                  )}
                  {isMatchPlay && useHcp && strokeHolesMap.has(holeNo) && (
                    <><span className="mx-2 text-[var(--gold)]">&middot;</span><span className="font-bold text-[var(--gold)]">{strokeReceiver === "me" ? "You" : "Opp"} +{strokeHolesMap.get(holeNo)}</span></>
                  )}
                  <span className="ml-auto text-[10px] text-[var(--muted)]">{selectedTee} tees</span>
                </div>
              </div>
            )}

            {/* Strokes input */}
            <div className="mb-1">
              <div className="section-flag section-flag--green text-[8px]">Your strokes</div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <input
                  ref={strokesInputRef}
                  className="w-full rounded-[3px] border border-[var(--border)] bg-[var(--paper)] px-4 py-3.5 text-center outline-none transition focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold)]/20"
                  style={{ fontFamily: "var(--font-heading)", fontSize: "36px" }}
                  inputMode="numeric"
                  value={strokesInput}
                  onChange={(e) => setStrokesInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveHole(); }
                  }}
                  placeholder="0"
                />
              </div>

              <button
                className="btn-gold rounded-[3px] px-6 py-3.5 text-[13px] shadow-sm transition hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:shadow-none disabled:translate-y-0"
                onClick={saveHole}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {myScoresByHole.has(holeNo) && !isCompleted && (
                <button
                  type="button"
                  onClick={deleteHoleScore}
                  className="rounded-[3px] border border-[var(--ink)]/20 bg-[var(--paper-2)] px-3 py-3.5 text-[13px] font-bold uppercase tracking-[0.04em] text-[var(--ink)] transition hover:bg-[var(--paper)]"
                  title="Remove score for this hole"
                >
                  Undo
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--muted)]">
              <span style={{ fontStyle: "italic" }}>Enter to save. Arrow keys to navigate holes.</span>
              {strokesInput && (
                <button type="button" onClick={clearHole} className="text-[var(--muted)] hover:text-[var(--ink)] transition">
                  Clear
                </button>
              )}
            </div>

            {/* Prev / Next navigation */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                className="flex items-center gap-1.5 rounded-[3px] border border-[var(--border)] bg-[var(--paper-2)] px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.04em] transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goPrev}
                disabled={holeNo <= 1}
              >
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Prev
              </button>

              <div className="text-[11px] font-semibold text-[var(--gold)]">
                {myScoresByHole.size} of {totalHoles} scored
              </div>

              <button
                className="flex items-center gap-1.5 rounded-[3px] border border-[var(--border)] bg-[var(--paper-2)] px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.04em] transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goNext}
                disabled={!myScoresByHole.has(holeNo) || holeNo >= totalHoles}
              >
                Next
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live scorecard - classic golf scorecard layout */}
      {!scoringLocked && !isExpired && (() => {
        const front = Array.from({ length: 9 }, (_, i) => i + 1);
        const back = Array.from({ length: 9 }, (_, i) => i + 10);

        function sumMyRange(holeNos: number[]) {
          let t = 0;
          for (const h of holeNos) t += myScoresByHole.get(h) ?? 0;
          return myScoresByHole.size > 0 ? t : 0;
        }
        function parRange(holeNos: number[]) {
          if (!activeTee) return null;
          let t = 0;
          for (const h of holeNos) {
            const p = getHolePar(activeTee, h);
            if (p == null) return null;
            t += p;
          }
          return t;
        }
        function yardsRange(holeNos: number[]) {
          if (!activeTee) return null;
          let t = 0;
          for (const h of holeNos) {
            const y = getHoleYards(activeTee, h);
            if (y == null) return null;
            t += y;
          }
          return t;
        }

        function liveDiffClass(strokes: number | undefined, par: number | null) {
          if (strokes == null || par == null) return "";
          const d = strokes - par;
          if (d <= -2) return "font-bold text-white";
          if (d === -1) return "font-bold text-white";
          if (d === 0) return "text-[var(--ink)]";
          if (d === 1) return "text-[var(--muted)]";
          return "font-bold text-white";
        }
        function liveDiffBg(strokes: number | undefined, par: number | null) {
          if (strokes == null || par == null) return "";
          const d = strokes - par;
          if (d <= -2) return "bg-[var(--gold)]";
          if (d === -1) return "bg-[var(--pine)]";
          if (d === 0) return "bg-white border border-[var(--border)]";
          if (d === 1) return "bg-[#F0EADD]";
          return "bg-[#8B1A1A]";
        }

        const hasTeeData = activeTee != null;
        const hasYards = hasTeeData && getHoleYards(activeTee!, 1) != null;
        const hasHdcp = hasTeeData && getHoleHandicap(activeTee!, 1) != null;

        const frontPar = parRange(front);
        const backPar = parRange(back);
        const frontYards = yardsRange(front);
        const backYards = yardsRange(back);

        const liveLabelCx = "sticky left-0 z-10 w-[44px] min-w-[44px] max-w-[44px] px-2";
        const liveHoleCx = "w-[28px] min-w-[28px] px-0";
        const liveSumW = "w-[36px] min-w-[36px] px-1.5";
        const liveSumCx = "border-l border-[var(--border)]/60";

        function renderLiveNine(holeNos: number[], label: string, parTotal: number | null, yardsTotal: number | null, showTotal: boolean) {
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] tabular-nums" style={{ fontFamily: "var(--font-body), sans-serif" }}>
                <thead>
                  <tr className="bg-[var(--pine)]">
                    <th className={cx(liveLabelCx, "bg-[var(--pine)] py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#F5F0E8]")}>Hole</th>
                    {holeNos.map(h => (
                      <th
                        key={h}
                        className={cx(liveHoleCx, "py-1.5 text-center font-semibold cursor-pointer transition", h === holeNo ? "text-[var(--gold)]" : "text-[#F5F0E8]")}
                        onClick={() => navigateToHole(h)}
                      >{h}</th>
                    ))}
                    <th className={cx(liveSumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", liveSumCx)}>{label}</th>
                    {showTotal && <th className={cx(liveSumW, "py-1.5 text-center font-bold text-[#F5F0E8] bg-[var(--pine)]", liveSumCx)}>Tot</th>}
                  </tr>
                </thead>
                <tbody>
                  {hasYards && (
                    <tr className="border-t border-[var(--border)]/40 bg-[var(--paper)]">
                      <td className={cx(liveLabelCx, "bg-[var(--paper)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Yds</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(liveHoleCx, "py-1 text-center", h === holeNo ? "font-semibold text-[var(--gold)]" : "text-[var(--gold)]")}>{getHoleYards(activeTee!, h) ?? ""}</td>
                      ))}
                      <td className={cx(liveSumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", liveSumCx)}>{yardsTotal ?? ""}</td>
                      {showTotal && <td className={cx(liveSumW, "py-1 text-center font-semibold text-[var(--gold)] bg-[var(--paper)]", liveSumCx)}>{getTeeTotalYards(activeTee!) ?? ""}</td>}
                    </tr>
                  )}
                  {hasTeeData && (
                    <tr className="border-t border-[var(--border)]/40 bg-[var(--paper-2)]">
                      <td className={cx(liveLabelCx, "bg-[var(--paper-2)] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]")}>Par</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(liveHoleCx, "py-1 text-center", h === holeNo ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]")}>{getHolePar(activeTee!, h) ?? ""}</td>
                      ))}
                      <td className={cx(liveSumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", liveSumCx)}>{parTotal ?? ""}</td>
                      {showTotal && <td className={cx(liveSumW, "py-1 text-center font-bold text-[var(--ink)] bg-[var(--paper)]/60", liveSumCx)}>{frontPar != null && backPar != null ? frontPar + backPar : ""}</td>}
                    </tr>
                  )}
                  {hasHdcp && (
                    <tr className="border-t border-[var(--border)]/40 bg-[#fefcf8]">
                      <td className={cx(liveLabelCx, "bg-[#fefcf8] py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--gold)]")}>Hdcp</td>
                      {holeNos.map(h => (
                        <td key={h} className={cx(liveHoleCx, "py-1 text-center", strokeHolesMap.has(h) ? "font-bold text-[var(--gold)]" : "text-[var(--muted)]")}>
                          {getHoleHandicap(activeTee!, h) ?? ""}
                          {strokeHolesMap.has(h) && <span className="ml-px inline-block h-1 w-1 rounded-full bg-[var(--gold)] align-super" />}
                        </td>
                      ))}
                      <td className={cx(liveSumW, "py-1 bg-[#fdf9f0]", liveSumCx)}></td>
                      {showTotal && <td className={cx(liveSumW, "py-1 bg-[#fdf9f0]", liveSumCx)}></td>}
                    </tr>
                  )}
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--pine)]/5">
                    <td className={cx(liveLabelCx, "bg-[var(--pine)]/5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--pine)]")}>Score</td>
                    {holeNos.map(h => {
                      const s = myScoresByHole.get(h);
                      const par = hasTeeData ? getHolePar(activeTee!, h) : null;
                      return (
                        <td
                          key={h}
                          className={cx(liveHoleCx, "py-1.5 text-center cursor-pointer transition", h === holeNo && "bg-[var(--gold)]/10")}
                          onClick={() => navigateToHole(h)}
                        >
                          <span className={cx(
                            "relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                            s != null ? liveDiffClass(s, par) : "text-[var(--muted)]/30",
                            s != null ? liveDiffBg(s, par) : ""
                          )}>
                            {s ?? "\u2013"}
                          </span>
                        </td>
                      );
                    })}
                    <td className={cx(liveSumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", liveSumCx)}>{sumMyRange(holeNos) || ""}</td>
                    {showTotal && <td className={cx(liveSumW, "py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--pine)]/5", liveSumCx)}>{(sumMyRange(front) + sumMyRange(back)) || ""}</td>}
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
                  {selectedTee && <span className="font-medium text-[#F5F0E8]">{selectedTee}</span>}
                  {selectedTee && <span className="text-[var(--gold)]">&middot;</span>}
                  <span>{myScoresByHole.size}/{totalHoles} scored</span>
                </div>
              </div>

              {!hasTeeData && (
                <div className="px-4 py-2.5 text-[11px] text-[var(--muted)] bg-[var(--paper)] border-b border-[var(--border)]/60">
                  Course data unavailable — hole details not shown.
                </div>
              )}

              {/* Front 9 */}
              {renderLiveNine(front, "Out", frontPar, frontYards, false)}

              {/* Back 9 */}
              <div className="border-t-2 border-[var(--border)]">
                {renderLiveNine(back, "In", backPar, backYards, true)}
              </div>

              {/* Legend */}
              {hasTeeData && (
                <div className="border-t border-[var(--border)]/60 bg-[var(--paper)] px-4 py-2 flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Eagle+</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--pine)]" /> Birdie</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)] bg-white" /> Par</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F0EADD]" /> Bogey</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#8B1A1A]" /> Dbl+</span>
                  {strokeHolesMap.size > 0 && (
                    <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[var(--gold)]" /> Stroke</span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Dispute match */}
      {(isActive || isCompleted) && !disputeFiled && (
        <div className="pt-2">
          {!showDispute ? (
            <button
              type="button"
              onClick={() => setShowDispute(true)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--muted)]/60 underline decoration-dotted underline-offset-2 transition hover:text-[#8B1A1A]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              Flag this match
            </button>
          ) : (
            <div className="rounded-2xl border border-red-200/60 bg-red-50/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-red-800">Dispute this match</div>
                  <div className="mt-0.5 text-xs text-red-600/70">Both players and a platform admin will be notified.</div>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowDispute(false); setDisputeReason(""); setDisputeDetails(""); }}
                  className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-red-700 mb-1.5">Reason</label>
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-red-300 focus:ring-1 focus:ring-red-200"
                >
                  <option value="">Select a reason...</option>
                  {DISPUTE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {disputeReason && (
                <div>
                  <label className="block text-xs font-medium text-red-700 mb-1.5">Details (optional)</label>
                  <textarea
                    className="w-full rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-red-300 focus:border-red-300 focus:ring-1 focus:ring-red-200"
                    rows={2}
                    placeholder="Add any additional context..."
                    value={disputeDetails}
                    onChange={(e) => setDisputeDetails(e.target.value)}
                  />
                </div>
              )}

              <div className="rounded-xl bg-red-100/60 px-4 py-3 text-[11px] text-red-700 leading-relaxed">
                <span className="font-semibold">Warning:</span> Filing a false or frivolous dispute is a violation of platform rules and may result in removal from Reciprocity.
              </div>

              <button
                type="button"
                onClick={submitDispute}
                disabled={!disputeReason || submittingDispute}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {submittingDispute ? "Submitting..." : "Submit Dispute"}
              </button>
            </div>
          )}
        </div>
      )}

      {disputeFiled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Dispute filed. Both players and a platform admin have been notified.
        </div>
      )}

      {status && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status}
        </div>
      )}
    </div>
  );
}
