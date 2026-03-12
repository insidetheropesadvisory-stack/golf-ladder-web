import Link from "next/link";

export const metadata = {
  title: "Compete — Reciprocity",
  description: "Matches, ladders, and tournaments. Where serious golfers settle scores.",
};

export default function CompetePage() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div>
        <div className="section-flag section-flag--green">Compete</div>
        <div className="context-strip context-strip--green mt-0">
          <strong>Matches, Ladders &amp; Tournaments.</strong> Three ways to prove your game — handicap-adjusted, course-rated, and settled on the scorecard.
        </div>
      </div>

      {/* Matches */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">Head-to-Head Matches</h2>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Challenge any player to a 1v1 match — stroke play or match play, same course or different courses. Handicap differential levels the field so a 12-index can compete fairly against a scratch player.
        </p>
        <div className="ds-card ds-card--green-accent p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 19.24 7 20v2" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 19.24 17 20v2" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Stroke Play</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Total score adjusted by handicap differential. Lower differential wins. Best for measuring overall consistency.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Match Play</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Hole-by-hole net comparison. Strokes are distributed across the hardest holes by handicap index. Win more holes, win the match.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Different Courses</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Play at your own course, on your own schedule. Cross-course handicap calculation handles the rest. No need to be in the same state.
              </p>
            </div>
          </div>
        </div>
        <Link href="/matches/new" className="btn-gold">
          Start a Match
        </Link>
      </section>

      <hr className="gold-rule" />

      {/* How Handicaps Work */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">How Handicaps Work</h2>
        <div className="ds-card p-4 space-y-2">
          <div className="text-[12px] leading-relaxed text-[var(--muted)]">
            <p><strong className="text-[var(--ink)]">Course Rating</strong> measures the expected score of a scratch golfer on a given course. A course rated 72.4 is harder than 70.1.</p>
            <p className="mt-2"><strong className="text-[var(--ink)]">Slope Rating</strong> (55–155, standard 113) measures relative difficulty for a bogey golfer vs. a scratch golfer. Higher slope = wider gap between skilled and less-skilled play.</p>
            <p className="mt-2"><strong className="text-[var(--ink)]">Handicap Differential</strong> = (113 / Slope) &times; (Gross Score &minus; Course Rating). This normalizes your score across any course.</p>
            <p className="mt-2"><strong className="text-[var(--ink)]">Course Handicap</strong> = Index &times; (Slope / 113) + (Rating &minus; Par). This determines strokes given in match play.</p>
          </div>
        </div>
      </section>

      <hr className="gold-rule" />

      {/* Ladder */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">Ladder</h2>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          A persistent ranking among your club members. Challenge players above you — win and you swap positions. Lose and you stay put. The ladder rewards consistency and courage.
        </p>
        <div className="ds-card ds-card--tan-accent p-4">
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V10" />
                <path d="M18 20V4" />
                <path d="M6 20v-4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Climb the Ranks</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Challenge anyone within 3 spots above you. Matches are handicap-adjusted. Position is everything.
              </p>
            </div>
          </div>
        </div>
        <Link href="/ladder" className="btn-outline-gold">
          View Ladder
        </Link>
      </section>

      <hr className="gold-rule" />

      {/* Tournaments */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">Tournaments</h2>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Multi-player events with structured brackets or stroke-play leaderboards. Invite your group, set the format, and let the competition run its course.
        </p>
        <div className="ds-card ds-card--green-accent p-4">
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Organized Competition</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Create a tournament, invite players, and track results in real time. Best suited for club events and group outings.
              </p>
            </div>
          </div>
        </div>
        <Link href="/tournaments" className="btn-outline-gold">
          Browse Tournaments
        </Link>
      </section>
    </div>
  );
}
