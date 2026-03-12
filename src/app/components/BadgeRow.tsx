"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/supabase";
import BadgeMarker from "./BadgeMarker";
import type { BadgeDef } from "@/lib/badges/defs";

type TopBadge = BadgeDef & { earned: boolean; unlocked_at: string | null };

/**
 * Compact row showing a user's top 3 highest-tier earned badges (28px coins).
 * Used on match cards next to opponent name.
 */
export default function BadgeRow({ userId }: { userId: string }) {
  const [top, setTop] = useState<TopBadge[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;

      const res = await fetch(`/api/badges?userId=${userId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok && !cancelled) {
        const json = await res.json();
        setTop(json.top ?? []);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  if (top.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {top.map((b) => (
        <BadgeMarker key={b.slug} badge={b} earned size="small" />
      ))}
    </div>
  );
}
