"use client";

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

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const shownAvatar = avatarPreview ?? avatarUrl ?? null;

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] tracking-[0.28em] text-gray-500">RECIPROCITY</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Profile</h1>
            <p className="mt-2 text-sm text-gray-600">
              Update your name, handicap, and photo.
              {email ? <span className="ml-2">({email})</span> : null}
            </p>
          </div>

          <div className="flex gap-3">
            <Link className="underline" href="/">
              Home
            </Link>
            <button className="underline" onClick={logout} type="button">
              Logout
            </button>
          </div>
        </div>

        {showNameRequired ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--paper-2)] p-5 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
            <div className="text-sm font-semibold">Add your name to create matches</div>
            <div className="mt-2 text-sm text-[var(--muted)]">
              Set a display name, save, and you’ll be sent right back.
            </div>
          </div>
        ) : null}

        {fatal ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {fatal}
          </div>
        ) : null}

        {toast ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            {toast}
          </div>
        ) : null}

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_10px_28px_rgba(17,19,18,.06)]">
          {loading ? (
            <div className="text-sm text-gray-600">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
              <div className="space-y-3">
                <div className="text-xs font-medium tracking-wide text-gray-600">PHOTO</div>

                <div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                  {shownAvatar ? (
                    <img
                      src={shownAvatar}
                      alt="Avatar"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
                      No photo
                    </div>
                  )}
                </div>

                <label
                  className={cx(
                    "inline-flex cursor-pointer items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition",
                    uploading ? "opacity-60" : "hover:bg-gray-50"
                  )}
                >
                  {uploading ? "Uploading…" : "Upload photo"}
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

                <div className="text-xs text-gray-500">PNG or JPG, up to 5MB.</div>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="text-xs font-medium tracking-wide text-gray-600">
                    DISPLAY NAME
                  </div>
                  <input
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-400"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Ned Roosevelt"
                  />
                </div>

                <div>
                  <div className="text-xs font-medium tracking-wide text-gray-600">
                    HANDICAP INDEX
                  </div>
                  <input
                    className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-gray-400"
                    value={handicap}
                    onChange={(e) => setHandicap(e.target.value)}
                    placeholder="e.g., 9.8"
                    inputMode="decimal"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={cx(
                      "rounded-full px-5 py-2 text-sm font-medium transition",
                      hasChanges && !saving
                        ? "bg-[var(--pine)] text-white hover:-translate-y-[1px]"
                        : "bg-gray-100 text-gray-400"
                    )}
                    disabled={!hasChanges || saving}
                    onClick={save}
                    type="button"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>

                  <Link className="text-sm underline text-gray-600" href={next}>
                    Back
                  </Link>

                  {showNameRequired && next !== "/" && hasName ? (
                    <Link
                      href={next}
                      className="rounded-full border border-[var(--border)] bg-white/60 px-4 py-2 text-sm font-medium hover:bg-white/80"
                    >
                      Continue →
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
      </div>
    </main>
  );
}