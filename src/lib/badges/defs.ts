export type BadgeTier = "brass" | "silver" | "gold" | "black";
export type BadgeCategory =
  | "compete"
  | "tournaments"
  | "handicap"
  | "social"
  | "participation";

export type BadgeDef = {
  slug: string;
  name: string;
  tier: BadgeTier;
  category: BadgeCategory;
  description: string;
  criteria: string;
  icon_key: string;
};

/** Tier priority — higher = more prestigious */
export const TIER_ORDER: Record<BadgeTier, number> = {
  brass: 0,
  silver: 1,
  gold: 2,
  black: 3,
};

export const TIER_STYLES: Record<
  BadgeTier,
  { bg: string; rim: string; rimWidth: number; text: string }
> = {
  brass: { bg: "#8B6914", rim: "#C9A84C", rimWidth: 2, text: "#F5EDD8" },
  silver: { bg: "#9CA3AF", rim: "#E5E7EB", rimWidth: 2, text: "#1F2937" },
  gold: { bg: "#C9A84C", rim: "#F5F0E8", rimWidth: 3, text: "#1B3A2D" },
  black: { bg: "#1A1208", rim: "#4B5563", rimWidth: 2, text: "#C9A84C" },
};

export const LOCKED_STYLE = {
  bg: "#E5E0D8",
  rim: "#C8B89A",
  rimWidth: 1,
};

export const CATEGORY_LABELS: Record<BadgeCategory, string> = {
  compete: "Compete",
  tournaments: "Tournaments",
  handicap: "Handicap",
  social: "Social",
  participation: "Participation",
};

export const CATEGORY_ORDER: BadgeCategory[] = [
  "compete",
  "tournaments",
  "handicap",
  "social",
  "participation",
];

export const BADGES: BadgeDef[] = [
  // ── COMPETE ──
  {
    slug: "first-tee",
    name: "First Tee",
    tier: "brass",
    category: "compete",
    description: "Play your first match",
    criteria: "matches_played >= 1",
    icon_key: "flag",
  },
  {
    slug: "on-the-board",
    name: "On the Board",
    tier: "brass",
    category: "compete",
    description: "Record your first win",
    criteria: "matches_won >= 1",
    icon_key: "trophy",
  },
  {
    slug: "back-nine",
    name: "Back Nine",
    tier: "silver",
    category: "compete",
    description: "Play 10 matches",
    criteria: "matches_played >= 10",
    icon_key: "flag",
  },
  {
    slug: "match-fit",
    name: "Match Fit",
    tier: "silver",
    category: "compete",
    description: "Play 5 matches in one calendar month",
    criteria: "matches_in_month >= 5",
    icon_key: "calendar",
  },
  {
    slug: "hot-streak",
    name: "Hot Streak",
    tier: "silver",
    category: "compete",
    description: "Win 3 matches in a row",
    criteria: "win_streak >= 3",
    icon_key: "flame",
  },
  {
    slug: "the-closer",
    name: "The Closer",
    tier: "gold",
    category: "compete",
    description: "Win 5 matches in a row",
    criteria: "win_streak >= 5",
    icon_key: "flame",
  },
  {
    slug: "round-of-the-club",
    name: "Round of the Club",
    tier: "gold",
    category: "compete",
    description: "Win 25 matches total",
    criteria: "matches_won >= 25",
    icon_key: "trophy",
  },
  {
    slug: "greycoat",
    name: "Greycoat",
    tier: "black",
    category: "compete",
    description: "Win 50 matches total",
    criteria: "matches_won >= 50",
    icon_key: "coat",
  },
  {
    slug: "members-champion",
    name: "Member's Champion",
    tier: "black",
    category: "compete",
    description: "Hold Ladder #1 for 30 consecutive days",
    criteria: "ladder_top_days >= 30",
    icon_key: "crown",
  },

  // ── TOURNAMENTS ──
  {
    slug: "entered",
    name: "Entered",
    tier: "brass",
    category: "tournaments",
    description: "Join your first tournament",
    criteria: "tournaments_entered >= 1",
    icon_key: "ticket",
  },
  {
    slug: "made-the-cut",
    name: "Made the Cut",
    tier: "silver",
    category: "tournaments",
    description: "Finish top half of any tournament",
    criteria: "tournament_top_half >= 1",
    icon_key: "scissors",
  },
  {
    slug: "club-champion",
    name: "Club Champion",
    tier: "gold",
    category: "tournaments",
    description: "Win a tournament",
    criteria: "tournaments_won >= 1",
    icon_key: "trophy",
  },
  {
    slug: "back-to-back",
    name: "Back to Back",
    tier: "gold",
    category: "tournaments",
    description: "Win two consecutive tournaments",
    criteria: "consecutive_tournament_wins >= 2",
    icon_key: "repeat",
  },

  // ── HANDICAP ──
  {
    slug: "on-the-way-down",
    name: "On the Way Down",
    tier: "silver",
    category: "handicap",
    description: "Handicap drops by 2 strokes",
    criteria: "handicap_drop >= 2",
    icon_key: "arrow-down",
  },
  {
    slug: "scratch-pursuit",
    name: "Scratch Pursuit",
    tier: "gold",
    category: "handicap",
    description: "Handicap reaches single digits",
    criteria: "handicap_index < 10",
    icon_key: "target",
  },
  {
    slug: "plus-territory",
    name: "Plus Territory",
    tier: "black",
    category: "handicap",
    description: "Handicap reaches +1 or better",
    criteria: "handicap_index <= -1",
    icon_key: "star",
  },

  // ── SOCIAL ──
  {
    slug: "good-company",
    name: "Good Company",
    tier: "brass",
    category: "social",
    description: "Invite your first friend",
    criteria: "invites_sent >= 1",
    icon_key: "handshake",
  },
  {
    slug: "starters-list",
    name: "Starter's List",
    tier: "brass",
    category: "social",
    description: "Post your first open round",
    criteria: "open_rounds_posted >= 1",
    icon_key: "megaphone",
  },
  {
    slug: "the-regular",
    name: "The Regular",
    tier: "silver",
    category: "social",
    description: "Fill 5 rounds via Find a Round",
    criteria: "find_round_fills >= 5",
    icon_key: "users",
  },
  {
    slug: "club-connector",
    name: "Club Connector",
    tier: "silver",
    category: "social",
    description: "Have 10 friends active on Reciprocity",
    criteria: "active_friends >= 10",
    icon_key: "link",
  },

  // ── PARTICIPATION ──
  {
    slug: "on-the-tee",
    name: "On the Tee",
    tier: "brass",
    category: "participation",
    description: "Log in 7 days in a row",
    criteria: "login_streak >= 7",
    icon_key: "calendar-check",
  },
  {
    slug: "regular-member",
    name: "Regular Member",
    tier: "silver",
    category: "participation",
    description: "Play 20 rounds total",
    criteria: "total_rounds >= 20",
    icon_key: "golf",
  },
  {
    slug: "dedicated",
    name: "Dedicated",
    tier: "gold",
    category: "participation",
    description: "Play 50 rounds total",
    criteria: "total_rounds >= 50",
    icon_key: "golf",
  },
  {
    slug: "the-grind",
    name: "The Grind",
    tier: "gold",
    category: "participation",
    description: "Play every month for 6 consecutive months",
    criteria: "consecutive_months_played >= 6",
    icon_key: "mountain",
  },
];

/** Lookup badge def by slug */
export function getBadge(slug: string): BadgeDef | undefined {
  return BADGES.find((b) => b.slug === slug);
}

/** Get all badges for a category */
export function badgesByCategory(cat: BadgeCategory): BadgeDef[] {
  return BADGES.filter((b) => b.category === cat);
}
