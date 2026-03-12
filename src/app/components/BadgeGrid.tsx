"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import BadgeMarker from "./BadgeMarker";
import {
  type BadgeDef,
  type BadgeCategory,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  badgesByCategory,
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

  return (
    <div className="space-y-6">
      {CATEGORY_ORDER.map((cat) => {
        const catBadges = badges.filter((b) => b.category === cat);
        if (catBadges.length === 0) return null;
        const earnedCount = catBadges.filter((b) => b.earned).length;

        return (
          <div key={cat}>
            {/* Category label + progress */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                {CATEGORY_LABELS[cat]}
              </span>
              <div className="flex-1 h-px bg-[var(--gold)]/30" />
              <span className="text-[10px] text-[var(--muted)]">
                {earnedCount}/{catBadges.length}
              </span>
            </div>

            {/* Progress bar */}
            <div className="mb-4 h-1 rounded-full bg-[var(--border)]">
              <div
                className="h-1 rounded-full bg-[var(--gold)] transition-all"
                style={{
                  width: `${(earnedCount / catBadges.length) * 100}%`,
                }}
              />
            </div>

            {/* Badge grid */}
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-4">
              {catBadges.map((b) => (
                <div key={b.slug} className="flex flex-col items-center gap-1.5">
                  <BadgeMarker badge={b} earned={b.earned} size="large" />
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wide text-center leading-tight ${
                      b.earned ? "text-[var(--ink)]" : "text-[var(--muted)]"
                    }`}
                    style={{ fontFamily: "Playfair Display, serif" }}
                  >
                    {b.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
