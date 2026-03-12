"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type Position = "bottom" | "top" | "left" | "right";

interface CoachmarkProps {
  /** data-coachmark value on the target element */
  target: string;
  /** localStorage key — each page is independent */
  storageKey: string;
  /** Tooltip copy */
  message: string;
  /** Preferred position relative to target */
  position?: Position;
}

export default function Coachmark({
  target,
  storageKey,
  message,
  position = "bottom",
}: CoachmarkProps) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; arrowPos: Position } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const dismiss = useCallback(() => {
    setFading(true);
    localStorage.setItem(storageKey, "1");
    setTimeout(() => setVisible(false), 350);
  }, [storageKey]);

  const computePosition = useCallback(() => {
    const el = document.querySelector(`[data-coachmark="${target}"]`);
    const tip = tipRef.current;
    if (!el || !tip) return;

    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    let arrowPos = position;

    // Try preferred position, fall back if off-screen
    if (position === "bottom" && rect.bottom + gap + tipRect.height < vh) {
      top = rect.bottom + gap + window.scrollY;
      left = rect.left + rect.width / 2 - tipRect.width / 2 + window.scrollX;
      arrowPos = "bottom";
    } else if (position === "top" && rect.top - gap - tipRect.height > 0) {
      top = rect.top - gap - tipRect.height + window.scrollY;
      left = rect.left + rect.width / 2 - tipRect.width / 2 + window.scrollX;
      arrowPos = "top";
    } else if (position === "right" && rect.right + gap + tipRect.width < vw) {
      top = rect.top + rect.height / 2 - tipRect.height / 2 + window.scrollY;
      left = rect.right + gap + window.scrollX;
      arrowPos = "right";
    } else if (position === "left" && rect.left - gap - tipRect.width > 0) {
      top = rect.top + rect.height / 2 - tipRect.height / 2 + window.scrollY;
      left = rect.left - gap - tipRect.width + window.scrollX;
      arrowPos = "left";
    } else {
      // Fallback: below
      top = rect.bottom + gap + window.scrollY;
      left = rect.left + rect.width / 2 - tipRect.width / 2 + window.scrollX;
      arrowPos = "bottom";
    }

    // Clamp horizontal
    left = Math.max(12, Math.min(left, vw - tipRect.width - 12 + window.scrollX));

    setCoords({ top, left, arrowPos });
  }, [target, position]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(storageKey)) return;

    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-coachmark="${target}"]`);
      if (!el) return;

      // Add pulse class
      el.classList.add("coachmark-pulse");
      setVisible(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, [storageKey, target]);

  // Position after visible & rendered
  useEffect(() => {
    if (!visible || fading) return;

    // Wait one frame for tipRef to populate
    rafRef.current = requestAnimationFrame(() => {
      computePosition();
    });

    const handleScroll = () => computePosition();
    const handleResize = () => computePosition();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [visible, fading, computePosition]);

  // Clean up pulse on dismiss
  useEffect(() => {
    if (!visible) {
      const el = document.querySelector(`[data-coachmark="${target}"]`);
      if (el) el.classList.remove("coachmark-pulse");
    }
  }, [visible, target]);

  if (!visible) return null;

  const arrowStyles: Record<Position, React.CSSProperties> = {
    bottom: { top: -6, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    top: { bottom: -6, left: "50%", transform: "translateX(-50%) rotate(45deg)" },
    right: { top: "50%", left: -6, transform: "translateY(-50%) rotate(45deg)" },
    left: { top: "50%", right: -6, transform: "translateY(-50%) rotate(45deg)" },
  };

  return (
    <>
      {/* Backdrop — tap to dismiss */}
      <div
        className="fixed inset-0 z-[60]"
        onClick={dismiss}
        style={{ background: "transparent" }}
      />

      {/* Tooltip */}
      <div
        ref={tipRef}
        className="z-[61]"
        style={{
          position: "absolute",
          top: coords?.top ?? -9999,
          left: coords?.left ?? -9999,
          maxWidth: 280,
          opacity: !coords ? 0 : fading ? 0 : 1,
          transform: !coords ? "translateY(8px)" : fading ? "translateY(4px)" : "translateY(0)",
          transition: "opacity 0.35s ease, transform 0.35s ease",
          pointerEvents: fading ? "none" : "auto",
        }}
      >
        <div
          className="relative rounded-[6px] px-4 py-3 shadow-lg"
          style={{
            background: "var(--pine)",
            border: "1px solid rgba(184, 149, 42, 0.35)",
          }}
        >
          {/* Arrow */}
          {coords && (
            <div
              style={{
                position: "absolute",
                width: 12,
                height: 12,
                background: "var(--pine)",
                borderTop: coords.arrowPos === "bottom" ? "1px solid rgba(184, 149, 42, 0.35)" : "none",
                borderLeft: coords.arrowPos === "bottom" || coords.arrowPos === "right" ? "1px solid rgba(184, 149, 42, 0.35)" : "none",
                borderRight: coords.arrowPos === "top" || coords.arrowPos === "left" ? "1px solid rgba(184, 149, 42, 0.35)" : "none",
                borderBottom: coords.arrowPos === "top" || coords.arrowPos === "left" ? "1px solid rgba(184, 149, 42, 0.35)" : "none",
                ...arrowStyles[coords.arrowPos],
              }}
            />
          )}

          <p
            className="text-[13px] leading-relaxed"
            style={{ fontFamily: "var(--font-body)", color: "var(--paper)" }}
          >
            {message}
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition hover:opacity-80"
            style={{ fontFamily: "var(--font-body)", color: "var(--gold)" }}
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
