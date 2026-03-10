"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { CT_CLUBS } from "@/lib/data/ctClubs";
import { cx, initials } from "@/lib/utils";

type ApiCourse = {
  id: number;
  club_name: string;
  city: string | null;
  state: string | null;
};

type ClubRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
};

const STEPS = ["Profile", "Handicap", "Memberships", "Review"] as const;
type Step = (typeof STEPS)[number];

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

function StepIndicator({ current, steps }: { current: number; steps: readonly string[] }) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div
            className={cx(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all",
              i < current && "bg-[var(--pine)] text-white",
              i === current && "bg-[var(--pine)] text-white ring-4 ring-[var(--pine)]/20",
              i > current && "bg-black/[0.06] text-[var(--muted)]"
            )}
          >
            {i < current ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              i + 1
            )}
          </div>
          {i < steps.length - 1 && (
            <div className={cx("h-px w-4 sm:w-6", i < current ? "bg-[var(--pine)]" : "bg-black/[0.08]")} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = sp.get("next") || "/";

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  // Step 1: Profile
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Step 2: Handicap
  const [handicap, setHandicap] = useState("");
  const [preferredTees, setPreferredTees] = useState("White");

  // Step 3: Clubs
  const [myClubs, setMyClubs] = useState<ClubRow[]>([]);
  const [addQuery, setAddQuery] = useState("");
  const [apiResults, setApiResults] = useState<ApiCourse[]>([]);
  const [searching, setSearching] = useState(false);
  const [agreedToVerification, setAgreedToVerification] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkAuth(user: { id: string; email?: string | null }) {
      if (!mounted) return;
      setUserId(user.id);
      setEmail(user.email ?? null);

      // Check if user already has a complete profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, handicap_index, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      const { data: memberships } = await supabase
        .from("club_memberships")
        .select("club_id")
        .eq("user_id", user.id);

      const hasName = Boolean((prof as any)?.display_name?.trim());
      const hasClub = (memberships ?? []).length > 0;

      if (hasName && hasClub) {
        // Already onboarded
        router.replace("/");
        return;
      }

      // Pre-fill existing data
      if (prof) {
        setDisplayName((prof as any).display_name ?? "");
        if ((prof as any).handicap_index != null) setHandicap(String((prof as any).handicap_index));
        setAvatarUrl((prof as any).avatar_url ?? null);
      }

      // Load existing clubs
      if ((memberships ?? []).length > 0) {
        const clubIds = (memberships as any[]).map((m) => m.club_id);
        const { data: clubs } = await supabase
          .from("clubs")
          .select("id, name, city, state")
          .in("id", clubIds);
        if (clubs) setMyClubs(clubs as ClubRow[]);
      }

      if (mounted) setLoading(false);
    }

    let handled = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      if (session?.user) checkAuth(session.user);
      else router.replace("/login");
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled && mounted) {
        if (session?.user) checkAuth(session.user);
        else router.replace("/login");
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

  const shownAvatar = avatarPreview ?? avatarUrl ?? null;
  const hasName = Boolean(displayName.trim());

  async function onPickAvatar(file: File) {
    try {
      setUploading(true);
      setError(null);

      if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Please upload an image under 5MB.");
      if (!userId) throw new Error("Not signed in.");

      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(URL.createObjectURL(file));

      const ext = getFileExt(file.name);
      const filePath = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(filePath);
      if (!publicData?.publicUrl) throw new Error("Upload succeeded but no public URL returned.");

      setAvatarUrl(publicData.publicUrl);
    } catch (e: any) {
      setError(e?.message ?? "Avatar upload failed");
    } finally {
      setUploading(false);
    }
  }

  // Club search
  const ctSuggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const myNames = new Set(myClubs.map((c) => c.name.toLowerCase()));
    return CT_CLUBS.filter((name) => name.toLowerCase().includes(q) && !myNames.has(name.toLowerCase())).slice(0, 8);
  }, [addQuery, myClubs]);

  function searchApi(q: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) { setApiResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/golf-courses?q=${encodeURIComponent(trimmed)}&limit=8`);
        const json = await res.json();
        setApiResults(json.courses ?? []);
      } catch { setApiResults([]); }
      setSearching(false);
    }, 400);
  }

  async function addClub(clubName: string) {
    if (!userId) return;
    setError(null);

    // Ensure profile exists
    await supabase.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });

    // Find or create club
    const { data: existing } = await supabase
      .from("clubs")
      .select("id, name, city, state")
      .ilike("name", clubName.trim())
      .maybeSingle();

    let club: ClubRow;

    if (existing) {
      club = existing as ClubRow;
    } else {
      const { data, error: err } = await supabase
        .from("clubs")
        .insert({ name: clubName.trim() })
        .select("id, name, city, state")
        .single();
      if (err) { setError(err.message); return; }
      club = data as ClubRow;
    }

    // Check if already added
    if (myClubs.some((c) => c.id === club.id)) {
      setError("You've already added this club.");
      return;
    }

    const { error: memErr } = await supabase
      .from("club_memberships")
      .insert({ user_id: userId, club_id: club.id });

    if (memErr) {
      if (memErr.message.includes("duplicate")) setError("You've already added this club.");
      else setError(memErr.message);
      return;
    }

    setMyClubs((prev) => [...prev, club]);
    setAddQuery("");
    setApiResults([]);
  }

  async function removeClub(clubId: string) {
    if (!userId) return;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/club-membership", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ clubId }),
    });
    setMyClubs((prev) => prev.filter((c) => c.id !== clubId));
  }

  async function completeOnboarding() {
    if (!userId) return;
    setSaving(true);
    setError(null);

    try {
      const nameToSave = displayName.trim() || null;
      const hcpToSave = safeNum(handicap);

      const { error: profErr } = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            email,
            display_name: nameToSave,
            handicap_index: hcpToSave,
            avatar_url: avatarUrl ?? null,
          },
          { onConflict: "id" }
        );

      if (profErr) throw profErr;

      // Update auth metadata
      await supabase.auth.updateUser({
        data: {
          display_name: nameToSave,
          name: nameToSave,
          handicap_index: hcpToSave,
          onboarded: true,
        },
      });

      router.replace(nextUrl);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  function canAdvance() {
    if (step === 0) return hasName;
    if (step === 1) return true; // handicap is optional
    if (step === 2) return myClubs.length > 0 && agreedToVerification;
    return true;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--paper)]">
        <div className="text-sm text-[var(--muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[rgba(246,241,231,.14)] bg-[var(--pine)] text-[var(--paper)] shadow-[0_1px_3px_rgba(0,0,0,.12)]">
        <div className="mx-auto flex h-14 w-full max-w-[600px] items-center justify-between px-4">
          <span className="text-[11px] font-medium tracking-[0.3em] opacity-90">RECIPROCITY</span>
          <span className="text-xs opacity-60">Setup your profile</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[600px] px-4 py-8 sm:py-12">
        {/* Step indicator */}
        <div className="mb-8 flex justify-center">
          <StepIndicator current={step} steps={STEPS} />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Profile */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Let's get started</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Tell us who you are. Your name and photo will be visible to other players.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-[160px_1fr]">
                {/* Avatar */}
                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">Photo</div>
                  <div className="relative mx-auto h-32 w-32 overflow-hidden rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--paper-2)] transition hover:border-[var(--pine)]/30 sm:mx-0">
                    {shownAvatar ? (
                      <Image
                        src={shownAvatar}
                        alt="Avatar"
                        width={128}
                        height={128}
                        className="h-full w-full object-cover"
                        unoptimized={shownAvatar.startsWith("blob:")}
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                        <svg className="h-8 w-8 text-[var(--muted)]/40" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                        <span className="text-[10px] text-[var(--muted)]">No photo</span>
                      </div>
                    )}
                  </div>
                  <label
                    className={cx(
                      "mx-auto flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium transition sm:mx-0",
                      uploading ? "opacity-60 cursor-not-allowed" : "hover:bg-white hover:shadow-sm hover:border-[var(--pine)]/30"
                    )}
                  >
                    {uploading ? "Uploading..." : "Upload photo"}
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
                </div>

                {/* Name */}
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
                      Full name <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g., John Westbrook III"
                      autoFocus
                    />
                    <p className="text-xs text-[var(--muted)]">This is how opponents and club members will see you.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
                      Email
                    </label>
                    <div className="w-full rounded-xl border border-[var(--border)] bg-black/[0.02] px-4 py-3 text-sm text-[var(--muted)]">
                      {email ?? "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Handicap */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Your game</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Help us set up fair matches. You can update these anytime.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 shadow-sm space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
                  USGA Handicap Index
                </label>
                <input
                  className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:bg-white focus:border-[var(--pine)]/40 focus:shadow-sm"
                  value={handicap}
                  onChange={(e) => setHandicap(e.target.value)}
                  placeholder="e.g., 12.4"
                  inputMode="decimal"
                  autoFocus
                />
                <p className="text-xs text-[var(--muted)]">
                  Your official GHIN handicap index. Used for net scoring and ladder placement.
                  Leave blank if you don't have one yet.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)]">
                  Preferred tees
                </label>
                <div className="flex flex-wrap gap-2">
                  {["Black", "Blue", "White", "Gold", "Red"].map((tee) => (
                    <button
                      key={tee}
                      type="button"
                      onClick={() => setPreferredTees(tee)}
                      className={cx(
                        "rounded-xl px-4 py-2 text-sm font-medium transition",
                        preferredTees === tee
                          ? "bg-[var(--pine)] text-white shadow-sm"
                          : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--paper)]"
                      )}
                    >
                      {tee}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Your default tee selection. Can be changed per match.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Club Memberships */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Club memberships</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Add the clubs where you hold an active membership. At least one is required.
              </p>
            </div>

            {/* Verification warning */}
            <div className="rounded-2xl border-2 border-red-200 bg-red-50/60 p-5">
              <div className="flex gap-3">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-red-900">Membership verification notice</div>
                  <p className="mt-1 text-sm text-red-800">
                    All club memberships are subject to verification. We cross-reference membership
                    claims with club records and pro shop staff. Falsely claiming membership at a
                    club you do not belong to will result in <span className="font-bold">immediate and permanent account suspension</span>.
                  </p>
                  <p className="mt-2 text-xs text-red-700">
                    Only add clubs where you are a current, dues-paying member.
                  </p>
                </div>
              </div>
            </div>

            {/* Added clubs */}
            {myClubs.length > 0 && (
              <div className="space-y-2">
                {myClubs.map((c) => {
                  const loc = [c.city, c.state].filter(Boolean).join(", ");
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--pine)] text-xs font-semibold text-white">
                          {initials(c.name)}
                        </div>
                        <div>
                          <div className="text-sm font-semibold">{c.name}</div>
                          {loc && <div className="text-xs text-[var(--muted)]">{loc}</div>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeClub(c.id)}
                        className="text-xs text-[var(--muted)] transition hover:text-red-500"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Club search */}
            <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)] mb-3">
                Search for your club
              </div>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)]/40 focus:shadow-sm"
                value={addQuery}
                onChange={(e) => { setAddQuery(e.target.value); searchApi(e.target.value); }}
                placeholder="Search golf clubs..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && addQuery.trim()) addClub(addQuery);
                }}
              />

              <div className="mt-2 max-h-[240px] overflow-auto space-y-0.5">
                {ctSuggestions.map((name) => (
                  <button
                    key={`ct-${name}`}
                    type="button"
                    onClick={() => addClub(name)}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--pine)]/5"
                  >
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-[var(--muted)]">Connecticut</div>
                  </button>
                ))}

                {ctSuggestions.length > 0 && apiResults.length > 0 && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-[var(--muted)] uppercase">Other courses</div>
                )}
                {apiResults
                  .filter((c) => !ctSuggestions.some((ct) => ct.toLowerCase() === c.club_name.toLowerCase()))
                  .map((c) => {
                    const loc = [c.city, c.state].filter(Boolean).join(", ");
                    return (
                      <button
                        key={`api-${c.id}`}
                        type="button"
                        onClick={() => addClub(c.club_name)}
                        className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[var(--pine)]/5"
                      >
                        <div className="text-sm font-medium">{c.club_name}</div>
                        {loc && <div className="text-xs text-[var(--muted)]">{loc}</div>}
                      </button>
                    );
                  })}

                {searching && <div className="px-3 py-2.5 text-xs text-[var(--muted)]">Searching nationwide...</div>}

                {addQuery.trim().length >= 2 && ctSuggestions.length === 0 && !searching && apiResults.length === 0 && (
                  <div className="px-3 py-2.5 text-xs text-[var(--muted)]">No matching clubs found.</div>
                )}

                {addQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => addClub(addQuery)}
                    className="w-full rounded-lg bg-[var(--pine)]/5 px-3 py-2.5 text-left text-sm font-medium text-[var(--pine)] transition hover:bg-[var(--pine)]/10"
                  >
                    Add &ldquo;{addQuery.trim()}&rdquo; manually
                  </button>
                )}
              </div>
            </div>

            {/* Verification checkbox */}
            {myClubs.length > 0 && (
              <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-[var(--border)] bg-white/60 p-4 transition hover:bg-white/80">
                <input
                  type="checkbox"
                  checked={agreedToVerification}
                  onChange={(e) => setAgreedToVerification(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[var(--pine)] accent-[var(--pine)]"
                />
                <span className="text-sm text-[var(--ink)]">
                  I confirm that I am a current, active member at{" "}
                  {myClubs.length === 1
                    ? <span className="font-semibold">{myClubs[0].name}</span>
                    : <>each of the <span className="font-semibold">{myClubs.length} clubs</span> listed above</>
                  }
                  {" "}and understand that false claims will result in account suspension.
                </span>
              </label>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">You're all set</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Review your profile below. You can edit any of this later from your profile page.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 shadow-sm space-y-5">
              {/* Profile summary */}
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-[var(--pine)] text-white">
                  {shownAvatar ? (
                    <Image
                      src={shownAvatar}
                      alt="Avatar"
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      unoptimized={shownAvatar.startsWith("blob:")}
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-lg font-bold">
                      {initials(displayName)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-lg font-bold">{displayName}</div>
                  <div className="text-xs text-[var(--muted)]">{email}</div>
                </div>
              </div>

              <div className="border-t border-[var(--border)] pt-4 grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">Handicap</div>
                  <div className="mt-0.5 text-sm font-semibold">{handicap || "Not set"}</div>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">Preferred tees</div>
                  <div className="mt-0.5 text-sm font-semibold">{preferredTees}</div>
                </div>
              </div>

              <div className="border-t border-[var(--border)] pt-4">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)] mb-2">Club memberships</div>
                <div className="space-y-1.5">
                  {myClubs.map((c) => (
                    <div key={c.id} className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--pine)] text-[10px] font-semibold text-white">
                        {initials(c.name)}
                      </div>
                      <span className="text-sm font-medium">{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => { setStep(step - 1); setError(null); }}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-medium transition hover:bg-[var(--paper)] hover:shadow-sm"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M8.5 3L4.5 7L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          ) : (
            <div />
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => { setStep(step + 1); setError(null); }}
              disabled={!canAdvance()}
              className={cx(
                "flex items-center gap-1.5 rounded-xl px-6 py-2.5 text-sm font-semibold transition",
                canAdvance()
                  ? "bg-[var(--pine)] text-white shadow-sm hover:shadow-md hover:-translate-y-px"
                  : "bg-black/[0.06] text-[var(--muted)] cursor-not-allowed"
              )}
            >
              Continue
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5.5 3L9.5 7L5.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={completeOnboarding}
              disabled={saving}
              className="rounded-xl bg-[var(--pine)] px-8 py-2.5 text-sm font-bold text-white shadow-sm transition hover:shadow-md hover:-translate-y-px disabled:opacity-60"
            >
              {saving ? "Setting up..." : "Complete setup"}
            </button>
          )}
        </div>

        {/* Step hint */}
        {step === 0 && !hasName && (
          <div className="mt-3 text-center text-xs text-[var(--muted)]">
            Enter your name to continue.
          </div>
        )}
        {step === 2 && myClubs.length === 0 && (
          <div className="mt-3 text-center text-xs text-[var(--muted)]">
            Add at least one club membership to continue.
          </div>
        )}
        {step === 2 && myClubs.length > 0 && !agreedToVerification && (
          <div className="mt-3 text-center text-xs text-[var(--muted)]">
            Confirm your membership verification to continue.
          </div>
        )}
      </div>
    </div>
  );
}
