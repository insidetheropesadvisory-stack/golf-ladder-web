"use client";

import { useState } from "react";
import {
  type BadgeDef,
  type BadgeTier,
  TIER_STYLES,
  LOCKED_STYLE,
} from "@/lib/badges/defs";

type BadgeMarkerProps = {
  badge: BadgeDef;
  earned: boolean;
  size?: "large" | "small";
};

const TIER_INITIAL: Record<BadgeTier, string> = {
  brass: "B",
  silver: "S",
  gold: "G",
  black: "\u2605",
};

/** Icon SVG paths by icon_key — simple, elegant line icons */
const ICONS: Record<string, string> = {
  flag: "M6 3v18M6 3l12 7-12 7",
  trophy:
    "M6 9a6 6 0 0012 0V3H6v6zM4 3H2v4a3 3 0 003 3M20 3h2v4a3 3 0 01-3 3M8 21h8M12 15v6",
  calendar: "M3 7h18M7 3v4M17 3v4M3 7v12a2 2 0 002 2h14a2 2 0 002-2V7",
  flame:
    "M12 2c0 4-4 6-4 10a4 4 0 008 0c0-4-4-6-4-10zM10 16a2 2 0 004 0",
  coat: "M12 2l4 4v6l4 3v7H4v-7l4-3V6l4-4zM8 14h8",
  crown: "M3 18h18M5 18l1-10 4 4 2-6 2 6 4-4 1 10",
  ticket:
    "M3 7a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V7z",
  scissors: "M6 6l12 12M18 6L6 18M6 6a2 2 0 110-4 2 2 0 010 4zM6 18a2 2 0 110 4 2 2 0 010-4z",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3",
  "arrow-down": "M12 5v14M19 12l-7 7-7-7",
  target: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 6a6 6 0 100 12 6 6 0 000-12zM12 10a2 2 0 100 4 2 2 0 000-4z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  handshake: "M2 14l6-6 4 4 6-6M14 6h6v6",
  megaphone: "M3 11l18-5v12L3 13v-2zM3 11v2M7 13v5a1 1 0 001 1h2a1 1 0 001-1v-3",
  users: "M17 21v-2a4 4 0 00-3-3.87M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  link: "M10 13a5 5 0 007.07.01l.01-.01 3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.07-.01l-.01.01-3 3a5 5 0 007.07 7.07l1.71-1.71",
  "calendar-check":
    "M3 7h18M7 3v4M17 3v4M3 7v12a2 2 0 002 2h14a2 2 0 002-2V7M9 15l2 2 4-4",
  golf: "M12 18a6 6 0 006-6V2l-6 4-6-4v10a6 6 0 006 6zM12 18v4M8 22h8",
  mountain: "M3 20L9 8l4 6 2-3 6 9H3z",
};

export default function BadgeMarker({
  badge,
  earned,
  size = "large",
}: BadgeMarkerProps) {
  const [flipped, setFlipped] = useState(false);

  const px = size === "large" ? 96 : 28;
  const style = earned ? TIER_STYLES[badge.tier] : null;
  const bg = style?.bg ?? LOCKED_STYLE.bg;
  const rim = style?.rim ?? LOCKED_STYLE.rim;
  const rimW = style?.rimWidth ?? LOCKED_STYLE.rimWidth;
  const textColor = style?.text ?? "#9CA3AF";
  const iconOpacity = earned ? 1 : 0.2;

  const r = px / 2;
  const innerR = r - rimW;
  const iconSize = size === "large" ? 28 : 10;
  const iconOffset = r - iconSize / 2;

  const tierChar = TIER_INITIAL[badge.tier];
  const isGold = earned && badge.tier === "gold";

  return (
    <div
      className="relative cursor-pointer"
      style={{ width: px, height: px, perspective: 600 }}
      onClick={() => size === "large" && setFlipped(!flipped)}
      onMouseEnter={() => size === "small" && setFlipped(true)}
      onMouseLeave={() => size === "small" && setFlipped(false)}
      title={earned ? `${badge.name} — ${badge.description}` : badge.name}
    >
      <div
        className="absolute inset-0 transition-transform duration-500"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front */}
        <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
          <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`}>
            {/* Rim */}
            <circle cx={r} cy={r} r={r - 1} fill={rim} />
            {/* Gold rope texture */}
            {isGold && (
              <circle
                cx={r}
                cy={r}
                r={r - 1}
                fill="none"
                stroke="#D4AF37"
                strokeWidth={1.5}
                strokeDasharray="3 2"
              />
            )}
            {/* Inner disc */}
            <circle cx={r} cy={r} r={innerR} fill={bg} />
            {/* Icon */}
            <g
              transform={`translate(${iconOffset},${iconOffset - (size === "large" ? 3 : 0)}) scale(${iconSize / 24})`}
              opacity={iconOpacity}
            >
              <path
                d={ICONS[badge.icon_key] ?? ICONS.flag}
                fill="none"
                stroke={textColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            {/* Tier initial at bottom */}
            {size === "large" && (
              <text
                x={r}
                y={px - (rimW + 6)}
                textAnchor="middle"
                fill={textColor}
                fontSize={10}
                fontFamily="Source Sans 3, sans-serif"
                fontWeight={600}
                opacity={earned ? 0.7 : 0.2}
              >
                {tierChar}
              </text>
            )}
          </svg>
        </div>

        {/* Back (name + criteria) */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-full text-center"
          style={{
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            backgroundColor: bg,
            border: `${rimW}px solid ${rim}`,
          }}
        >
          {size === "large" ? (
            <>
              <span
                className="px-2 leading-tight"
                style={{
                  fontFamily: "Playfair Display, serif",
                  fontSize: 11,
                  fontWeight: 700,
                  color: textColor,
                }}
              >
                {badge.name}
              </span>
              <span
                className="mt-1 px-3 leading-tight"
                style={{
                  fontFamily: "Source Sans 3, sans-serif",
                  fontSize: 8,
                  color: textColor,
                  opacity: 0.8,
                }}
              >
                {badge.description}
              </span>
            </>
          ) : (
            <span
              style={{
                fontFamily: "Source Sans 3, sans-serif",
                fontSize: 6,
                fontWeight: 600,
                color: textColor,
                lineHeight: 1,
              }}
            >
              {badge.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
