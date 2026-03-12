"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import BadgeMarker from "./BadgeMarker";
import {
  type BadgeDef,
  type BadgeCategory,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
} from "@/lib/badges/defs";

type EarnedBadge = BadgeDef & { earned: boolean; unlocked_at: string | null };

export default function BadgeGrid({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`/api/badges?userId=${userId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setBadges(json.badges ?? []);
      }
      setLoading(false);
    }
    load();
  }, [userId]);

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--muted)]">
        Loading markers...
      </div>
    );
  }

  const earnedBadges = badges.filter((b) => b.earned);
  const totalEarned = earnedBadges.length;
  const totalBadges = badges.length;

  // No badges earned — show encouragement
  if (totalEarned === 0) {
    return (
      <div className="py-6 text-center">
        <div
          className="text-[13px] font-semibold text-[var(--ink)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          No markers earned yet
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--muted)] leading-relaxed">
          Start playing matches, join tournaments, and climb the ladder to earn your markers.
        </p>
        <Link
          href="/badges"
          className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--gold)] transition hover:text-[var(--pine)]"
        >
          See all {totalBadges} markers &rarr;
        </Link>
      </div>
    );
  }

  // Show only earned badges, grouped by category
  return (
    <div className="space-y-5">
      {CATEGORY_ORDER.map((cat) => {
        const catEarned = earnedBadges.filter((b) => b.category === cat);
        if (catEarned.length === 0) return null;

        return (
          <div key={cat}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                {CATEGORY_LABELS[cat]}
              </span>
              <div className="flex-1 h-px bg-[var(--gold)]/30" />
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
              {catEarned.map((b) => (
                <Link
                  key={b.slug}
                  href="/badges"
                  className="flex flex-col items-center gap-1.5 transition hover:opacity-80"
                >
                  <BadgeMarker badge={b} earned size="large" />
                  <span
                    className="text-[10px] font-medium uppercase tracking-wide text-center leading-tight text-[var(--ink)]"
                    style={{ fontFamily: "Playfair Display, serif" }}
                  >
                    {b.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {/* Summary + link */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-[var(--muted)]">
          {totalEarned} of {totalBadges} markers earned
        </span>
        <Link
          href="/badges"
          className="text-[11px] font-semibold text-[var(--gold)] transition hover:text-[var(--pine)]"
        >
          View all &rarr;
        </Link>
      </div>
    </div>
  );
}
