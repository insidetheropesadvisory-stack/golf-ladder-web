"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  handicap_index: number | null;
  avatar_url: string | null;
  city: string | null;
  state: string | null;
};

type H2HRecord = {
  opponentId: string;
  opponentName: string;
  wins: number;
  losses: number;
  ties: number;
  total: number;
};

type CourseStats = {
  course: string;
  rounds: number;
  avgScore: number;
  bestScore: number | null;
};

type StatsData = {
  wins: number;
  losses: number;
  ties: number;
  totalRounds: number;
  avgScore: number | null;
  bestScore: number | null;
  headToHead: H2HRecord[];
  byCourse: CourseStats[];
};

function safeNum(v: string) {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function getFileExt(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "jpg";
}

export default function ProfilePageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const reason = sp.get("reason");
  const showNameRequired = reason === "name_required";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [fatal, setFatal] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileRow | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [showStats, setShowStats] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);

  type ClubMembership = { club_id: string; club_name: string; city: string | null; state: string | null };
  const [clubs, setClubs] = useState<ClubMembership[]>([]);

  type ActivityItem = { id: string; text: string; subtext: string; href: string; time: string };
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const hasChanges = useMemo(() => {
    const nextHandicap = safeNum(handicap);

    return (
      (profile?.display_name ?? "") !== displayName.trim() ||
      (profile?.handicap_index ?? null) !== nextHandicap ||
      (profile?.avatar_url ?? null) !== (avatarUrl ?? null) ||
      (profile?.city ?? "") !== city.trim() ||
      (profile?.state ?? "") !== state.trim()
    );
  }, [profile, displayName, handicap, avatarUrl, city, state]);

  const hasName = useMemo(() => Boolean(displayName.trim()), [displayName]);

  useEffect(() => {
    let mounted = true;

    async function load(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
      try {
        setLoading(true);
        setFatal(null);

        if (!mounted) return;

        setUserId(user.id);
        setEmail(user.email ?? null);

        const { data: p, error } = await supabase
          .from("profiles")
          .select("id,email,display_name,handicap_index,avatar_url,city,state")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;

        const row = (p as ProfileRow | null) ?? null;

        // Fetch club memberships
        const { data: memberships } = await supabase
          .from("club_memberships")
          .select("club_id, clubs(id, name, city, state)")
          .eq("user_id", user.id);

        if (mounted && memberships) {
          setClubs(
            memberships.map((m: any) => ({
              club_id: m.club_id,
              club_name: m.clubs?.name ?? "Unknown",
              city: m.clubs?.city ?? null,
              state: m.clubs?.state ?? null,
            }))
          );
        }

        // Fetch recent completed matches for activity
        const email = (user.email ?? "").trim();
        const orClause = [
          `creator_id.eq.${user.id}`,
          `opponent_id.eq.${user.id}`,
          email ? `opponent_email.ilike.${email}` : null,
        ].filter(Boolean).join(",");

        const { data: recentMatches } = await supabase
          .from("matches")
          .select("id, created_at, creator_id, opponent_id, opponent_email, course_name, format, status, completed")
          .or(orClause)
          .order("created_at", { ascending: false })
          .limit(10);

        if (mounted && recentMatches) {
          const completedMatches = recentMatches.filter((m: any) => m.completed || m.status === "completed");
          const items: ActivityItem[] = completedMatches.map((m: any) => {
            const isCreator = m.creator_id === user.id;
            const oppLabel = isCreator ? (m.opponent_email || "Opponent") : "Challenger";
            return {
              id: m.id,
              text: `Match vs ${oppLabel}`,
              subtext: `${m.course_name || "Course"} — ${m.format === "match_play" ? "Match Play" : "Stroke Play"}`,
              href: `/matches/${m.id}`,
              time: m.created_at,
            };
          });
          setActivity(items);
        }

        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const metaName = String(meta.display_name ?? meta.name ?? "").trim();
        const metaHcp = meta.handicap_index;

        if (!mounted) return;

        setProfile(row);
        setDisplayName(String(row?.display_name ?? metaName ?? ""));
        setHandicap(
          row?.handicap_index != null
            ? String(row.handicap_index)
            : metaHcp != null
            ? String(metaHcp)
            : ""
        );
        setCity(row?.city ?? "");
        setState(row?.state ?? "");
        setAvatarUrl(row?.avatar_url ?? null);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setFatal(e?.message ?? "Failed to load profile");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    let handled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) {
        load(session.user);
      } else {
        router.push("/login");
      }
    });

    // Immediate session check in case onAuthStateChange hasn't fired yet
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && mounted) {
        if (session?.user) {
          load(session.user);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    return () => {
      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
    };
  }, [avatarPreview]);

  async function onPickAvatar(file: File) {
    try {
      setUploading(true);
      setFatal(null);
      setToast(null);

      if (!file.type.startsWith("image/")) {
        throw new Error("Please choose an image file.");
      }

      const maxBytes = 5 * 1024 * 1024;
      if (file.size > maxBytes) {
        throw new Error("Please upload an image under 5MB.");
      }

      if (!userId) throw new Error("You must be signed in to upload a profile photo.");

      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }

      const previewUrl = URL.createObjectURL(file);
      setAvatarPreview(previewUrl);

      const ext = getFileExt(file.name);
      const filePath = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(filePath);

      if (!publicData?.publicUrl) {
        throw new Error("Upload succeeded but no public URL was returned.");
      }

      setAvatarUrl(publicData.publicUrl);
      setToast("Photo uploaded. Click Save to apply.");
    } catch (e: any) {
      console.error(e);
      setToast(null);
      setFatal(e?.message ?? "Avatar upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!userId) return;

    try {
      setSaving(true);
      setFatal(null);
      setToast(null);

      const nextHandicap = safeNum(handicap);
      const nameToSave = displayName.trim() || null;

      const payload = {
        id: userId,
        email: email ?? null,
        display_name: nameToSave,
        handicap_index: nextHandicap,
        avatar_url: avatarUrl ?? null,
        city: city.trim() || null,
        state: state.trim() || null,
      };

      const { data, error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select("id,email,display_name,handicap_index,avatar_url,city,state")
        .single();

      if (error) throw error;

      const authUpdate = await supabase.auth.updateUser({
        data: {
          display_name: nameToSave,
          name: nameToSave,
          handicap_index: nextHandicap,
        },
      });

      if (authUpdate.error) {
        console.warn("Auth metadata update failed:", authUpdate.error);
      }

      const nextProfile = data as ProfileRow;

      setProfile(nextProfile);
      setDisplayName(nextProfile.display_name ?? "");
      setHandicap(
        nextProfile.handicap_index == null ? "" : String(nextProfile.handicap_index)
      );
      setCity(nextProfile.city ?? "");
      setState(nextProfile.state ?? "");
      setAvatarUrl(nextProfile.avatar_url ?? null);

      if (avatarPreview && avatarPreview.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreview);
      }
      setAvatarPreview(null);

      setToast("Saved.");

      if (showNameRequired && next !== "/" && (nameToSave ?? "").trim().length > 0) {
        router.replace(next);
      }
    } catch (e: any) {
      console.error(e);
      setFatal(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function openStats() {
    setShowStats(true);
    if (stats) return; // already loaded
    setStatsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/stats", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const json = await res.json();
      if (res.ok) {
        setStats(json as StatsData);
      } else {
        setStats({ wins: 0, losses: 0, ties: 0, totalRounds: 0, avgScore: null, bestScore: null, headToHead: [], byCourse: [] });
      }
    } catch {
      setStats({ wins: 0, losses: 0, ties: 0, totalRounds: 0, avgScore: null, bestScore: null, headToHead: [], byCourse: [] });
    }
    setStatsLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const shownAvatar = avatarPreview ?? avatarUrl ?? null;

  const hcpDisplay = profile?.handicap_index != null ? String(profile.handicap_index) : handicap.trim() || null;

  return (
    <div className="space-y-6">
      {showNameRequired ? (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">Add your name to create matches</div>
              <div className="mt-1 text-sm text-amber-700">
                Set a display name, save, and you&apos;ll be sent right back.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {fatal ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fatal}
        </div>
      ) : null}

      {toast ? (
        <div className="rounded-xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 px-4 py-3 text-sm text-[var(--pine)]">
          {toast}
        </div>
      ) : null}

      {/* Profile card */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/70 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-6">
            <div className="flex flex-col items-center gap-4">
              <div className="h-24 w-24 animate-pulse rounded-full bg-black/[0.04]" />
              <div className="h-5 w-36 animate-pulse rounded bg-black/[0.04]" />
              <div className="h-3 w-24 animate-pulse rounded bg-black/[0.04]" />
            </div>
            <div className="space-y-4 max-w-sm mx-auto">
              <div className="h-12 w-full animate-pulse rounded-xl bg-black/[0.04]" />
              <div className="h-12 w-full animate-pulse rounded-xl bg-black/[0.04]" />
            </div>
          </div>
        ) : (
          <>
            {/* Hero header */}
            <div className="border-b border-[var(--border)]/60 bg-gradient-to-b from-slate-50/80 to-white px-6 pb-7 pt-8">
              <div className="flex flex-col items-center">
                {/* Avatar */}
                <div className="relative group">
                  <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-[var(--border)] bg-[var(--paper-2)] shadow-sm ring-4 ring-white">
                    {shownAvatar ? (
                      <Image
                        src={shownAvatar}
                        alt="Avatar"
                        width={96}
                        height={96}
                        className="h-full w-full object-cover"
                        unoptimized={shownAvatar.startsWith("blob:")}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[var(--pine)] text-white">
                        <span className="text-2xl font-semibold">{initials(displayName || email || "?")}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload photo button */}
                <label
                  className={cx(
                    "mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[var(--muted)] transition",
                    uploading ? "opacity-60 cursor-not-allowed" : "hover:text-[var(--pine)] hover:bg-[var(--pine)]/5"
                  )}
                >
                  {uploading ? (
                    "Uploading..."
                  ) : (
                    <>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                      </svg>
                      Change photo
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickAvatar(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                {/* Name */}
                <h1 className="mt-3 text-xl font-semibold tracking-tight text-[var(--ink)]">
                  {displayName || "Your Name"}
                </h1>

                {/* Handicap badge + email */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                  {hcpDisplay && (
                    <span className="inline-flex items-center rounded-full bg-[var(--pine)]/8 px-2.5 py-0.5 text-xs font-semibold text-[var(--pine)]">
                      {hcpDisplay} HCP
                    </span>
                  )}
                  {!hcpDisplay && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-[var(--muted)]">
                      No handicap set
                    </span>
                  )}
                </div>
                {(city || state) && (
                  <div className="mt-1.5 text-xs text-[var(--muted)]">
                    {[city, state].filter(Boolean).join(", ")}
                  </div>
                )}
                {email && (
                  <div className="mt-1 text-xs text-[var(--muted)]/60">{email}</div>
                )}
              </div>
            </div>

            {/* Edit form */}
            <div className="px-6 py-6 sm:px-8">
              <div className="mx-auto max-w-sm space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Display Name
                  </label>
                  <input
                    className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:ring-1 focus:ring-[var(--pine)]/20"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Ned Roosevelt"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                    Handicap Index
                  </label>
                  <input
                    className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:ring-1 focus:ring-[var(--pine)]/20"
                    value={handicap}
                    onChange={(e) => setHandicap(e.target.value)}
                    placeholder="e.g., 9.8"
                    inputMode="decimal"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                      City
                    </label>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:ring-1 focus:ring-[var(--pine)]/20"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g., Greenwich"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                      State
                    </label>
                    <input
                      className="w-full rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:ring-1 focus:ring-[var(--pine)]/20"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="e.g., CT"
                      maxLength={2}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    className={cx(
                      "rounded-lg px-5 py-2.5 text-sm font-semibold transition",
                      hasChanges && !saving
                        ? "bg-[var(--pine)] text-white shadow-sm hover:shadow-md hover:-translate-y-[1px]"
                        : "bg-black/[0.04] text-[var(--muted)] cursor-not-allowed"
                    )}
                    disabled={!hasChanges || saving}
                    onClick={save}
                    type="button"
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </button>

                  <Link className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]" href={next}>
                    Back
                  </Link>

                  {showNameRequired && next !== "/" && hasName ? (
                    <Link
                      href={next}
                      className="rounded-lg border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium transition hover:shadow-sm"
                    >
                      Continue &rarr;
                    </Link>
                  ) : null}
                </div>

                {showNameRequired && !hasName ? (
                  <div className="text-xs text-[var(--muted)]">
                    Add a display name to continue.
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Match Statistics card */}
      {!loading && (
        <button
          type="button"
          onClick={openStats}
          className="group w-full rounded-2xl border border-[var(--border)] bg-white/70 p-5 text-left shadow-sm transition hover:border-[var(--pine)]/20 hover:shadow-md"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--pine)]/8">
              <svg className="h-5 w-5 text-[var(--pine)]" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--ink)]">Match Statistics</div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">Win/loss record, head-to-head, scoring averages</div>
            </div>
            <div className="flex items-center gap-2">
              {/* Stat preview chips */}
              <div className="hidden sm:flex items-center gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                  {stats ? `${stats.wins}W-${stats.losses}L` : "W/L"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                  {stats?.avgScore ? `Avg ${stats.avgScore}` : "Avg"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
                  {stats?.totalRounds ? `${stats.totalRounds} Rds` : "Rounds"}
                </span>
              </div>
              <svg className="h-5 w-5 text-[var(--muted)] transition group-hover:text-[var(--pine)] group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </div>
          </div>
        </button>
      )}

      {/* Memberships */}
      {!loading && (
        <div className="rounded-[6px] border border-[var(--border)] bg-white/70 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)]/60 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="icon-box icon-box--tan">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">Memberships</div>
                <div className="text-[11px] text-[var(--muted)]">{clubs.length} club{clubs.length !== 1 ? "s" : ""}</div>
              </div>
            </div>
            <Link
              href="/clubs"
              className="btn-outline-gold text-[10px] px-3 py-1.5"
            >
              Manage
            </Link>
          </div>
          {clubs.length === 0 ? (
            <div className="px-5 py-6 text-center">
              <p className="text-[12px] text-[var(--muted)]">No club memberships yet.</p>
              <Link href="/clubs" className="btn-gold mt-3 inline-flex text-[11px] px-4 py-2">Join a Club</Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]/60">
              {clubs.map((c) => (
                <Link
                  key={c.club_id}
                  href={`/clubs/${c.club_id}`}
                  className="flex items-center gap-3 px-5 py-3 transition hover:bg-[var(--green-light)]/30"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[var(--pine)] text-[10px] font-bold text-[var(--gold)]">
                    {initials(c.club_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[var(--ink)]">{c.club_name}</div>
                    {(c.city || c.state) && (
                      <div className="text-[11px] text-[var(--muted)]">{[c.city, c.state].filter(Boolean).join(", ")}</div>
                    )}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 text-[var(--muted)]">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent Activity */}
      {!loading && activity.length > 0 && (
        <div className="rounded-[6px] border border-[var(--border)] bg-white/70 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border)]/60 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="icon-box icon-box--green">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">Recent Activity</div>
                <div className="text-[11px] text-[var(--muted)]">{activity.length} completed match{activity.length !== 1 ? "es" : ""}</div>
              </div>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)]/60">
            {(showAllActivity ? activity : activity.slice(0, 3)).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-3 px-5 py-3 transition hover:bg-[var(--green-light)]/30"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[var(--green-light)] text-[var(--pine)]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7M4 22h16M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--ink)]">{item.text}</div>
                  <div className="truncate text-[11px] text-[var(--muted)]">{item.subtext}</div>
                </div>
                <div className="text-[10px] text-[var(--muted)] shrink-0">
                  {new Date(item.time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </Link>
            ))}
          </div>
          {activity.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllActivity(!showAllActivity)}
              className="block w-full border-t border-[var(--border)]/60 py-2.5 text-center text-[11px] font-semibold text-[var(--pine)] transition hover:text-[var(--gold)]"
            >
              {showAllActivity ? "Show less" : `Show all ${activity.length}`}
            </button>
          )}
        </div>
      )}

      {/* Logout */}
      {!loading && (
        <button
          type="button"
          onClick={logout}
          className="w-full rounded-[6px] border border-[var(--border)] bg-white/70 p-4 text-center text-[13px] font-semibold text-[var(--muted)] transition hover:border-red-200 hover:text-red-600"
        >
          Sign Out
        </button>
      )}

      {/* Stats modal */}
      {showStats && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowStats(false); }}
        >
          <div className="w-full max-w-md max-h-[85vh] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">Match Statistics</h2>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-black/5"
                onClick={() => setShowStats(false)}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {statsLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-black/[0.03]" style={{ animationDelay: `${i * 75}ms` }} />)}
                </div>
                <div className="h-32 animate-pulse rounded-xl bg-black/[0.03]" style={{ animationDelay: "225ms" }} />
              </div>
            ) : stats && stats.totalRounds === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
                <div className="text-sm font-medium text-[var(--ink)]">No completed matches yet</div>
                <div className="mt-1 text-xs text-[var(--muted)]">Stats will appear after you finish a match.</div>
              </div>
            ) : stats ? (
              <div className="space-y-5">
                {/* Overview tiles */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Record</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      <span className="text-green-700">{stats.wins}</span>
                      <span className="text-[var(--muted)]">-</span>
                      <span className="text-red-600">{stats.losses}</span>
                      {stats.ties > 0 && <><span className="text-[var(--muted)]">-</span><span className="text-[var(--muted)]">{stats.ties}</span></>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Avg Score</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--ink)]">
                      {stats.avgScore ?? "\u2014"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Best</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--ink)]">
                      {stats.bestScore ?? "\u2014"}
                    </div>
                  </div>
                </div>

                {/* Win percentage bar */}
                {(stats.wins + stats.losses) > 0 && (
                  <div>
                    <div className="mb-1.5 text-xs text-[var(--muted)]">
                      Win rate: {Math.round((stats.wins / (stats.wins + stats.losses + stats.ties)) * 100)}%
                      <span className="ml-1 text-[var(--border)]">&middot;</span>
                      <span className="ml-1">{stats.totalRounds} round{stats.totalRounds !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="flex h-2 overflow-hidden rounded-full bg-black/[0.04]">
                      <div className="bg-green-500 transition-all" style={{ width: `${(stats.wins / (stats.wins + stats.losses + stats.ties)) * 100}%` }} />
                      {stats.ties > 0 && (
                        <div className="bg-gray-300 transition-all" style={{ width: `${(stats.ties / (stats.wins + stats.losses + stats.ties)) * 100}%` }} />
                      )}
                      <div className="bg-red-400 transition-all" style={{ width: `${(stats.losses / (stats.wins + stats.losses + stats.ties)) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* Head to head */}
                {stats.headToHead.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Head to Head</div>
                    <div className="space-y-1.5">
                      {stats.headToHead.map((h) => (
                        <div key={h.opponentId} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2.5">
                          <span className="text-sm font-medium truncate mr-3">{h.opponentName}</span>
                          <span className="text-sm tabular-nums flex-shrink-0">
                            <span className="text-green-700">{h.wins}W</span>
                            <span className="text-[var(--muted)] mx-1">-</span>
                            <span className="text-red-600">{h.losses}L</span>
                            {h.ties > 0 && (
                              <>
                                <span className="text-[var(--muted)] mx-1">-</span>
                                <span className="text-[var(--muted)]">{h.ties}T</span>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By course */}
                {stats.byCourse.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">By Course</div>
                    <div className="space-y-1.5">
                      {stats.byCourse.map((c) => (
                        <div key={c.course} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2.5">
                          <div className="min-w-0 mr-3">
                            <div className="text-sm font-medium truncate">{c.course}</div>
                            <div className="text-[10px] text-[var(--muted)]">{c.rounds} round{c.rounds !== 1 ? "s" : ""}</div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-semibold tabular-nums">{c.avgScore}</div>
                            {c.bestScore != null && (
                              <div className="text-[10px] text-[var(--muted)]">Best: {c.bestScore}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
