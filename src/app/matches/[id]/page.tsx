"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx } from "@/lib/utils";

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
  golf_course_api_id?: number | null;
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

/** Compute match play result: holes won by each player */
function matchPlayResult(
  rows: HoleRow[],
  player1: string,
  player2: string
): { p1Holes: number; p2Holes: number; halved: number } {
  let p1Holes = 0;
  let p2Holes = 0;
  let halved = 0;

  for (let h = 1; h <= TOTAL_HOLES; h++) {
    const s1 = rows.find((r) => r.player_id === player1 && r.hole_no === h)?.strokes;
    const s2 = rows.find((r) => r.player_id === player2 && r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;
    if (s1 < s2) p1Holes++;
    else if (s2 < s1) p2Holes++;
    else halved++;
  }
  return { p1Holes, p2Holes, halved };
}

/** Compute match play result with net scoring (handicap strokes distributed) */
function matchPlayNetResult(
  rows: HoleRow[],
  player1: string,
  player2: string,
  hcp1: number,
  hcp2: number
): { p1Holes: number; p2Holes: number; halved: number } {
  // Strokes given = difference in handicaps, distributed evenly across holes
  // Lower handicap player gives strokes to the higher
  const diff = Math.round(Math.abs(hcp1 - hcp2));
  const receiverId = hcp1 > hcp2 ? player1 : player2;

  let p1Holes = 0;
  let p2Holes = 0;
  let halved = 0;

  for (let h = 1; h <= TOTAL_HOLES; h++) {
    let s1 = rows.find((r) => r.player_id === player1 && r.hole_no === h)?.strokes;
    let s2 = rows.find((r) => r.player_id === player2 && r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;

    // Apply handicap stroke: holes 1..diff get one stroke each
    if (h <= diff) {
      if (receiverId === player1) s1 = s1 - 1;
      else s2 = s2 - 1;
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
  holesPlayed: number
): string {
  const diff = Math.abs(myHoles - oppHoles);
  const remaining = TOTAL_HOLES - holesPlayed;

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
  const [strokeToast, setStrokeToast] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [myHandicap, setMyHandicap] = useState<number | null>(null);
  const [oppHandicap, setOppHandicap] = useState<number | null>(null);
  const [oppDisplayName, setOppDisplayName] = useState<string | null>(null);
  const [courseData, setCourseData] = useState<CourseData | null>(null);
  const [selectedTee, setSelectedTee] = useState<string | null>(null);

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
            "id, creator_id, opponent_id, opponent_email, course_name, status, completed, terms_status, format, use_handicap, round_time, guest_fee, is_ladder_match, golf_course_api_id"
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
                // Auto-select first tee
                const teeNames = Object.keys(course.tees);
                if (teeNames.length > 0) setSelectedTee(teeNames[0]);
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

  // Match play hole-by-hole results
  const matchPlayData = useMemo(() => {
    if (!isMatchPlay || !meId || !oppId) return null;
    if (useHcp && myHandicap != null && oppHandicap != null) {
      return matchPlayNetResult(holes, meId, oppId, myHandicap, oppHandicap);
    }
    return matchPlayResult(holes, meId, oppId);
  }, [holes, meId, oppId, isMatchPlay, useHcp, myHandicap, oppHandicap]);

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

  // Current tee data for course info display
  const activeTee: TeeData | null = useMemo(() => {
    if (!courseData?.tees || !selectedTee) return null;
    return courseData.tees[selectedTee] ?? null;
  }, [courseData, selectedTee]);

  const teeNames = useMemo(() => {
    if (!courseData?.tees) return [];
    return Object.keys(courseData.tees);
  }, [courseData]);

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
      setStatus("Enter a valid strokes number (1-20).");
      return;
    }

    setStrokeToast(null);

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

    // Score reaction toast
    if (strokes === 1) {
      setStrokeToast("A hole-in-one?! Screenshot it or it didn't happen.");
    } else if (strokes === 2) {
      setStrokeToast("An eagle or better — playing inspired golf out there.");
    } else if (strokes >= 10 && strokes <= 12) {
      setStrokeToast("Respect the honesty. Consider picking up at double bogey next time.");
    } else if (strokes > 12) {
      setStrokeToast("That's a tough hole. Maybe take a breakfast ball on the next one.");
    } else {
      setStrokeToast(null);
    }
    if (strokes >= 10 || strokes <= 2) {
      setTimeout(() => setStrokeToast(null), 4000);
    }

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
    const wasComplete = myScoresByHole.size >= TOTAL_HOLES;
    const nowComplete = myHolesScored.size >= TOTAL_HOLES;

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

    if (holeNo < TOTAL_HOLES) {
      const nextHole = holeNo + 1;
      setHoleNo(nextHole);

      const existing = holes.find(
        (r) => r.player_id === meId && r.hole_no === nextHole
      );
      setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
    }
  }

  const [completing, setCompleting] = useState(false);

  const allScoredByMe = myScoresByHole.size >= TOTAL_HOLES;
  const isCompleted = match?.completed === true || match?.status === "completed";
  const isActive = match?.terms_status === "accepted" || match?.status === "active";

  // Scoring locked until tee time (if a round_time is set)
  const scoringLocked = useMemo(() => {
    if (!match?.round_time) return false; // No time set = scoring open
    try {
      return new Date(match.round_time).getTime() > Date.now();
    } catch {
      return false;
    }
  }, [match?.round_time]);

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

  const allScoredByOpp = oppScoredCount >= TOTAL_HOLES;

  // Match play: clinched when lead > remaining holes
  const matchPlayClinched = useMemo(() => {
    if (!isMatchPlay || !matchPlayData) return false;
    const { p1Holes, p2Holes, halved } = matchPlayData;
    const holesPlayed = p1Holes + p2Holes + halved;
    const remaining = TOTAL_HOLES - holesPlayed;
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

    const { error } = await supabase
      .from("matches")
      .update({ completed: true, status: "completed" })
      .eq("id", matchId);

    if (error) {
      setCompleting(false);
      setStatus(error.message);
      return;
    }

    // If ladder match, trigger position swap
    if (match?.is_ladder_match && match.creator_id && match.opponent_id) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        // Determine winner from scores
        const myTotal = sumStrokes(holes, meId);
        const oppTotal = sumStrokes(holes, oppId);
        let winnerId: string | null = null;
        let loserId: string | null = null;

        if (match.format === "match_play") {
          const mp = match.use_handicap && myHandicap != null && oppHandicap != null
            ? matchPlayNetResult(holes, meId!, oppId!, myHandicap, oppHandicap)
            : matchPlayResult(holes, meId!, oppId!);
          if (mp.p1Holes > mp.p2Holes) { winnerId = meId; loserId = oppId; }
          else if (mp.p2Holes > mp.p1Holes) { winnerId = oppId; loserId = meId; }
        } else {
          const myNet = match.use_handicap && myHandicap != null ? (myTotal ?? 0) - myHandicap : myTotal;
          const oppNet = match.use_handicap && oppHandicap != null ? (oppTotal ?? 0) - oppHandicap : oppTotal;
          if (myNet != null && oppNet != null) {
            if (myNet < oppNet) { winnerId = meId; loserId = oppId; }
            else if (oppNet < myNet) { winnerId = oppId; loserId = meId; }
          }
        }

        if (winnerId && loserId) {
          await fetch("/api/ladder", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            body: JSON.stringify({ action: "swap", winnerId, loserId, type: "gross" }),
          });
          if (match.use_handicap) {
            await fetch("/api/ladder", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({ action: "swap", winnerId, loserId, type: "net" }),
            });
          }
        }
      } catch {
        console.warn("Ladder swap failed");
      }
    }

    setCompleting(false);
    setMatch((prev) => prev ? { ...prev, completed: true, status: "completed" } : prev);
  }

  const [deletingMatch, setDeletingMatch] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);

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
          <div className="mb-1 inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--pine)]">
            {match?.course_name ?? "Match"}
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Scorecard</h1>
          <div className="mt-1 text-xs text-[var(--muted)] sm:text-sm">
            Hole-by-hole scoring -- totals update automatically
          </div>
        </div>

        {canDelete && (
          <div className="flex shrink-0 gap-2">
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
          </div>
        )}
      </div>

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
            <li><span className="font-medium text-[var(--muted)]">Course:</span> {match?.course_name}</li>
            <li><span className="font-medium text-[var(--muted)]">Format:</span> {match?.format === "match_play" ? "Match Play" : "Stroke Play"}</li>
            <li><span className="font-medium text-[var(--muted)]">Handicap:</span> {match?.use_handicap ? "Yes" : "No"}</li>
            {match?.round_time && (
              <li><span className="font-medium text-[var(--muted)]">Round time:</span> {new Date(match.round_time).toLocaleString()}</li>
            )}
            {match?.guest_fee != null && (
              <li><span className="font-medium text-[var(--muted)]">Guest fee:</span> <span className="font-semibold">${match.guest_fee}</span> <span className="text-xs text-[var(--muted)]">(payable at the club)</span></li>
            )}
          </ul>
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

      {/* Format indicator */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-black/[0.04] px-3 py-1 text-xs font-medium text-[var(--ink)]">
          {isMatchPlay ? "Match Play" : "Stroke Play"}
        </span>
        {useHcp && (
          <span className="inline-flex items-center rounded-full bg-amber-100/80 px-3 py-1 text-xs font-medium text-amber-800">
            Net Scoring (Handicap)
          </span>
        )}
        {match?.guest_fee != null && (
          <span className="inline-flex items-center rounded-full bg-emerald-100/80 px-3 py-1 text-xs font-medium text-emerald-800">
            Guest fee: ${match.guest_fee}
          </span>
        )}
      </div>

      {/* Tee selector */}
      {teeNames.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-white/60 px-5 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Tees</div>
          <div className="flex flex-wrap gap-2">
            {teeNames.map((name) => {
              const tee = courseData?.tees?.[name];
              const isActive = selectedTee === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedTee(name)}
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
          {activeTee && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              {activeTee.slope != null && <span>Slope: <span className="font-semibold text-[var(--ink)]">{activeTee.slope}</span></span>}
              {getTeeRating(activeTee) != null && <span>Rating: <span className="font-semibold text-[var(--ink)]">{getTeeRating(activeTee)}</span></span>}
              {activeTee.par != null && <span>Par: <span className="font-semibold text-[var(--ink)]">{activeTee.par}</span></span>}
              {getTeeTotalYards(activeTee) != null && <span>Yards: <span className="font-semibold text-[var(--ink)]">{getTeeTotalYards(activeTee)}</span></span>}
            </div>
          )}
        </div>
      )}

      {/* Score summary cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(() => {
          const { myWins, oppWins, isTie } = isCompleted ? resultData : { myWins: false, oppWins: false, isTie: false };

          return (
            <>
              <div className={cx(
                "rounded-2xl border p-5",
                isCompleted && myWins
                  ? "border-emerald-300 bg-gradient-to-br from-emerald-100 to-emerald-50 ring-2 ring-emerald-300/50"
                  : "border-emerald-200/50 bg-gradient-to-br from-emerald-50/80 to-emerald-50/30"
              )}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    You {isCompleted && myWins ? "- Winner" : isCompleted && isTie ? "- Tie" : ""}
                  </div>
                  {!isMatchPlay && (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {myScoresByHole.size}
                    </div>
                  )}
                </div>
                {isMatchPlay ? (
                  <>
                    <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-800">
                      {matchPlayData ? matchPlayData.p1Holes : 0}
                    </div>
                    <div className="mt-1 text-xs text-emerald-600/70">holes won</div>
                  </>
                ) : (
                  <>
                    <div className="mt-2 text-4xl font-bold tracking-tight text-emerald-800">
                      {useHcp ? myNetTotal ?? 0 : myTotal ?? 0}
                    </div>
                    {useHcp && myTotal != null && myHandicap != null && (
                      <div className="mt-0.5 text-xs text-emerald-600/60">
                        Gross: {myTotal} &middot; HCP: {myHandicap}
                      </div>
                    )}
                    <div className="mt-1 truncate text-xs text-emerald-600/70">{meEmail ?? ""}</div>
                  </>
                )}
              </div>

              <div className={cx(
                "rounded-2xl border p-5",
                isCompleted && oppWins
                  ? "border-slate-300 bg-gradient-to-br from-slate-100 to-slate-50 ring-2 ring-slate-300/50"
                  : "border-slate-200/50 bg-gradient-to-br from-slate-50/80 to-slate-50/30"
              )}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Opponent {isCompleted && oppWins ? "- Winner" : isCompleted && isTie ? "- Tie" : ""}
                  </div>
                </div>
                {isMatchPlay ? (
                  <>
                    <div className="mt-2 text-4xl font-bold tracking-tight text-slate-700">
                      {matchPlayData ? matchPlayData.p2Holes : "--"}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">holes won</div>
                  </>
                ) : (
                  <>
                    <div className="mt-2 text-4xl font-bold tracking-tight text-slate-700">
                      {useHcp ? (oppNetTotal ?? "--") : (oppTotal ?? "--")}
                    </div>
                    {useHcp && oppTotal != null && oppHandicap != null && (
                      <div className="mt-0.5 text-xs text-slate-400/80">
                        Gross: {oppTotal} &middot; HCP: {oppHandicap}
                      </div>
                    )}
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {match?.opponent_id ? opponentLabel : "Not linked yet"}
                    </div>
                  </>
                )}
              </div>
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

      {/* Complete match button */}
      {!isCompleted && isActive && canComplete && (
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
                Opponent: {useHcp ? oppNetTotal : oppTotal}
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
      {!isCompleted && isActive && allScoredByMe && !canComplete && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-5 py-4 text-center">
          <div className="text-sm font-semibold text-amber-800">Waiting for opponent</div>
          <div className="mt-1 text-xs text-amber-700/70">
            You've scored all your holes. Your opponent has scored {oppScoredCount} of {TOTAL_HOLES}.
          </div>
        </div>
      )}

      {/* Scoring locked until tee time */}
      {!isCompleted && scoringLocked && (
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

      {/* Scoring input area - only show when match is not completed and not locked */}
      {!isCompleted && !scoringLocked && (
        <div className="overflow-hidden rounded-2xl border-2 border-[var(--pine)]/20 bg-gradient-to-b from-white to-[var(--paper)] shadow-sm">
          <div className="border-b border-[var(--border)] bg-[var(--pine)]/5 px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--pine)] text-sm font-bold text-white">
                  {holeNo}
                </span>
                <div>
                  <div className="text-sm font-bold tracking-tight">Hole {holeNo} of {TOTAL_HOLES}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {myScoresByHole.has(holeNo) ? "Scored" : "Not scored yet"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  {isMatchPlay ? "Holes won" : useHcp ? "Net total" : "Running total"}
                </div>
                <div className="text-lg font-bold text-[var(--pine)]">
                  {isMatchPlay ? (matchPlayData?.p1Holes ?? 0) : (useHcp ? myNetTotal ?? 0 : myTotal ?? 0)}
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
                <div className="ml-auto text-[10px] text-[var(--muted)]">{selectedTee} tees</div>
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Your strokes</label>
                <input
                  className="mt-2 w-full rounded-xl border-2 border-[var(--border)] bg-white px-4 py-3.5 text-center text-2xl font-bold tracking-tight outline-none transition focus:border-[var(--pine)] focus:ring-2 focus:ring-[var(--pine)]/20"
                  inputMode="numeric"
                  value={strokesInput}
                  onChange={(e) => setStrokesInput(e.target.value)}
                  placeholder="0"
                />
              </div>

              <button
                className="rounded-xl bg-[var(--pine)] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:shadow-none disabled:translate-y-0"
                onClick={saveHole}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            {strokeToast && (
              <div className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 shadow-sm">
                {strokeToast}
              </div>
            )}
            <div className="mt-2 text-[11px] text-[var(--muted)]">
              Save to advance. Next is locked until scored.
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goPrev}
                disabled={holeNo <= 1}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Previous
              </button>

              <div className="text-xs font-medium text-[var(--muted)]">
                {myScoresByHole.size} of {TOTAL_HOLES} scored
              </div>

              <button
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:bg-[var(--paper)] hover:border-[var(--pine)]/30 disabled:opacity-40"
                onClick={goNext}
                disabled={!myScoresByHole.has(holeNo) || holeNo >= TOTAL_HOLES}
              >
                Next
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hole grid - hidden when scoring is locked */}
      {!scoringLocked && <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-bold tracking-tight">Your Holes</div>
          <div className="text-xs text-[var(--muted)]">{myScoresByHole.size}/{TOTAL_HOLES} complete</div>
        </div>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-9 sm:gap-2.5">
          {Array.from({ length: TOTAL_HOLES }, (_, i) => i + 1).map((h) => {
            const v = myScoresByHole.get(h);
            const isCurrent = !isCompleted && h === holeNo;
            const isScored = v != null;
            return (
              <button
                key={h}
                type="button"
                onClick={() => {
                  if (isCompleted) return;
                  setHoleNo(h);
                  const existing = holes.find((r) => r.player_id === meId && r.hole_no === h);
                  setStrokesInput(existing?.strokes != null ? String(existing.strokes) : "");
                  setStatus(null);
                }}
                disabled={isCompleted}
                className={cx(
                  "rounded-xl p-2 text-center transition sm:p-2.5",
                  isCurrent && "ring-2 ring-[var(--pine)] bg-[var(--pine)]/10 border-[var(--pine)]/30 shadow-sm",
                  !isCurrent && isScored && "border border-emerald-200/60 bg-emerald-50/50",
                  !isCurrent && !isScored && "border border-[var(--border)] bg-white/60",
                  !isCompleted && !isCurrent && isScored && "hover:bg-emerald-50",
                  !isCompleted && !isCurrent && !isScored && "hover:bg-white",
                  isCurrent && "border border-[var(--pine)]/30",
                  !isCompleted && !isCurrent && "cursor-pointer",
                  isCompleted && "cursor-default"
                )}
              >
                <div className={cx(
                  "text-[10px] font-medium sm:text-xs",
                  isCurrent ? "text-[var(--pine)]" : "text-[var(--muted)]"
                )}>
                  {h}
                </div>
                {activeTee && getHolePar(activeTee, h) != null && (
                  <div className="text-[9px] text-[var(--muted)]/60">P{getHolePar(activeTee, h)}</div>
                )}
                <div className={cx(
                  "text-sm font-bold sm:text-base",
                  isCurrent && "text-[var(--pine)]",
                  !isCurrent && isScored && "text-emerald-700",
                  !isCurrent && !isScored && "text-[var(--muted)]"
                )}>
                  {v ?? "--"}
                </div>
              </button>
            );
          })}
        </div>
      </div>}

      {status && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status}
        </div>
      )}
    </div>
  );
}
