"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  handicap_index: number | null;
  avatar_url: string | null;
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

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [showStats, setShowStats] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);

  const hasChanges = useMemo(() => {
    const nextHandicap = safeNum(handicap);

    return (
      (profile?.display_name ?? "") !== displayName.trim() ||
      (profile?.handicap_index ?? null) !== nextHandicap ||
      (profile?.avatar_url ?? null) !== (avatarUrl ?? null)
    );
  }, [profile, displayName, handicap, avatarUrl]);

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
          .select("id,email,display_name,handicap_index,avatar_url")
          .eq("id", user.id)
          .maybeSingle();

        if (error) throw error;

        const row = (p as ProfileRow | null) ?? null;

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
      setToast("Photo uploaded. Click Save changes to apply it to your profile.");
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
      };

      const { data, error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "id" })
        .select("id,email,display_name,handicap_index,avatar_url")
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
      if (res.ok) setStats(json as StatsData);
    } catch {}
    setStatsLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const shownAvatar = avatarPreview ?? avatarUrl ?? null;

  return (
    <div className="space-y-6">
        <div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Profile</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Update your name, handicap, and photo.
              {email ? <span className="ml-1.5 text-[var(--muted)]">({email})</span> : null}
            </p>
        </div>

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
                  Set a display name, save, and you'll be sent right back.
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

        <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 shadow-sm">
          {loading ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
              <div className="space-y-4">
                <div className="h-4 w-12 rounded bg-black/[0.04]" />
                <div className="h-40 w-40 rounded-2xl bg-black/[0.04]" />
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded bg-black/[0.04]" />
                  <div className="h-12 w-full rounded-xl bg-black/[0.04]" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-28 rounded bg-black/[0.04]" />
                  <div className="h-12 w-full rounded-xl bg-black/[0.04]" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
              <div className="space-y-4">
                <div className="text-xs font-medium tracking-[0.15em] text-[var(--muted)] uppercase">Photo</div>

                <div className="relative h-40 w-40 overflow-hidden rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--paper-2)] transition-colors duration-200 hover:border-[var(--pine)]/30">
                  {shownAvatar ? (
                    <Image
                      src={shownAvatar}
                      alt="Avatar"
                      width={160}
                      height={160}
                      className="h-full w-full object-cover"
                      unoptimized={shownAvatar.startsWith("blob:")}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                      <svg className="h-8 w-8 text-[var(--muted)]/40" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                      <span className="text-xs text-[var(--muted)]">No photo</span>
                    </div>
                  )}
                </div>

                <label
                  className={cx(
                    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors duration-200",
                    uploading ? "opacity-60 cursor-not-allowed" : "hover:bg-white hover:shadow-sm hover:border-[var(--pine)]/30"
                  )}
                >
                  {uploading ? (
                    "Uploading..."
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                      </svg>
                      Upload photo
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

                <div className="text-xs text-[var(--muted)]">PNG or JPG, up to 5MB.</div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-medium tracking-[0.15em] text-[var(--muted)] uppercase">
                    Display name
                  </label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition-colors duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Ned Roosevelt"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium tracking-[0.15em] text-[var(--muted)] uppercase">
                    Handicap index
                  </label>
                  <input
                    className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition-colors duration-200 focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                    value={handicap}
                    onChange={(e) => setHandicap(e.target.value)}
                    placeholder="e.g., 9.8"
                    inputMode="decimal"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    className={cx(
                      "rounded-full px-5 py-2.5 text-sm font-medium transition-colors duration-200",
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

                  <Link className="rounded-full px-4 py-2.5 text-sm text-[var(--muted)] transition-colors duration-200 hover:bg-black/[0.04] hover:text-[var(--ink)]" href={next}>
                    Back
                  </Link>

                  {showNameRequired && next !== "/" && hasName ? (
                    <Link
                      href={next}
                      className="rounded-full border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm font-medium transition-colors duration-200 hover:bg-white hover:shadow-sm"
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
          )}
        </div>

        {/* Stats button */}
        {!loading && (
          <button
            type="button"
            onClick={openStats}
            className="group w-full rounded-2xl border border-[var(--border)] bg-white/70 p-5 text-left shadow-sm transition hover:border-[var(--pine)]/20 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-[var(--ink)]">Match Statistics</div>
                <div className="mt-0.5 text-xs text-[var(--muted)]">Win/loss record, head-to-head, scoring averages</div>
              </div>
              <svg className="h-5 w-5 text-[var(--muted)] transition group-hover:text-[var(--pine)]" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </div>
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
                    {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-black/[0.03]" />)}
                  </div>
                  <div className="h-32 rounded-xl bg-black/[0.03]" />
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
                        {stats.avgScore ?? "—"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3 text-center">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Best</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--ink)]">
                        {stats.bestScore ?? "—"}
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
