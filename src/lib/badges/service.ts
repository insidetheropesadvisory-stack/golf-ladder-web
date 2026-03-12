import { SupabaseClient } from "@supabase/supabase-js";
import { BADGES, type BadgeDef } from "./defs";

type EarnedBadge = { slug: string; unlocked_at: string };

/**
 * Evaluate all badge criteria for a user and award any newly earned badges.
 * Returns the list of badges awarded during this call (empty if none new).
 *
 * Call fire-and-forget after match completion, tournament round, etc.
 */
export async function evaluateUser(
  sb: SupabaseClient,
  userId: string
): Promise<EarnedBadge[]> {
  // 1. Fetch already-earned badges
  const { data: existing } = await sb
    .from("user_badges")
    .select("badge_slug")
    .eq("user_id", userId);

  const earned = new Set((existing ?? []).map((r: any) => r.badge_slug));

  // 2. Gather stats (parallelise independent queries)
  const stats = await gatherStats(sb, userId);

  // 3. Check each badge
  const now = new Date().toISOString();
  const newlyEarned: EarnedBadge[] = [];

  for (const badge of BADGES) {
    if (earned.has(badge.slug)) continue;
    if (checkCriteria(badge, stats)) {
      newlyEarned.push({ slug: badge.slug, unlocked_at: now });
    }
  }

  // 4. Insert newly earned badges + create notifications
  if (newlyEarned.length > 0) {
    await sb.from("user_badges").insert(
      newlyEarned.map((b) => ({
        user_id: userId,
        badge_slug: b.slug,
        unlocked_at: b.unlocked_at,
      }))
    );

    // Create notifications for each new badge
    const notifications = newlyEarned.map((b) => {
      const def = BADGES.find((d) => d.slug === b.slug);
      return {
        user_id: userId,
        message: `New marker earned: ${def?.name ?? b.slug} — ${def?.description ?? ""}`,
        match_id: null,
        read: false,
      };
    });
    await sb.from("notifications").insert(notifications);
  }

  return newlyEarned;
}

// ── Stats gathering ──────────────────────────────────────────────

type UserStats = {
  matches_played: number;
  matches_won: number;
  win_streak: number;
  best_win_streak: number;
  matches_in_best_month: number;
  tournaments_entered: number;
  tournament_top_half: number;
  tournaments_won: number;
  consecutive_tournament_wins: number;
  handicap_index: number | null;
  handicap_drop: number;
  invites_sent: number;
  open_rounds_posted: number;
  find_round_fills: number;
  active_friends: number;
  login_streak: number;
  total_rounds: number;
  consecutive_months_played: number;
  ladder_top_days: number;
};

async function gatherStats(
  sb: SupabaseClient,
  userId: string
): Promise<UserStats> {
  const [
    matchStats,
    tournamentStats,
    profileData,
    socialStats,
    participationStats,
    ladderStats,
    loginStats,
  ] = await Promise.all([
    getMatchStats(sb, userId),
    getTournamentStats(sb, userId),
    getProfileData(sb, userId),
    getSocialStats(sb, userId),
    getParticipationStats(sb, userId),
    getLadderStats(sb, userId),
    getLoginStats(sb, userId),
  ]);

  return {
    ...matchStats,
    ...tournamentStats,
    ...profileData,
    ...socialStats,
    ...participationStats,
    ...ladderStats,
    ...loginStats,
  };
}

async function getMatchStats(sb: SupabaseClient, userId: string) {
  // Fetch all completed matches involving user
  const { data: matches } = await sb
    .from("matches")
    .select("id, creator_id, opponent_id, format, use_handicap, created_at")
    .eq("completed", true)
    .eq("status", "completed")
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`)
    .order("created_at", { ascending: true });

  const matchRows = matches ?? [];
  if (matchRows.length === 0) {
    return {
      matches_played: 0,
      matches_won: 0,
      win_streak: 0,
      best_win_streak: 0,
      matches_in_best_month: 0,
    };
  }

  // Fetch holes for all these matches to determine wins
  const matchIds = matchRows.map((m: any) => m.id);

  // Supabase `.in()` has a limit; batch if needed
  const allHoles: any[] = [];
  const BATCH = 100;
  for (let i = 0; i < matchIds.length; i += BATCH) {
    const batch = matchIds.slice(i, i + BATCH);
    const { data } = await sb
      .from("holes")
      .select("match_id, hole_no, player_id, strokes")
      .in("match_id", batch);
    if (data) allHoles.push(...data);
  }

  // Group holes by match
  const holesByMatch = new Map<string, any[]>();
  for (const h of allHoles) {
    const arr = holesByMatch.get(h.match_id) ?? [];
    arr.push(h);
    holesByMatch.set(h.match_id, arr);
  }

  // Compute win/loss per match (chronological order)
  let matchesWon = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  const monthCounts = new Map<string, number>();

  for (const m of matchRows) {
    const mHoles = holesByMatch.get(m.id) ?? [];
    const oppId =
      m.creator_id === userId ? m.opponent_id : m.creator_id;
    if (!oppId) continue;

    const result = computeWinner(mHoles, userId, oppId, m.format);
    const monthKey = (m.created_at as string).slice(0, 7); // YYYY-MM
    monthCounts.set(monthKey, (monthCounts.get(monthKey) ?? 0) + 1);

    if (result === "win") {
      matchesWon++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const matchesInBestMonth = Math.max(0, ...monthCounts.values());

  return {
    matches_played: matchRows.length,
    matches_won: matchesWon,
    win_streak: currentStreak,
    best_win_streak: bestStreak,
    matches_in_best_month: matchesInBestMonth,
  };
}

function computeWinner(
  holes: any[],
  meId: string,
  oppId: string,
  format: string
): "win" | "loss" | "tie" {
  let myTotal = 0,
    oppTotal = 0,
    myCount = 0,
    oppCount = 0;

  for (const h of holes) {
    if (h.strokes == null) continue;
    if (h.player_id === meId) {
      myTotal += h.strokes;
      myCount++;
    } else if (h.player_id === oppId) {
      oppTotal += h.strokes;
      oppCount++;
    }
  }

  if (myCount === 0 || oppCount === 0) return "tie";

  if (format === "match_play") {
    let myHoles = 0,
      oppHoles = 0;
    for (let h = 1; h <= 18; h++) {
      const ms = holes.find(
        (r: any) => r.player_id === meId && r.hole_no === h
      )?.strokes;
      const os = holes.find(
        (r: any) => r.player_id === oppId && r.hole_no === h
      )?.strokes;
      if (ms == null || os == null) continue;
      if (ms < os) myHoles++;
      else if (os < ms) oppHoles++;
    }
    return myHoles > oppHoles ? "win" : myHoles < oppHoles ? "loss" : "tie";
  }

  return myTotal < oppTotal ? "win" : myTotal > oppTotal ? "loss" : "tie";
}

async function getTournamentStats(sb: SupabaseClient, userId: string) {
  // Tournaments entered (accepted)
  const { count: entered } = await sb
    .from("tournament_participants")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "accepted");

  // Completed tournaments — check leaderboard position
  // Get all tournaments user participated in that are completed
  const { data: participations } = await sb
    .from("tournament_participants")
    .select("tournament_id, tournaments(id, status)")
    .eq("user_id", userId)
    .eq("status", "accepted");

  let topHalf = 0;
  let tournamentsWon = 0;
  const wonTournamentIds: string[] = [];

  if (participations) {
    for (const p of participations as any[]) {
      const t = p.tournaments;
      if (!t || t.status !== "completed") continue;

      // Get all participants' total differentials for this tournament
      const { data: rounds } = await sb
        .from("tournament_rounds")
        .select("user_id, differential")
        .eq("tournament_id", p.tournament_id)
        .eq("completed", true);

      if (!rounds || rounds.length === 0) continue;

      // Sum differentials per user
      const totals = new Map<string, number>();
      for (const r of rounds) {
        totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + (r.differential ?? 0));
      }

      const sorted = [...totals.entries()].sort((a, b) => a[1] - b[1]);
      const myIdx = sorted.findIndex(([uid]) => uid === userId);
      if (myIdx === -1) continue;

      const totalPlayers = sorted.length;
      if (myIdx < Math.ceil(totalPlayers / 2)) topHalf++;
      if (myIdx === 0) {
        tournamentsWon++;
        wonTournamentIds.push(p.tournament_id);
      }
    }
  }

  // Check consecutive tournament wins (by tournament end_date order)
  let consecutiveWins = 0;
  if (wonTournamentIds.length >= 2) {
    const { data: allCompleted } = await sb
      .from("tournament_participants")
      .select("tournament_id, tournaments(id, status, end_date)")
      .eq("user_id", userId)
      .eq("status", "accepted")
      .order("tournament_id");

    if (allCompleted) {
      // Sort by end_date
      const completedTs = (allCompleted as any[])
        .filter((p) => p.tournaments?.status === "completed")
        .sort(
          (a, b) =>
            new Date(a.tournaments.end_date).getTime() -
            new Date(b.tournaments.end_date).getTime()
        );

      let streak = 0;
      let best = 0;
      for (const p of completedTs) {
        if (wonTournamentIds.includes(p.tournament_id)) {
          streak++;
          if (streak > best) best = streak;
        } else {
          streak = 0;
        }
      }
      consecutiveWins = best;
    }
  }

  return {
    tournaments_entered: entered ?? 0,
    tournament_top_half: topHalf,
    tournaments_won: tournamentsWon,
    consecutive_tournament_wins: consecutiveWins,
  };
}

async function getProfileData(sb: SupabaseClient, userId: string) {
  const { data: profile } = await sb
    .from("profiles")
    .select("handicap_index")
    .eq("id", userId)
    .maybeSingle();

  // For handicap drop, we'd need historical data.
  // For now, compare current vs highest recorded.
  // We'll check tournament rounds for highest differential as proxy.
  let handicapDrop = 0;
  const hcap = profile?.handicap_index ?? null;

  // Simple approach: check if there are any tournament rounds with higher differentials
  // that would indicate a previous higher handicap
  if (hcap != null) {
    const { data: rounds } = await sb
      .from("tournament_rounds")
      .select("differential")
      .eq("user_id", userId)
      .eq("completed", true)
      .order("differential", { ascending: false })
      .limit(1);

    if (rounds && rounds.length > 0 && rounds[0].differential != null) {
      const highestDiff = Number(rounds[0].differential);
      // Rough approximation: differential ≈ handicap at that time
      if (highestDiff > (hcap ?? 0)) {
        handicapDrop = highestDiff - (hcap ?? 0);
      }
    }
  }

  return {
    handicap_index: hcap != null ? Number(hcap) : null,
    handicap_drop: handicapDrop,
  };
}

async function getSocialStats(sb: SupabaseClient, userId: string) {
  // Invites: matches where creator sent to an opponent_email (not yet claimed)
  // Count matches created by user that have an opponent_email set
  const { count: invites } = await sb
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("creator_id", userId)
    .not("opponent_email", "is", null);

  // Open rounds posted (pool_listings created)
  const { count: openRounds } = await sb
    .from("pool_listings")
    .select("*", { count: "exact", head: true })
    .eq("creator_id", userId);

  // Find-a-round fills: pool listings where someone applied and was accepted
  const { data: myListings } = await sb
    .from("pool_listings")
    .select("id")
    .eq("creator_id", userId);

  let fills = 0;
  if (myListings && myListings.length > 0) {
    const listingIds = myListings.map((l: any) => l.id);
    const batchSize = 100;
    for (let i = 0; i < listingIds.length; i += batchSize) {
      const batch = listingIds.slice(i, i + batchSize);
      const { count } = await sb
        .from("pool_applications")
        .select("*", { count: "exact", head: true })
        .in("listing_id", batch)
        .eq("status", "accepted");
      fills += count ?? 0;
    }
  }

  // Active friends: distinct opponents from completed matches
  const { data: friendMatches } = await sb
    .from("matches")
    .select("creator_id, opponent_id")
    .eq("completed", true)
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`);

  const friendIds = new Set<string>();
  for (const m of friendMatches ?? []) {
    if (m.creator_id === userId && m.opponent_id) friendIds.add(m.opponent_id);
    if (m.opponent_id === userId && m.creator_id) friendIds.add(m.creator_id);
  }

  return {
    invites_sent: invites ?? 0,
    open_rounds_posted: openRounds ?? 0,
    find_round_fills: fills,
    active_friends: friendIds.size,
  };
}

async function getParticipationStats(sb: SupabaseClient, userId: string) {
  // Total rounds = completed matches + completed tournament rounds + completed ladder rounds
  const { count: matchRounds } = await sb
    .from("matches")
    .select("*", { count: "exact", head: true })
    .eq("completed", true)
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`);

  const { count: tourneyRounds } = await sb
    .from("tournament_rounds")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("completed", true);

  const totalRounds = (matchRounds ?? 0) + (tourneyRounds ?? 0);

  // Consecutive months played — check all round dates
  const months = new Set<string>();

  // Match dates
  const { data: matchDates } = await sb
    .from("matches")
    .select("created_at")
    .eq("completed", true)
    .or(`creator_id.eq.${userId},opponent_id.eq.${userId}`);

  for (const m of matchDates ?? []) {
    months.add((m.created_at as string).slice(0, 7));
  }

  // Tournament round dates
  const { data: tourneyDates } = await sb
    .from("tournament_rounds")
    .select("played_at")
    .eq("user_id", userId)
    .eq("completed", true);

  for (const r of tourneyDates ?? []) {
    if (r.played_at) months.add((r.played_at as string).slice(0, 7));
  }

  // Count consecutive months
  const sortedMonths = [...months].sort();
  let consecutive = 0;
  let best = 0;
  for (let i = 0; i < sortedMonths.length; i++) {
    if (i === 0) {
      consecutive = 1;
    } else {
      const prev = new Date(sortedMonths[i - 1] + "-01");
      const curr = new Date(sortedMonths[i] + "-01");
      const diffMonths =
        (curr.getFullYear() - prev.getFullYear()) * 12 +
        (curr.getMonth() - prev.getMonth());
      consecutive = diffMonths === 1 ? consecutive + 1 : 1;
    }
    if (consecutive > best) best = consecutive;
  }

  return {
    total_rounds: totalRounds,
    consecutive_months_played: best,
  };
}

async function getLoginStats(sb: SupabaseClient, userId: string) {
  const { data: logins } = await sb
    .from("user_logins")
    .select("login_date")
    .eq("user_id", userId)
    .order("login_date", { ascending: false })
    .limit(30); // Only need recent dates for streak check

  if (!logins || logins.length === 0) return { login_streak: 0 };

  // Count consecutive days ending today (or yesterday)
  const dates = logins.map((l: any) => l.login_date as string).sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // Streak must include today or yesterday to be "current"
  if (dates[0] !== today && dates[0] !== yesterday) return { login_streak: 0 };

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + "T00:00:00");
    const curr = new Date(dates[i] + "T00:00:00");
    const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return { login_streak: streak };
}

async function getLadderStats(sb: SupabaseClient, userId: string) {
  // Check if user is currently #1 on the ladder
  const { data: ranking } = await sb
    .from("ladder_rankings")
    .select("position, updated_at")
    .eq("user_id", userId)
    .eq("type", "gross")
    .maybeSingle();

  let topDays = 0;
  if (ranking && ranking.position === 1) {
    // Calculate days at #1 from updated_at to now
    const since = new Date(ranking.updated_at).getTime();
    const now = Date.now();
    topDays = Math.floor((now - since) / (1000 * 60 * 60 * 24));
  }

  return { ladder_top_days: topDays };
}

// ── Criteria checking ──────────────────────────────────────────

function checkCriteria(badge: BadgeDef, stats: UserStats): boolean {
  switch (badge.slug) {
    // COMPETE
    case "first-tee":
      return stats.matches_played >= 1;
    case "on-the-board":
      return stats.matches_won >= 1;
    case "back-nine":
      return stats.matches_played >= 10;
    case "match-fit":
      return stats.matches_in_best_month >= 5;
    case "hot-streak":
      return stats.best_win_streak >= 3;
    case "the-closer":
      return stats.best_win_streak >= 5;
    case "round-of-the-club":
      return stats.matches_won >= 25;
    case "greycoat":
      return stats.matches_won >= 50;
    case "members-champion":
      return stats.ladder_top_days >= 30;

    // TOURNAMENTS
    case "entered":
      return stats.tournaments_entered >= 1;
    case "made-the-cut":
      return stats.tournament_top_half >= 1;
    case "club-champion":
      return stats.tournaments_won >= 1;
    case "back-to-back":
      return stats.consecutive_tournament_wins >= 2;

    // HANDICAP
    case "on-the-way-down":
      return stats.handicap_drop >= 2;
    case "scratch-pursuit":
      return stats.handicap_index != null && stats.handicap_index < 10;
    case "plus-territory":
      return stats.handicap_index != null && stats.handicap_index <= -1;

    // SOCIAL
    case "good-company":
      return stats.invites_sent >= 1;
    case "starters-list":
      return stats.open_rounds_posted >= 1;
    case "the-regular":
      return stats.find_round_fills >= 5;
    case "club-connector":
      return stats.active_friends >= 10;

    // PARTICIPATION
    case "on-the-tee":
      return stats.login_streak >= 7;
    case "regular-member":
      return stats.total_rounds >= 20;
    case "dedicated":
      return stats.total_rounds >= 50;
    case "the-grind":
      return stats.consecutive_months_played >= 6;

    default:
      return false;
  }
}
