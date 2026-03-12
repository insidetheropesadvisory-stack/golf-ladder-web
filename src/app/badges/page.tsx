"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import BadgeMarker from "@/app/components/BadgeMarker";
import {
  type BadgeDef,
  type BadgeCategory,
  BADGES,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  TIER_ORDER,
  badgesByCategory,
} from "@/lib/badges/defs";

type EarnedBadge = BadgeDef & { earned: boolean; unlocked_at: string | null };

export default function BadgesPage() {
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        // Not logged in — show all badges as locked
        setBadges(BADGES.map((b) => ({ ...b, earned: false, unlocked_at: null })));
        setLoading(false);
        return;
      }

      const res = await fetch("/api/badges", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setBadges(json.badges ?? []);
      } else {
        setBadges(BADGES.map((b) => ({ ...b, earned: false, unlocked_at: null })));
      }
      setLoading(false);
    }
    load();
  }, []);

  const totalEarned = badges.filter((b) => b.earned).length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/profile" className="text-sm text-[var(--pine)] font-medium">
          &larr; Profile
        </Link>
        <div className="mt-3 border-l-2 border-[var(--gold)] pl-4">
          <div className="text-[11px] tracking-[0.28em] text-[var(--muted)]">RECIPROCITY</div>
          <h1
            className="mt-1 text-2xl font-semibold tracking-tight"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            Ball Markers
          </h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            {totalEarned} of {badges.length} earned. Tap any marker to flip it over.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-black/[0.04]" />
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="h-24 w-24 animate-pulse rounded-full bg-black/[0.04] mx-auto" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.map((cat) => {
            const catBadges = badges.filter((b) => b.category === cat);
            if (catBadges.length === 0) return null;
            const earnedCount = catBadges.filter((b) => b.earned).length;

            // Sort: earned first (by tier desc), then unearned (by tier desc)
            const sorted = [...catBadges].sort((a, b) => {
              if (a.earned && !b.earned) return -1;
              if (!a.earned && b.earned) return 1;
              return TIER_ORDER[b.tier] - TIER_ORDER[a.tier];
            });

            return (
              <section key={cat}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-1 rounded-full bg-[var(--pine)]" />
                    <h2
                      className="text-[11px] font-bold uppercase tracking-[0.15em] text-[var(--ink)]"
                      style={{ fontFamily: "Playfair Display, serif" }}
                    >
                      {CATEGORY_LABELS[cat]}
                    </h2>
                  </div>
                  <div className="flex-1 h-px bg-[var(--gold)]/30" />
                  <span className="text-[11px] font-semibold text-[var(--muted)] tabular-nums">
                    {earnedCount}/{catBadges.length}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mb-5 h-1 rounded-full bg-[var(--border)]">
                  <div
                    className="h-1 rounded-full bg-[var(--gold)] transition-all"
                    style={{
                      width: `${catBadges.length > 0 ? (earnedCount / catBadges.length) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Badge cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {sorted.map((b) => (
                    <div
                      key={b.slug}
                      className={`flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition ${
                        b.earned
                          ? "border-[var(--gold)]/30 bg-white/80 shadow-sm"
                          : "border-[var(--border)] bg-black/[0.01]"
                      }`}
                    >
                      <BadgeMarker badge={b} earned={b.earned} size="large" />
                      <div className="text-center">
                        <div
                          className={`text-[12px] font-bold leading-tight ${
                            b.earned ? "text-[var(--ink)]" : "text-[var(--muted)]"
                          }`}
                          style={{ fontFamily: "Playfair Display, serif" }}
                        >
                          {b.name}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">
                          {b.description}
                        </div>
                        {b.earned && b.unlocked_at && (
                          <div className="mt-1 text-[9px] text-[var(--gold)] font-medium">
                            Earned {new Date(b.unlocked_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
