"use client";

import Link from "next/link";

export type PlayerCardData = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  clubs: string[];
  wins: number;
  losses: number;
  ties: number;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

export function PlayerCard({
  player,
  compact = false,
}: {
  player: PlayerCardData;
  compact?: boolean;
}) {
  const name = player.display_name || "Unknown player";
  const crest = initials(name);
  const total = player.wins + player.losses + player.ties;

  if (compact) {
    return (
      <Link
        href={`/players/${player.id}`}
        className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/70 p-3 transition-all duration-200 hover:bg-white hover:shadow-sm"
      >
        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
          {player.avatar_url ? (
            <img
              src={player.avatar_url}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-xs font-semibold">
              {crest}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">
            {name}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            {player.handicap_index != null && (
              <span>HCP {player.handicap_index}</span>
            )}
            {total > 0 && (
              <>
                {player.handicap_index != null && <span className="text-[var(--border)]">&middot;</span>}
                <span>
                  {player.wins}W&ndash;{player.losses}L
                  {player.ties > 0 && <>&ndash;{player.ties}T</>}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/players/${player.id}`}
      className="group block rounded-2xl border border-[var(--border)] bg-white/70 p-5 transition-all duration-200 hover:bg-white hover:shadow-md hover:-translate-y-[1px]"
    >
      <div className="flex items-start gap-4">
        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-[var(--pine)] text-white shadow-sm">
          {player.avatar_url ? (
            <img
              src={player.avatar_url}
              alt={name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-base font-semibold">
              {crest}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors">
            {name}
          </div>

          {player.handicap_index != null && (
            <div className="mt-0.5 text-sm text-[var(--muted)]">
              Handicap: {player.handicap_index}
            </div>
          )}

          {player.clubs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {player.clubs.map((club) => (
                <span
                  key={club}
                  className="inline-flex items-center rounded-full bg-[var(--pine)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--pine)]"
                >
                  {club}
                </span>
              ))}
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="flex-shrink-0 text-right">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-lg font-bold text-emerald-700">{player.wins}</div>
                <div className="text-[10px] font-medium text-[var(--muted)]">W</div>
              </div>
              <div>
                <div className="text-lg font-bold text-red-600">{player.losses}</div>
                <div className="text-[10px] font-medium text-[var(--muted)]">L</div>
              </div>
              <div>
                <div className="text-lg font-bold text-[var(--muted)]">{player.ties}</div>
                <div className="text-[10px] font-medium text-[var(--muted)]">T</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
