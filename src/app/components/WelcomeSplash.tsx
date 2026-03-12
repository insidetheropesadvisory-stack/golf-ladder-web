"use client";

import { useEffect, useState } from "react";

const LS_KEY = "reciprocity_welcome_seen";

export default function WelcomeSplash() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(LS_KEY)) return;
    // Small delay so the app finishes rendering first
    const t = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setFading(true);
    localStorage.setItem(LS_KEY, "1");
    setTimeout(() => setVisible(false), 400);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={dismiss}
      style={{
        background: "rgba(0,0,0,0.6)",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.4s ease",
        animation: fading ? "none" : "welcomeFadeIn 0.5s ease",
      }}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[8px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--pine)",
          transform: fading ? "scale(0.97)" : "scale(1)",
          transition: "transform 0.4s ease",
        }}
      >
        {/* Topographic SVG texture */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ opacity: 0.06 }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 500 700"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
            className="h-full w-full"
          >
            <path d="M0 200Q125 140 250 190T500 170" stroke="#F5F0E8" strokeWidth="1" opacity="0.6" />
            <path d="M0 250Q125 190 250 240T500 220" stroke="#F5F0E8" strokeWidth="0.8" opacity="0.5" />
            <path d="M0 300Q125 240 250 290T500 270" stroke="#F5F0E8" strokeWidth="0.7" opacity="0.4" />
            <path d="M0 350Q125 290 250 340T500 320" stroke="#F5F0E8" strokeWidth="0.6" opacity="0.35" />
            <path d="M0 400Q125 340 250 390T500 370" stroke="#F5F0E8" strokeWidth="0.5" opacity="0.3" />
            <path d="M0 450Q125 390 250 440T500 420" stroke="#F5F0E8" strokeWidth="0.5" opacity="0.25" />
            <path d="M0 500Q125 440 250 490T500 470" stroke="#F5F0E8" strokeWidth="0.4" opacity="0.2" />
            <path d="M0 150Q125 90 250 140T500 120" stroke="#F5F0E8" strokeWidth="0.6" opacity="0.3" />
            <path d="M0 550Q125 490 250 540T500 520" stroke="#F5F0E8" strokeWidth="0.3" opacity="0.15" />
            <ellipse cx="250" cy="350" rx="180" ry="120" stroke="#F5F0E8" strokeWidth="0.3" opacity="0.1" />
          </svg>
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center px-8 py-10 text-center sm:px-10 sm:py-12">
          {/* Wordmark */}
          <div className="mb-1">
            <span
              className="text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--font-body)", color: "var(--gold)" }}
            >
              Est. 2026
            </span>
          </div>
          <h2
            className="text-[26px] leading-none text-white sm:text-[30px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Reciprocity
          </h2>

          {/* Divider */}
          <div
            className="mx-auto mt-6 mb-6"
            style={{ width: 48, height: 2, background: "var(--gold)", opacity: 0.6 }}
          />

          {/* Headline */}
          <h3
            className="text-[22px] leading-tight text-white sm:text-[26px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Welcome to the game
            <br />
            within the game.
          </h3>

          {/* Body */}
          <p
            className="mt-5 text-[15px] leading-relaxed sm:text-base"
            style={{ fontFamily: "var(--font-body)", color: "rgba(255,255,255,0.65)" }}
          >
            Compete from any course, on your schedule.
            You play your round, your opponent plays theirs —
            handicap-adjusted scoring makes every matchup fair.
          </p>
          <p
            className="mt-3 text-[15px] leading-relaxed sm:text-base"
            style={{ fontFamily: "var(--font-body)", color: "rgba(255,255,255,0.65)" }}
          >
            Every round on the ladder counts toward your standing.
            Your game starts now.
          </p>

          {/* CTA */}
          <button
            type="button"
            onClick={dismiss}
            className="mt-8 w-full max-w-[240px] rounded-[4px] py-3 text-[14px] font-semibold uppercase tracking-[0.08em] text-white shadow-sm transition hover:shadow-md"
            style={{
              fontFamily: "var(--font-body)",
              background: "var(--gold)",
            }}
          >
            Get Started
          </button>
        </div>
      </div>

      <style>{`
        @keyframes welcomeFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
