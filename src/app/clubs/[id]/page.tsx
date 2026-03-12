"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Club = { id: string; name: string; city: string | null; state: string | null; logo_url: string | null };
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
      // Search for the club
      const searchRes = await fetch(`/api/golf-courses?q=${encodeURIComponent(clubName)}&limit=5`);
      if (!searchRes.ok) { setCourseLoading(false); return; }
      const searchJson = await searchRes.json();
      const courses = searchJson.courses ?? [];

      // Find best match
      const nameNorm = clubName.toLowerCase().trim();
      const match = courses.find((c: any) => (c.club_name ?? "").toLowerCase().trim() === nameNorm) ?? courses[0];
      if (!match) { setCourseLoading(false); return; }

      // Get the first course's full data
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
    // Update members list locally
    setMembers(prev => prev.map(m => m.id === meId ? { ...m, guest_fee: fee } : m));
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
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-2xl bg-black/[0.03]" />
        <div className="h-10 animate-pulse rounded-xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
        <div className="h-40 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "150ms" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
          <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <div className="text-sm font-medium text-[var(--ink)]">{error}</div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" onClick={() => load()} className="rounded-xl bg-[var(--pine)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:shadow-md">
            Try again
          </button>
          <Link href="/clubs" className="text-sm text-[var(--pine)] underline">Back to memberships</Link>
        </div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium text-[var(--ink)]">Club not found</div>
        <Link href="/clubs" className="mt-2 inline-block text-sm text-[var(--pine)] underline">Back to memberships</Link>
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
    <div className="space-y-5">
      {/* Club header */}
      <div className="flex items-center gap-4">
        <Link href="/clubs" className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white/60 text-[var(--muted)] transition hover:bg-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-[var(--pine)] text-white shadow-sm">
          {club.logo_url ? (
            <img src={club.logo_url} alt={club.name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-lg font-semibold">{initials(club.name)}</div>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{club.name}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
            {loc && <span>{loc}</span>}
            {loc && <span className="text-[var(--border)]">&middot;</span>}
            <span>{members.length} member{members.length !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      {/* Guest fee card (members only) */}
      {isMember && (
        <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/60 to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Your Guest Fee</div>
              <div className="mt-0.5 text-xs text-emerald-600/70">
                Shown to opponents when you challenge them here
              </div>
            </div>
            {editingFee ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-lg border border-emerald-300 bg-white">
                  <span className="pl-2.5 text-sm text-emerald-600">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    className="w-20 rounded-r-lg bg-transparent px-1.5 py-1.5 text-sm font-semibold outline-none"
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveGuestFee(); if (e.key === "Escape") setEditingFee(false); }}
                    placeholder="0"
                  />
                </div>
                <button type="button" onClick={saveGuestFee} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700">
                  Save
                </button>
                <button type="button" onClick={() => { setEditingFee(false); setFeeInput(myGuestFee != null ? String(myGuestFee) : ""); }} className="text-xs text-[var(--muted)]">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setEditingFee(true); setFeeInput(myGuestFee != null ? String(myGuestFee) : ""); }}
                className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
              >
                {myGuestFee != null ? `$${myGuestFee}` : "Not set"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition",
              tab === t.key
                ? "bg-[var(--pine)] text-white"
                : "bg-black/[0.04] text-[var(--muted)] hover:bg-black/[0.07]"
            )}
          >
            {t.label}{t.count != null ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* Course Info tab */}
      {tab === "course" && (
        <div className="space-y-4">
          {courseLoading ? (
            <div className="space-y-3">
              <div className="h-12 animate-pulse rounded-xl bg-black/[0.03]" />
              <div className="h-48 animate-pulse rounded-2xl bg-black/[0.03]" style={{ animationDelay: "75ms" }} />
            </div>
          ) : !courseData ? (
            <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center">
              <div className="text-sm font-medium text-[var(--ink)]">Course data unavailable</div>
              <div className="mt-1 text-xs text-[var(--muted)]">No matching course found in the golf course database.</div>
            </div>
          ) : (
            <>
              {/* Tee selector */}
              {teeNames.length > 0 && (
                <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Tees</div>
                  <div className="flex flex-wrap gap-2">
                    {teeNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setSelectedTee(name)}
                        className={cx(
                          "rounded-xl px-3.5 py-2 text-sm font-semibold transition",
                          selectedTee === name
                            ? "bg-[var(--pine)] text-white shadow-sm"
                            : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--paper)]"
                        )}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tee stats */}
              {activeTee && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {activeTee.par != null && (
                    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                      <div className="text-2xl font-bold text-[var(--ink)]">{activeTee.par}</div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Par</div>
                    </div>
                  )}
                  {activeTee.total_yards != null && (
                    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                      <div className="text-2xl font-bold text-[var(--ink)]">{activeTee.total_yards?.toLocaleString()}</div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Yards</div>
                    </div>
                  )}
                  {activeTee.slope != null && (
                    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                      <div className="text-2xl font-bold text-[var(--ink)]">{activeTee.slope}</div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Slope</div>
                    </div>
                  )}
                  {activeTee.course_rating != null && (
                    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                      <div className="text-2xl font-bold text-[var(--ink)]">{activeTee.course_rating}</div>
                      <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">Rating</div>
                    </div>
                  )}
                </div>
              )}

              {/* All tees comparison */}
              {teeNames.length > 1 && (
                <div className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden">
                  <div className="border-b border-[var(--border)] bg-[var(--paper-2)] px-5 py-3">
                    <div className="text-sm font-bold tracking-tight">All Tees</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--paper-2)]/40">
                          <th className="px-4 py-2.5 text-left font-semibold text-[var(--muted)]">Tee</th>
                          <th className="px-4 py-2.5 text-center font-semibold text-[var(--muted)]">Par</th>
                          <th className="px-4 py-2.5 text-center font-semibold text-[var(--muted)]">Yards</th>
                          <th className="px-4 py-2.5 text-center font-semibold text-[var(--muted)]">Slope</th>
                          <th className="px-4 py-2.5 text-center font-semibold text-[var(--muted)]">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teeNames.map((name) => {
                          const tee = courseData.tees?.[name];
                          if (!tee) return null;
                          return (
                            <tr
                              key={name}
                              className={cx("border-b border-[var(--border)] last:border-b-0 cursor-pointer transition", selectedTee === name ? "bg-[var(--pine)]/5" : "hover:bg-black/[0.02]")}
                              onClick={() => setSelectedTee(name)}
                            >
                              <td className={cx("px-4 py-2.5 font-semibold", selectedTee === name ? "text-[var(--pine)]" : "text-[var(--ink)]")}>{name}</td>
                              <td className="px-4 py-2.5 text-center tabular-nums">{tee.par ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center tabular-nums">{tee.total_yards?.toLocaleString() ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center tabular-nums">{tee.slope ?? "—"}</td>
                              <td className="px-4 py-2.5 text-center tabular-nums">{tee.course_rating ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Hole-by-hole scorecard */}
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
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--paper-2)]/60">
                            <th className="sticky left-0 z-10 bg-[var(--paper-2)] px-3 py-2 text-left font-bold text-[var(--muted)] min-w-[64px]">Hole</th>
                            {holeNos.map(h => (
                              <th key={h} className="px-1.5 py-2 text-center font-bold text-[var(--muted)] min-w-[34px]">{h}</th>
                            ))}
                            <th className="px-2.5 py-2 text-center font-bold text-[var(--ink)] min-w-[40px] bg-[var(--paper-2)]">{label}</th>
                            {showTotal && <th className="px-2.5 py-2 text-center font-bold text-[var(--ink)] min-w-[40px] bg-[var(--paper-2)]">Tot</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {hasYards && (
                            <tr className="border-b border-[var(--border)] bg-blue-50/40">
                              <td className="sticky left-0 z-10 bg-blue-50/60 px-3 py-1.5 text-[11px] font-semibold text-blue-800/70">Yards</td>
                              {holeNos.map(h => (
                                <td key={h} className="px-1.5 py-1.5 text-center text-[11px] text-blue-800/60">{getHoleYards(tee, h) ?? ""}</td>
                              ))}
                              <td className="px-2.5 py-1.5 text-center text-[11px] font-bold text-blue-800/70 bg-blue-50/80">{yardsTotal ?? ""}</td>
                              {showTotal && <td className="px-2.5 py-1.5 text-center text-[11px] font-bold text-blue-800/70 bg-blue-50/80">{tee.total_yards ?? ""}</td>}
                            </tr>
                          )}
                          <tr className="border-b border-[var(--border)] bg-slate-50/50">
                            <td className="sticky left-0 z-10 bg-slate-50/70 px-3 py-1.5 text-[11px] font-semibold text-[var(--muted)]">Par</td>
                            {holeNos.map(h => (
                              <td key={h} className="px-1.5 py-1.5 text-center text-[11px] text-[var(--muted)]">{getHolePar(tee, h) ?? ""}</td>
                            ))}
                            <td className="px-2.5 py-1.5 text-center text-[11px] font-bold text-[var(--ink)] bg-slate-100/50">{parTotal ?? ""}</td>
                            {showTotal && <td className="px-2.5 py-1.5 text-center text-[11px] font-bold text-[var(--ink)] bg-slate-100/50">{frontPar != null && backPar != null ? frontPar + backPar : ""}</td>}
                          </tr>
                          {hasHdcp && (
                            <tr className="bg-amber-50/30">
                              <td className="sticky left-0 z-10 bg-amber-50/50 px-3 py-1.5 text-[11px] font-semibold text-amber-800/70">HDCP</td>
                              {holeNos.map(h => (
                                <td key={h} className="px-1.5 py-1.5 text-center text-[11px] text-amber-800/50">{getHoleHdcp(tee, h) ?? ""}</td>
                              ))}
                              <td className="px-2.5 py-1.5 bg-amber-50/40"></td>
                              {showTotal && <td className="px-2.5 py-1.5 bg-amber-50/40"></td>}
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                }

                return (
                  <div className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden">
                    <div className="border-b border-[var(--border)] bg-[var(--paper-2)] px-5 py-3 flex items-center justify-between">
                      <div className="text-sm font-bold tracking-tight">Scorecard</div>
                      <div className="text-xs text-[var(--muted)]">{selectedTee} tees</div>
                    </div>
                    {renderNine(front, "Out", frontPar, frontYards, false)}
                    <div className="border-t border-[var(--border)]">
                      {renderNine(back, "In", backPar, backYards, true)}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Members tab */}
      {tab === "members" && (
        <div className="space-y-2">
          {members.map((m, i) => (
            <Link
              key={m.id}
              href={`/players/${m.id}`}
              className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] text-xs font-semibold">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(m.display_name ?? undefined)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium group-hover:text-[var(--pine)] transition-colors">{m.display_name || "Unknown"}</div>
                <div className="text-xs text-[var(--muted)]">
                  {m.handicap_index != null ? `HCP ${m.handicap_index}` : "No handicap"}
                  {m.guest_fee != null && <span className="ml-2 text-emerald-700">Guest: ${m.guest_fee}</span>}
                </div>
              </div>
              <div className="text-xs font-medium text-[var(--muted)] tabular-nums">
                #{i + 1}
              </div>
            </Link>
          ))}
          {members.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">No members yet</div>
          )}
        </div>
      )}

      {/* Leaderboard tab */}
      {tab === "leaderboard" && (
        <div className="space-y-2">
          {leaderboard.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
              <div className={cx(
                "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold",
                i === 0 ? "bg-amber-100 text-amber-800" : i === 1 ? "bg-gray-100 text-gray-600" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-black/[0.03] text-[var(--muted)]"
              )}>
                {i + 1}
              </div>
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--green-light)] text-[var(--pine)] text-xs font-semibold">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(m.display_name ?? undefined)
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.display_name || "Unknown"}</div>
                <div className="text-xs text-[var(--muted)]">{m.played} match{m.played !== 1 ? "es" : ""} at this club</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">
                  <span className="text-green-700">{m.wins}W</span>
                  <span className="text-[var(--muted)] mx-0.5">-</span>
                  <span className="text-red-600">{m.losses}L</span>
                </div>
                {m.played > 0 && (
                  <div className="text-[10px] text-[var(--muted)]">{Math.round((m.wins / m.played) * 100)}% win</div>
                )}
              </div>
            </div>
          ))}
          {leaderboard.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              No completed matches at this club yet
            </div>
          )}
        </div>
      )}

      {/* Upcoming tab */}
      {tab === "upcoming" && (
        <div className="space-y-2">
          {upcoming.map((m) => (
            <Link
              key={m.id}
              href={`/matches/${m.id}`}
              className="group flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 transition hover:border-[var(--pine)]/20 hover:shadow-sm"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {m.creator_name} vs {m.opponent_name}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                  <span>{m.format === "match_play" ? "Match Play" : "Stroke Play"}</span>
                  {m.is_ladder_match && (
                    <span className="rounded-full bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">Ladder</span>
                  )}
                  <span className="capitalize">{m.status}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {m.round_time ? (
                  <div className="text-xs font-medium text-[var(--ink)]">
                    {new Date(m.round_time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--muted)]">No date</div>
                )}
              </div>
            </Link>
          ))}
          {upcoming.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              No upcoming matches at this club
            </div>
          )}
        </div>
      )}
    </div>
  );
}
