import Link from "next/link";
import LadderChallenges from "./LadderChallenges";

export const metadata = {
  title: "Compete — Reciprocity",
  description: "Matches, ladders, and tournaments. Where serious golfers settle scores.",
};

export default function CompetePage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl tracking-tight text-[var(--ink)]">Compete</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">Play together in real time or on your own schedule at different courses. Three ways to prove your game.</p>
      </div>

      {/* ── Matches ── */}
      <section className="space-y-3">
        <div className="section-flag section-flag--green">Matches</div>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Challenge any player to a 1v1 — stroke play or match play, same course or different courses. Handicap differential levels the field.
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
                Lower handicap differential wins. Best for overall consistency.
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
                Hole-by-hole net comparison. Win more holes, win the match.
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
                Play at your own course, on your own time. Cross-course handicap calculation handles the rest.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/matches/new" className="btn-gold">Start a Match</Link>
          <Link href="/matches" className="btn-outline-gold">My Matches</Link>
        </div>
      </section>

      <hr className="gold-rule" />

      {/* ── Ladder ── */}
      <section className="space-y-3">
        <div className="section-flag section-flag--tan">Ladder</div>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          A persistent ranking among club members. Challenge players above you — win and you swap positions. The ladder rewards consistency and courage.
        </p>
        <div className="ds-card ds-card--tan-accent p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V10" />
                <path d="M18 20V4" />
                <path d="M6 20v-4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Challenge Up</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Challenge anyone within <span className="font-medium">3 spots above</span> you. Win and you swap positions. Decline and you drop a spot.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Handicap Adjusted</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Each player plays at <span className="font-medium">any course, any tee</span>. Scores are compared by differential so every matchup is fair.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Set a Deadline</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Challenges have a <span className="font-medium">14-day max deadline</span>. Both players submit rounds before time runs out or forfeit.
              </p>
            </div>
          </div>
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--gold)]">You can challenge</div>
        <LadderChallenges />
        <Link href="/ladder" className="btn-outline-gold">View Full Ladder</Link>
      </section>

      <hr className="gold-rule" />

      {/* ── Tournaments ── */}
      <section className="space-y-3">
        <div className="section-flag section-flag--green">Tournaments</div>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Multi-player events with structured brackets or stroke-play leaderboards. Invite your group and let the competition run its course.
        </p>
        <div className="ds-card ds-card--green-accent p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Weekly or Monthly</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Set the duration — <span className="font-medium">weeks or months</span>. Each period, every player submits one round at any course.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Normalized Scoring</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Scores use <span className="font-medium">course rating &amp; slope</span> so every course is fair. Lowest differential each period wins.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Invite Your Group</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Create a private tournament and invite friends, or join an <span className="font-medium">open tournament</span> when available.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/tournaments/new" className="btn-gold">Create Tournament</Link>
          <Link href="/tournaments" className="btn-outline-gold">Browse Tournaments</Link>
        </div>
      </section>
    </div>
  );
}
