import Link from "next/link";

export const metadata = {
  title: "Find a Round — Reciprocity",
  description: "Find golfers near you. Post open tee times. Build your network.",
};

export default function FindARoundPage() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div>
        <div className="section-flag section-flag--tan">Find a Round</div>
        <div className="context-strip context-strip--tan mt-0">
          <strong>Never play alone again.</strong> Post open tee times, browse who&rsquo;s looking for a game, and build a network of golfers you actually want to play with.
        </div>
      </div>

      {/* How it works */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">How It Works</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="ds-card p-4 text-center space-y-2">
            <div className="mx-auto icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-[var(--ink)]">Post a Tee Time</div>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed">
              Share your upcoming round — course, date, time, and how many spots are open.
            </p>
          </div>
          <div className="ds-card p-4 text-center space-y-2">
            <div className="mx-auto icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-[var(--ink)]">Browse &amp; Join</div>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed">
              See who&rsquo;s playing near you. Filter by course, date, or handicap range.
            </p>
          </div>
          <div className="ds-card p-4 text-center space-y-2">
            <div className="mx-auto icon-box icon-box--green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-[var(--ink)]">Play &amp; Connect</div>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed">
              Meet at the course. After the round, challenge each other to a match on Reciprocity.
            </p>
          </div>
        </div>
      </section>

      <hr className="gold-rule" />

      {/* Open Rounds */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">Open Rounds</h2>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          Rounds posted by players in your area looking for playing partners. This is a community feature — the more you post, the more you play.
        </p>
        <div className="ds-card ds-card--tan-accent p-5">
          <div className="text-center py-6">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[6px] bg-[var(--gold-light)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--tan)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3 className="text-lg text-[var(--ink)]">Coming Soon</h3>
            <p className="mt-1 text-[12px] text-[var(--muted)] max-w-xs mx-auto">
              Open round discovery is being built. For now, use the Pool to find and play with golfers at your club.
            </p>
            <Link href="/pool" className="btn-gold mt-4 inline-flex">
              Go to Pool
            </Link>
          </div>
        </div>
      </section>

      <hr className="gold-rule" />

      {/* Community */}
      <section className="space-y-3">
        <h2 className="text-xl text-[var(--ink)]">Build Your Network</h2>
        <div className="ds-card p-4 space-y-3">
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
              <div className="text-sm font-semibold text-[var(--ink)]">Invite a Friend</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Know someone who should be on Reciprocity? Send them a match invite — they&rsquo;ll get an email to sign up and accept.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="icon-box icon-box--tan">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Join a Club</div>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">
                Clubs are how you find players near you. Join your home course&rsquo;s club to access the pool, ladder, and tournaments.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/matches/new" className="btn-gold">
            Challenge Someone
          </Link>
          <Link href="/clubs" className="btn-outline-gold">
            Browse Clubs
          </Link>
        </div>
      </section>
    </div>
  );
}
