// Shared types and helpers for match scoring pages

export type MatchRow = {
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

export type TeeData = {
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

export type CourseData = {
  id: number;
  club_name?: string;
  course_name?: string;
  tees?: Record<string, TeeData>;
};

export type HoleRow = {
  match_id: string;
  hole_no: number;
  player_id: string;
  strokes: number | null;
  locked: boolean;
};

export type MatchRound = {
  id: string;
  match_id: string;
  user_id: string;
  course_name: string;
  tee_name: string | null;
  gross_score: number | null;
  course_rating: number;
  slope_rating: number;
  par: number | null;
  differential: number | null;
  played_at: string;
  completed: boolean;
  golf_course_api_id: number | null;
  created_at: string;
};

export type MatchHole = {
  id: string;
  match_round_id: string;
  hole_no: number;
  strokes: number | null;
};

export const DEFAULT_HOLES = 18;

export function getTeeRating(tee: TeeData) {
  return tee.course_rating ?? (tee as any).courseRating ?? null;
}

export function getTeeTotalYards(tee: TeeData) {
  return tee.total_yards ?? (tee as any).totalYards ?? null;
}

export function getHolePar(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.par ?? null;
}

export function getHoleYards(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.yardage ?? h?.yards ?? null;
}

export function getHoleHandicap(tee: TeeData, holeNo: number) {
  const h = tee.holes?.find(h => (h.number ?? h.hole) === holeNo);
  return h?.handicap ?? null;
}

/**
 * Build a set of hole numbers where the receiver gets a stroke,
 * based on USGA handicap hole allocation.
 * handicap index 1 = hardest hole, 18 = easiest.
 * If diff > 18, wrap around (2 strokes on hardest holes).
 */
export function buildStrokeHoles(tee: TeeData | null, strokeDiff: number): Map<number, number> {
  const strokeMap = new Map<number, number>();
  if (!tee?.holes || strokeDiff <= 0) return strokeMap;

  const holesWithHdcp = tee.holes
    .filter(h => h.handicap != null)
    .sort((a, b) => (a.handicap ?? 99) - (b.handicap ?? 99));

  if (holesWithHdcp.length === 0) {
    for (let i = 0; i < strokeDiff && i < 18; i++) {
      strokeMap.set(i + 1, (strokeMap.get(i + 1) ?? 0) + 1);
    }
    return strokeMap;
  }

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

export function sumStrokes(rows: HoleRow[], playerId: string | null) {
  if (!playerId) return null;
  let total = 0;
  for (const r of rows) {
    if (r.player_id === playerId && typeof r.strokes === "number") total += r.strokes;
  }
  return total;
}

/** Compute match play result: holes won by each player */
export function matchPlayResult(
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
export function matchPlayNetResult(
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

/**
 * Cross-course match play: each player gets strokes on THEIR OWN course's
 * hole handicap index, then net scores are compared hole-by-hole.
 */
export function matchPlayNetResultCrossCourse(
  p1Holes: MatchHole[],
  p2Holes: MatchHole[],
  p1Tee: TeeData | null,
  p2Tee: TeeData | null,
  hcp1: number,
  hcp2: number,
  totalHoles = DEFAULT_HOLES
): { p1Won: number; p2Won: number; halved: number } {
  // Course handicap for each player on their own course
  const p1CourseHcp = p1Tee
    ? Math.round(hcp1 * ((p1Tee.slope ?? 113) / 113) + ((getTeeRating(p1Tee) ?? p1Tee.par ?? 72) - (p1Tee.par ?? 72)))
    : Math.round(hcp1);
  const p2CourseHcp = p2Tee
    ? Math.round(hcp2 * ((p2Tee.slope ?? 113) / 113) + ((getTeeRating(p2Tee) ?? p2Tee.par ?? 72) - (p2Tee.par ?? 72)))
    : Math.round(hcp2);

  const diff = Math.abs(p1CourseHcp - p2CourseHcp);
  const receiverIsP1 = p1CourseHcp > p2CourseHcp;

  // Distribute strokes on the RECEIVER's own course
  const receiverTee = receiverIsP1 ? p1Tee : p2Tee;
  const strokeMap = buildStrokeHoles(receiverTee, diff);

  let p1Won = 0;
  let p2Won = 0;
  let halved = 0;

  for (let h = 1; h <= totalHoles; h++) {
    const s1 = p1Holes.find(r => r.hole_no === h)?.strokes;
    const s2 = p2Holes.find(r => r.hole_no === h)?.strokes;
    if (s1 == null || s2 == null) continue;

    const strokesOnHole = strokeMap.get(h) ?? 0;
    let net1 = s1;
    let net2 = s2;

    if (strokesOnHole > 0) {
      if (receiverIsP1) net1 -= strokesOnHole;
      else net2 -= strokesOnHole;
    }

    if (net1 < net2) p1Won++;
    else if (net2 < net1) p2Won++;
    else halved++;
  }

  return { p1Won, p2Won, halved };
}

/** Format match play score text like "3 & 2" or "1 up" */
export function matchPlayScoreText(
  myHoles: number,
  oppHoles: number,
  holesPlayed: number,
  totalHoles = DEFAULT_HOLES
): string {
  const diff = Math.abs(myHoles - oppHoles);
  const remaining = totalHoles - holesPlayed;

  if (diff === 0) return "All square";

  const leader = myHoles > oppHoles ? "You lead" : "Opponent leads";

  if (diff > remaining && remaining > 0) {
    return `${leader} ${diff} & ${remaining}`;
  }
  if (remaining === 0) {
    return `${diff} ${diff === 1 ? "hole" : "holes"} ${myHoles > oppHoles ? "up" : "down"}`;
  }
  return `${leader} ${diff} ${diff === 1 ? "hole" : "holes"}`;
}

export function nextUnscoredHole(rows: HoleRow[] | MatchHole[], playerId: string | undefined, totalHoles = DEFAULT_HOLES) {
  const scored = new Set<number>();
  for (const r of rows) {
    const pid = "player_id" in r ? r.player_id : undefined;
    const mid = "match_round_id" in r ? "match" : undefined;
    // For HoleRow, filter by player; for MatchHole, all belong to same round
    if (pid !== undefined) {
      if (pid === playerId && typeof r.strokes === "number") scored.add(r.hole_no);
    } else {
      if (typeof r.strokes === "number") scored.add(r.hole_no);
    }
  }
  for (let h = 1; h <= totalHoles; h++) {
    if (!scored.has(h)) return h;
  }
  return totalHoles;
}

/** Compute handicap differential: (113 / slope) * (gross - rating) */
export function calcDifferential(grossScore: number, courseRating: number, slopeRating: number): number {
  return Math.round(((113 / slopeRating) * (grossScore - courseRating)) * 10) / 10;
}

/** Score styling helpers */
export function diffClass(strokes: number | undefined, par: number | null) {
  if (strokes == null || par == null) return "";
  const d = strokes - par;
  if (d <= -2) return "text-amber-700 font-bold";
  if (d === -1) return "text-rose-600 font-bold";
  if (d === 0) return "text-slate-700";
  if (d === 1) return "text-slate-500";
  return "text-slate-400";
}
