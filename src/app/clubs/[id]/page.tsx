"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Club = { id: string; name: string; city: string | null; state: string | null; logo_url: string | null; is_private: boolean | null };
type Member = { id: string; display_name: string | null; avatar_url: string | null; handicap_index: number | null; guest_fee: number | null };
type LeaderboardEntry = Member & { wins: number; losses: number; played: number };
type UpcomingMatch = { id: string; creator_name: string; opponent_name: string; round_time: string | null; format: string; is_ladder_match: boolean; status: string };

type TeeData = {
  par?: number;
  total_yards?: number;
  slope?: number;
  course_rating?: number;
  holes?: Array<{ number?: number; par?: number; yardage?: number; handicap?: number | null }>;
};

type CourseData = {
  id: number;
  club_name?: string;
  course_name?: string;
  tees?: Record<string, TeeData>;
};

function getHolePar(tee: TeeData, h: number) { return tee.holes?.find(x => x.number === h)?.par ?? null; }
function getHoleYards(tee: TeeData, h: number) { return tee.holes?.find(x => x.number === h)?.yardage ?? null; }
function getHoleHdcp(tee: TeeData, h: number) { return tee.holes?.find(x => x.number === h)?.handicap ?? null; }

/** Section flag + gold rule */
function SectionFlag({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="section-flag section-flag--green">{label}</div>
      <div className="flex-1 h-[2px] bg-[var(--gold)]/30" />
      {children}
    </div>
  );
}

/** Tee color for active chip — Gold tee gets gold bg, others get pine */
function teeChipBg(name: string): string {
  const n = name.toLowerCase();
  if (n === "gold" || n === "golden") return "bg-[var(--gold)] text-[var(--pine)]";
  return "bg-[var(--pine)] text-[var(--paper)]";
}

export default function ClubDetailPage() {
  const params = useParams();
  const clubId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingMatch[]>([]);
  const [tab, setTab] = useState<"course" | "members" | "leaderboard" | "upcoming">("course");

  // Course data from golf API
  const [courseData, setCourseData] = useState<CourseData | null>(null);
  const [selectedTee, setSelectedTee] = useState<string | null>(null);
  const [courseLoading, setCourseLoading] = useState(false);

  // Guest fee
  const [myGuestFee, setMyGuestFee] = useState<number | null>(null);
  const [editingFee, setEditingFee] = useState(false);
  const [feeInput, setFeeInput] = useState("");

  // Private/public toggle
  const [isPrivate, setIsPrivate] = useState<boolean>(false);

  const isMember = useMemo(() => {
    if (!meId) return false;
    return members.some(m => m.id === meId);
  }, [meId, members]);

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("You must be signed in to view this club.");
        setLoading(false);
        return;
      }

      setMeId(session.user.id);

      const res = await fetch(`/api/clubs/${clubId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Failed to load club (${res.status})`);
      }
      const json = await res.json();

      setClub(json.club);
      setIsPrivate(json.club?.is_private === true);
      setMembers(json.members ?? []);
      setLeaderboard(json.leaderboard ?? []);
      setUpcoming(json.upcoming ?? []);

      // Find my guest fee
      const me = (json.members ?? []).find((m: Member) => m.id === session.user.id);
      if (me) {
        setMyGuestFee(me.guest_fee);
        setFeeInput(me.guest_fee != null ? String(me.guest_fee) : "");
      }

      // Fetch course data from golf API by club name
      if (json.club?.name) {
        fetchCourseData(json.club.name);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load club");
    }
    setLoading(false);
  }

  async function fetchCourseData(clubName: string) {
    setCourseLoading(true);
    try {
      const searchRes = await fetch(`/api/golf-courses?q=${encodeURIComponent(clubName)}&limit=5`);
      if (!searchRes.ok) { setCourseLoading(false); return; }
      const searchJson = await searchRes.json();
      const courses = searchJson.courses ?? [];

      const nameNorm = clubName.toLowerCase().trim();
      const match = courses.find((c: any) => (c.club_name ?? "").toLowerCase().trim() === nameNorm) ?? courses[0];
      if (!match) { setCourseLoading(false); return; }

      const courseId = match.courses?.[0]?.courseID;
      if (!courseId) { setCourseLoading(false); return; }

      const courseRes = await fetch(`/api/golf-courses?courseId=${courseId}`);
      if (!courseRes.ok) { setCourseLoading(false); return; }
      const courseJson = await courseRes.json();
      const course = courseJson.course ?? courseJson;
      if (course?.tees) {
        setCourseData(course as CourseData);
        const teeNames = Object.keys(course.tees);
        if (teeNames.length > 0) setSelectedTee(teeNames[0]);
      }
    } catch {
      // Non-critical
    }
    setCourseLoading(false);
  }

  async function saveGuestFee() {
    if (!meId || !clubId) return;
    const num = parseFloat(feeInput.replace(/[^0-9.]/g, ""));
    const fee = isNaN(num) ? null : num;
    await supabase.from("club_memberships").update({ guest_fee: fee }).eq("user_id", meId).eq("club_id", clubId);
    setMyGuestFee(fee);
    setEditingFee(false);
    setMembers(prev => prev.map(m => m.id === meId ? { ...m, guest_fee: fee } : m));
  }

  async function togglePrivate() {
    if (!clubId) return;
    const next = !isPrivate;
    setIsPrivate(next);
    await supabase.from("clubs").update({ is_private: next }).eq("id", clubId);
  }

  useEffect(() => {
    if (clubId) load();
  }, [clubId]);

  const activeTee: TeeData | null = useMemo(() => {
    if (!courseData?.tees || !selectedTee) return null;
    return courseData.tees[selectedTee] ?? null;
  }, [courseData, selectedTee]);

  const teeNames = useMemo(() => {
    if (!courseData?.tees) return [];
    return Object.keys(courseData.tees).sort((a, b) => {
      const ra = courseData.tees![a]?.course_rating ?? 0;
      const rb = courseData.tees![b]?.course_rating ?? 0;
      return rb - ra;
    });
  }, [courseData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-[6px] overflow-hidden">
          <div className="bg-[var(--pine)] px-6 py-10">
            <div className="flex flex-col items-center gap-4">
              <div className="h-[72px] w-[72px] animate-pulse rounded-full bg-white/10" />
              <div className="h-6 w-48 animate-pulse rounded bg-white/10" />
              <div className="h-4 w-24 animate-pulse rounded bg-white/10" />
            </div>
          </div>
        </div>
        <div className="h-10 animate-pulse rounded-[6px] bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        <div className="h-40 animate-pulse rounded-[6px] bg-black/[0.03]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href="/clubs"
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">{error}</div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button type="button" onClick={() => load()} className="btn-gold text-[11px] px-4 py-2">
              Try again
            </button>
            <Link href="/clubs" className="text-[11px] font-semibold text-[var(--pine)] transition hover:text-[var(--gold)]">Back to memberships</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className="space-y-4">
        <Link
          href="/clubs"
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </Link>
        <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
          <div className="text-sm font-medium text-[var(--ink)]">Club not found</div>
        </div>
      </div>
    );
  }

  const loc = [club.city, club.state].filter(Boolean).join(", ");

  const tabs: { key: typeof tab; label: string; count?: number }[] = [
    { key: "course", label: "Course Info" },
    { key: "members", label: "Members", count: members.length },
    { key: "leaderboard", label: "Leaderboard", count: leaderboard.length },
    { key: "upcoming", label: "Upcoming", count: upcoming.length },
  ];

  const front = Array.from({ length: 9 }, (_, i) => i + 1);
  const back = Array.from({ length: 9 }, (_, i) => i + 10);

  function parForRange(tee: TeeData, holeNos: number[]) {
    let t = 0;
    for (const h of holeNos) {
      const p = getHolePar(tee, h);
      if (p == null) return null;
      t += p;
    }
    return t;
  }
  function yardsForRange(tee: TeeData, holeNos: number[]) {
    let t = 0;
    for (const h of holeNos) {
      const y = getHoleYards(tee, h);
      if (y == null) return null;
      t += y;
    }
    return t;
  }

  return (
    <div className="space-y-6">
      {/* ═══ Back button ═══ */}
      <Link
        href="/clubs"
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </Link>

      {/* ═══ 1. CLUB HEADER — dark green band ═══ */}
      <div className="rounded-[6px] overflow-hidden shadow-sm">
        <div className="bg-[var(--pine)] px-6 pb-8 pt-10 border-b-2 border-[var(--gold)]">
          <div className="flex flex-col items-center">
            {/* Club avatar with gold ring */}
            <div
              className="h-[72px] w-[72px] overflow-hidden rounded-full shadow-lg"
              style={{ border: "3px solid var(--gold)" }}
            >
              {club.logo_url ? (
                <img src={club.logo_url} alt={club.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--pine)] text-[var(--gold)]">
                  <span className="text-xl font-semibold">{initials(club.name)}</span>
                </div>
              )}
            </div>

            {/* Club name — Playfair, cream */}
            <h1
              className="mt-4 text-[26px] font-semibold tracking-tight text-[var(--paper)] text-center"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {club.name}
            </h1>

            {/* State — muted cream */}
            {loc && (
              <div className="mt-1.5 text-[12px] text-[var(--paper)]/60">{loc}</div>
            )}

            {/* Member count + access type pills */}
            <div className="mt-3 flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full border border-[var(--gold)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--gold)]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {members.length} Member{members.length !== 1 ? "s" : ""}
              </span>
              <span
                className={cx(
                  "inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
                  isPrivate
                    ? "border border-amber-400/50 text-amber-300"
                    : "border border-emerald-400/40 text-emerald-300"
                )}
                style={{ fontFamily: "var(--font-body)" }}
              >
                {isPrivate && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                )}
                {isPrivate ? "Private" : "Public"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2. GUEST FEE BANNER ═══ */}
      {isMember && (
        <div
          className="rounded-[6px] bg-[var(--pine)] border-l-[3px] border-l-[var(--gold)] px-5 py-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <div
                className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--gold)]"
                style={{ fontFamily: "var(--font-body)" }}
              >
                Your Guest Fee
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--paper)]/50">
                Shown to opponents when you challenge them here
              </div>
            </div>
            {editingFee ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-[3px] border border-[var(--gold)]/40 bg-white/10">
                  <span className="pl-2.5 text-sm text-[var(--gold)]">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    className="w-20 rounded-r-[3px] bg-transparent px-1.5 py-1.5 text-sm font-semibold text-[var(--paper)] outline-none placeholder:text-[var(--paper)]/30"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveGuestFee(); if (e.key === "Escape") setEditingFee(false); }}
                    placeholder="0"
                  />
                </div>
                <button type="button" onClick={saveGuestFee} className="rounded-[3px] bg-[var(--gold)] px-3 py-1.5 text-[10px] font-bold uppercase text-[var(--pine)] transition hover:brightness-110">
                  Save
                </button>
                <button type="button" onClick={() => { setEditingFee(false); setFeeInput(myGuestFee != null ? String(myGuestFee) : ""); }} className="text-[10px] text-[var(--paper)]/40">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEditingFee(true); setFeeInput(myGuestFee != null ? String(myGuestFee) : ""); }}
                className="text-right"
              >
                <div
                  className="text-[24px] font-semibold text-[var(--gold)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {myGuestFee != null ? `$${myGuestFee}` : "—"}
                </div>
                <div className="text-[9px] text-[var(--paper)]/40 uppercase tracking-wider">Tap to edit</div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ PRIVATE/PUBLIC TOGGLE ═══ */}
      {isMember && (
        <button
          type="button"
          onClick={togglePrivate}
          className={cx(
            "flex w-full items-center justify-between rounded-[6px] border px-5 py-3.5 transition",
            isPrivate
              ? "border-amber-200/60 bg-amber-50/50"
              : "border-[var(--border)] bg-white/60"
          )}
        >
          <div className="flex items-center gap-3">
            {isPrivate ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                <circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/>
              </svg>
            )}
            <div className="text-left">
              <div className="text-sm font-semibold text-[var(--ink)]">{isPrivate ? "Private Club" : "Public Course"}</div>
              <div className="text-[11px] text-[var(--muted)]">
                {isPrivate ? "Only members can host matches here" : "Anyone can play — no membership required"}
              </div>
            </div>
          </div>
          <div
            className={cx(
              "relative h-6 w-11 rounded-full transition-colors",
              isPrivate ? "bg-amber-500" : "bg-black/15"
            )}
          >
            <div
              className={cx(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                isPrivate ? "translate-x-[22px]" : "translate-x-0.5"
              )}
            />
          </div>
        </button>
      )}

      {/* ═══ 3. TAB NAVIGATION — underline style ═══ */}
      <div className="border-b border-[var(--border)]">
        <div className="flex gap-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cx(
                "whitespace-nowrap px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.1em] transition",
                "border-b-2 -mb-[1px]",
                tab === t.key
                  ? "border-[var(--gold)] text-[var(--pine)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
              )}
              style={{ fontFamily: "var(--font-body)" }}
            >
              {t.label}{t.count != null ? ` (${t.count})` : ""}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ COURSE INFO TAB ═══ */}
      {tab === "course" && (
        <div className="space-y-6">
          {courseLoading ? (
            <div className="space-y-4">
              <div className="h-12 animate-pulse rounded-[6px] bg-black/[0.03]" />
              <div className="h-48 animate-pulse rounded-[6px] bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
            </div>
          ) : !courseData ? (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
              <div
                className="text-sm font-medium text-[var(--ink)]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Course data unavailable
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">No matching course found in the golf course database.</div>
            </div>
          ) : (
            <>
              {/* ── Tee selector ── */}
              {teeNames.length > 0 && (
                <section className="space-y-4">
                  <SectionFlag label="Tees" />
                  <div className="flex flex-wrap gap-2">
                    {teeNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setSelectedTee(name)}
                        className={cx(
                          "rounded-[3px] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.08em] transition",
                          selectedTee === name
                            ? teeChipBg(name)
                            : "border border-[var(--border)] bg-[var(--paper-2)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--ink)]/20"
                        )}
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Par / Slope / Rating stat cards ── */}
              {activeTee && (
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {[
                    { label: "Par", value: activeTee.par },
                    { label: "Slope", value: activeTee.slope },
                    { label: "Rating", value: activeTee.course_rating },
                  ].filter(s => s.value != null).map((s) => (
                    <div
                      key={s.label}
                      className="rounded-[6px] border border-[var(--border)] border-t-2 border-t-[var(--gold)] bg-[var(--paper-2)] p-3 sm:p-4 text-center shadow-[var(--shadow-sm)]"
                    >
                      <div
                        className="text-[9px] uppercase tracking-[0.15em] text-[var(--muted)] sm:text-[10px] sm:tracking-[0.2em]"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        {s.label}
                      </div>
                      <div
                        className={cx(
                          "mt-1.5 tabular-nums text-[var(--ink)]",
                          s.label === "Par" ? "text-2xl sm:text-[28px]" : "text-2xl sm:text-[36px]"
                        )}
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {s.label === "Yards" ? (s.value as number).toLocaleString() : s.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── All tees comparison table ── */}
              {teeNames.length > 1 && (
                <section className="space-y-4">
                  <SectionFlag label="All tees" />
                  <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr>
                            <th className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Tee</th>
                            <th className="px-4 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Par</th>
                            <th className="px-4 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Yards</th>
                            <th className="px-4 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Slope</th>
                            <th className="px-4 py-2.5 text-center text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Rating</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teeNames.map((name, i) => {
                            const tee = courseData.tees?.[name];
                            if (!tee) return null;
                            const isSelected = selectedTee === name;
                            return (
                              <tr
                                key={name}
                                className={cx(
                                  "border-t border-[var(--border)] cursor-pointer transition",
                                  isSelected
                                    ? "bg-[var(--green-light)] border-l-[3px] border-l-[var(--gold)]"
                                    : i % 2 === 1
                                    ? "bg-[var(--paper)] hover:bg-[var(--green-light)]/50"
                                    : "bg-[var(--paper-2)] hover:bg-[var(--green-light)]/50"
                                )}
                                onClick={() => setSelectedTee(name)}
                              >
                                <td className={cx(
                                  "px-4 py-2.5 font-bold",
                                  isSelected ? "text-[var(--pine)]" : "text-[var(--ink)]"
                                )}>
                                  {name}
                                </td>
                                <td className="px-4 py-2.5 text-center tabular-nums">{tee.par ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center tabular-nums">{tee.total_yards?.toLocaleString() ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center tabular-nums font-semibold">{tee.slope ?? "—"}</td>
                                <td className="px-4 py-2.5 text-center tabular-nums font-semibold">{tee.course_rating ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )}

              {/* ── Hole-by-hole scorecard ── */}
              {activeTee?.holes && activeTee.holes.length > 0 && (() => {
                const tee = activeTee!;
                const hasYards = getHoleYards(tee, 1) != null;
                const hasHdcp = getHoleHdcp(tee, 1) != null;
                const frontPar = parForRange(tee, front);
                const backPar = parForRange(tee, back);
                const frontYards = yardsForRange(tee, front);
                const backYards = yardsForRange(tee, back);

                function renderNine(holeNos: number[], label: string, parTotal: number | null, yardsTotal: number | null, showTotal: boolean) {
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] tabular-nums">
                        <thead>
                          <tr className="bg-[var(--pine)]">
                            <th className="sticky left-0 z-10 bg-[var(--pine)] px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--paper)] min-w-[64px]">Hole</th>
                            {holeNos.map(h => (
                              <th key={h} className="px-1.5 py-2.5 text-center text-[10px] font-bold text-[var(--paper)]/80 min-w-[34px]">{h}</th>
                            ))}
                            <th className="px-2.5 py-2.5 text-center text-[10px] font-bold text-[var(--paper)] min-w-[40px] bg-[var(--pine)]">{label}</th>
                            {showTotal && <th className="px-2.5 py-2.5 text-center text-[10px] font-bold text-[var(--paper)] min-w-[40px] bg-[var(--pine)]">Tot</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {hasYards && (
                            <tr className="border-b border-[var(--border)]">
                              <td className="sticky left-0 z-10 bg-[var(--paper-2)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--gold)]">Yards</td>
                              {holeNos.map(h => (
                                <td key={h} className="px-1.5 py-1.5 text-center text-[var(--gold)]">{getHoleYards(tee, h) ?? ""}</td>
                              ))}
                              <td className="px-2.5 py-1.5 text-center font-bold text-[var(--gold)] bg-[var(--paper)]">{yardsTotal ?? ""}</td>
                              {showTotal && <td className="px-2.5 py-1.5 text-center font-bold text-[var(--gold)] bg-[var(--paper)]">{tee.total_yards ?? ""}</td>}
                            </tr>
                          )}
                          <tr className={cx("border-b border-[var(--border)]", hasHdcp ? "" : "")}>
                            <td className="sticky left-0 z-10 bg-[var(--paper)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Par</td>
                            {holeNos.map(h => (
                              <td key={h} className="px-1.5 py-1.5 text-center text-[var(--ink)]">{getHolePar(tee, h) ?? ""}</td>
                            ))}
                            <td className="px-2.5 py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--paper)]">{parTotal ?? ""}</td>
                            {showTotal && <td className="px-2.5 py-1.5 text-center font-bold text-[var(--pine)] bg-[var(--paper)]">{frontPar != null && backPar != null ? frontPar + backPar : ""}</td>}
                          </tr>
                          {hasHdcp && (
                            <tr>
                              <td className="sticky left-0 z-10 bg-[var(--paper-2)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">HDCP</td>
                              {holeNos.map(h => (
                                <td key={h} className="px-1.5 py-1.5 text-center text-[var(--muted)]">{getHoleHdcp(tee, h) ?? ""}</td>
                              ))}
                              <td className="px-2.5 py-1.5"></td>
                              {showTotal && <td className="px-2.5 py-1.5"></td>}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                return (
                  <section className="space-y-4">
                    <SectionFlag label="Scorecard">
                      <span
                        className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]"
                        style={{ fontFamily: "var(--font-body)" }}
                      >
                        {selectedTee} tees
                      </span>
                    </SectionFlag>
                    <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] overflow-hidden">
                      {renderNine(front, "Out", frontPar, frontYards, false)}
                      <div className="border-t-2 border-[var(--border)]">
                        {renderNine(back, "In", backPar, backYards, true)}
                      </div>
                    </div>
                  </section>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ═══ MEMBERS TAB ═══ */}
      {tab === "members" && (
        <div className="space-y-4">
          <SectionFlag label="Members" />
          {members.length === 0 ? (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-6 text-center text-[12px] text-[var(--muted)]">No members yet</div>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <Link
                  key={m.id}
                  href={`/players/${m.id}`}
                  className="group flex items-center gap-3 rounded-[6px] border border-[var(--border)] border-l-[3px] border-l-[var(--pine)] bg-[var(--paper-2)] px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] text-[11px] font-bold">
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials(m.display_name ?? undefined)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-[13px] font-bold text-[var(--ink)] group-hover:text-[var(--pine)] transition-colors"
                        style={{ fontFamily: "var(--font-heading)" }}
                      >
                        {m.display_name || "Unknown"}
                      </span>
                      {m.handicap_index != null && (
                        <span className="rounded-full border border-[var(--gold)]/40 px-2 py-0.5 text-[9px] font-bold text-[var(--gold)]">
                          HCP {m.handicap_index}
                        </span>
                      )}
                    </div>
                    {m.guest_fee != null && (
                      <div className="mt-0.5 text-[10px] text-[var(--muted)]">Guest fee: ${m.guest_fee}</div>
                    )}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-[var(--muted)] transition group-hover:text-[var(--pine)] group-hover:translate-x-0.5">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ LEADERBOARD TAB ═══ */}
      {tab === "leaderboard" && (
        <div className="space-y-4">
          <SectionFlag label="Club leaderboard" />
          {leaderboard.length === 0 ? (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-6 text-center text-[12px] text-[var(--muted)]">
              No completed matches at this club yet
            </div>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((m, i) => {
                const isFirst = i === 0;
                return (
                  <div
                    key={m.id}
                    className={cx(
                      "flex items-center gap-3 rounded-[6px] border px-4 py-3",
                      isFirst
                        ? "border-[var(--gold)]/30 border-l-[3px] border-l-[var(--gold)] bg-[#FBF5E6]"
                        : "border-[var(--border)] bg-[var(--paper-2)]"
                    )}
                  >
                    {/* Rank */}
                    <div
                      className={cx(
                        "w-7 text-center text-lg tabular-nums",
                        isFirst ? "text-[var(--gold)]" : "text-[var(--muted)]"
                      )}
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {i + 1}
                    </div>
                    {/* Avatar */}
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] text-[11px] font-bold">
                      {m.avatar_url ? (
                        <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(m.display_name ?? undefined)
                      )}
                    </div>
                    {/* Name + HCP */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-[13px] font-bold text-[var(--ink)]"
                          style={{ fontFamily: "var(--font-heading)" }}
                        >
                          {m.display_name || "Unknown"}
                        </span>
                        {m.handicap_index != null && (
                          <span className="rounded-full border border-[var(--gold)]/40 px-2 py-0.5 text-[9px] font-bold text-[var(--gold)]">
                            HCP {m.handicap_index}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                        {m.played} match{m.played !== 1 ? "es" : ""} at this club
                      </div>
                    </div>
                    {/* W-L record */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold tabular-nums">
                        <span className="text-green-700">{m.wins}W</span>
                        <span className="text-[var(--muted)] mx-0.5">&ndash;</span>
                        <span className="text-red-600">{m.losses}L</span>
                      </div>
                      {m.played > 0 && (
                        <div className="text-[10px] text-[var(--muted)]">{Math.round((m.wins / m.played) * 100)}%</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ UPCOMING TAB ═══ */}
      {tab === "upcoming" && (
        <div className="space-y-4">
          <SectionFlag label="Upcoming matches" />
          {upcoming.length === 0 ? (
            <div className="rounded-[6px] border border-[var(--border)] bg-[var(--paper-2)] p-8 text-center">
              <div
                className="text-sm text-[var(--muted)]"
                style={{ fontFamily: "var(--font-heading)", fontStyle: "italic" }}
              >
                No upcoming matches at this club.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="group flex items-center gap-3 rounded-[6px] border border-[var(--border)] border-l-[3px] border-l-[var(--pine)] bg-[var(--paper-2)] px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--green-light)] text-[var(--pine)]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7M4 22h16M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[13px] font-bold text-[var(--ink)]"
                      style={{ fontFamily: "var(--font-heading)" }}
                    >
                      {m.creator_name} vs {m.opponent_name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                      <span>{m.format === "match_play" ? "Match Play" : "Stroke Play"}</span>
                      {m.is_ladder_match && (
                        <>
                          <span className="text-[var(--border)]">&middot;</span>
                          <span className="font-bold uppercase text-[9px] tracking-wide text-[var(--gold)]">Ladder</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {m.round_time ? (
                      <div
                        className="text-[12px] font-semibold text-[var(--ink)]"
                      >
                        {new Date(m.round_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--muted)]">No date</div>
                    )}
                    <div className="text-[9px] uppercase tracking-wider text-[var(--muted)] capitalize">{m.status}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
