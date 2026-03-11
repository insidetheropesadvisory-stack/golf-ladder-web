"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/supabase";
import { cx, initials } from "@/lib/utils";

type Profile = {
  id: string;
  display_name: string | null;
  handicap_index: number | null;
  avatar_url: string | null;
};

type CommittedPlayer = {
  id: string;
  player_id: string | null;
  player_name: string | null;
  profile: Profile | null;
};

type Application = {
  id: string;
  applicant_id: string;
  message: string | null;
  status: string;
  created_at: string;
  profile: Profile | null;
};

type Listing = {
  id: string;
  creator_id: string;
  course_name: string;
  round_time: string;
  total_slots: number;
  guest_fee: number | null;
  selected_tee: string | null;
  notes: string | null;
  auto_accept: boolean;
  status: string;
  city: string | null;
  state: string | null;
  creator: Profile | null;
  committed: CommittedPlayer[];
  applications: Application[];
  slots_filled: number;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function timeUntil(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Starting soon";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h away`;
  return `${hours}h away`;
}

export default function PoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [myApplication, setMyApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDetail();
  }, [id]);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function loadDetail() {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/pool/${id}`, { headers });
      const json = await res.json();
      if (res.ok) {
        setListing(json.listing);
        setIsCreator(json.isCreator);
        setMyApplication(json.myApplication);
      }
    } catch {}
    setLoading(false);
  }

  async function doAction(action: string, extra?: Record<string, any>) {
    setActionLoading(action);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/pool/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Action failed");
        setActionLoading(null);
        return;
      }
      // Reload
      await loadDetail();
      setShowApplyForm(false);
      setApplyMessage("");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    }
    setActionLoading(null);
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-[var(--paper-2)]" />
        <div className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--paper-2)]" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
        <div className="text-sm font-medium">Listing not found</div>
        <Link href="/pool" className="mt-2 inline-block text-sm text-[var(--pine)] hover:underline">
          Back to Pool
        </Link>
      </div>
    );
  }

  const slotsOpen = listing.total_slots - listing.slots_filled;
  const pendingApps = listing.applications.filter((a) => a.status === "pending");
  const acceptedApps = listing.applications.filter((a) => a.status === "accepted");
  const isCancelled = listing.status === "cancelled";
  const isExpired = listing.status === "expired";
  const isClosed = isCancelled || isExpired;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* Back */}
      <Link href="/pool" className="inline-flex items-center gap-1 text-sm text-[var(--muted)] hover:text-[var(--pine)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        Pool
      </Link>

      {/* Status banner */}
      {isClosed && (
        <div className={cx(
          "rounded-xl px-4 py-3 text-sm font-medium",
          isCancelled ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
        )}>
          {isCancelled ? "This listing has been cancelled." : "This listing has expired."}
        </div>
      )}

      {/* Main card */}
      <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{listing.course_name}</h1>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {formatDate(listing.round_time)}
              <span className="ml-2 text-xs">({timeUntil(listing.round_time)})</span>
            </div>
            {listing.city && (
              <div className="mt-0.5 text-xs text-[var(--muted)]">
                {[listing.city, listing.state].filter(Boolean).join(", ")}
              </div>
            )}
          </div>
          <span className={cx(
            "shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            isClosed ? "bg-slate-100 text-slate-500 border-slate-200/60" :
            slotsOpen > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200/60" :
            "bg-amber-50 text-amber-700 border-amber-200/60"
          )}>
            {isClosed ? listing.status :
             slotsOpen > 0 ? `${slotsOpen} slot${slotsOpen > 1 ? "s" : ""} open` : "Full"}
          </span>
        </div>

        {/* Details row */}
        <div className="flex flex-wrap gap-3 text-xs">
          {listing.guest_fee != null && (
            <div className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              ${listing.guest_fee} guest fee
            </div>
          )}
          {listing.selected_tee && (
            <div className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-600">
              {listing.selected_tee} tees
            </div>
          )}
          {listing.auto_accept && (
            <div className="rounded-full bg-purple-50 px-2.5 py-1 font-medium text-purple-600">
              Auto-accept
            </div>
          )}
        </div>

        {listing.notes && (
          <div className="rounded-xl bg-[var(--paper)] p-3 text-sm text-[var(--ink)]">
            {listing.notes}
          </div>
        )}

        {/* Organizer */}
        <div>
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Organizer</div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--pine)] text-[10px] font-bold text-white">
              {initials(listing.creator?.display_name ?? "?")}
            </div>
            <div>
              <div className="text-sm font-semibold">{listing.creator?.display_name ?? "Organizer"}</div>
              {listing.creator?.handicap_index != null && (
                <div className="text-xs text-amber-700">Handicap: {listing.creator.handicap_index}</div>
              )}
            </div>
          </div>
        </div>

        {/* Committed Players */}
        {listing.committed.length > 0 && (
          <div>
            <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">
              In the Group
            </div>
            <div className="space-y-1.5">
              {listing.committed.map((c) => {
                const name = c.profile?.display_name ?? c.player_name ?? "Player";
                return (
                  <div key={c.id} className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--pine)] text-[8px] font-bold text-white">
                      {initials(name)}
                    </div>
                    <span className="text-sm font-medium">{name}</span>
                    {c.profile?.handicap_index != null && (
                      <span className="text-xs text-amber-700">({c.profile.handicap_index})</span>
                    )}
                    {!c.player_id && <span className="text-[10px] text-[var(--muted)]">Guest</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Accepted Players */}
        {acceptedApps.length > 0 && (
          <div>
            <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">
              Accepted Players
            </div>
            <div className="space-y-1.5">
              {acceptedApps.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-xl border border-emerald-200/60 bg-emerald-50/50 px-3 py-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold text-white">
                    {initials(a.profile?.display_name ?? "?")}
                  </div>
                  <span className="text-sm font-medium">{a.profile?.display_name ?? "Player"}</span>
                  {a.profile?.handicap_index != null && (
                    <span className="text-xs text-amber-700">({a.profile.handicap_index})</span>
                  )}
                  <span className="ml-auto text-[10px] font-medium text-emerald-600">Accepted</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Creator: Pending applications */}
      {isCreator && pendingApps.length > 0 && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-4 space-y-3">
          <div className="text-sm font-semibold text-amber-800">
            Pending Requests ({pendingApps.length})
          </div>
          {pendingApps.map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--border)] bg-white p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--pine)] text-[9px] font-bold text-white">
                  {initials(a.profile?.display_name ?? "?")}
                </div>
                <div>
                  <div className="text-sm font-semibold">{a.profile?.display_name ?? "Player"}</div>
                  {a.profile?.handicap_index != null && (
                    <div className="text-xs text-amber-700">HCP {a.profile.handicap_index}</div>
                  )}
                </div>
              </div>
              {a.message && (
                <div className="rounded-lg bg-[var(--paper)] px-3 py-2 text-xs text-[var(--ink)]">
                  {a.message}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => doAction("accept", { application_id: a.id })}
                  disabled={actionLoading !== null}
                  className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionLoading === "accept" ? "…" : "Accept"}
                </button>
                <button
                  type="button"
                  onClick={() => doAction("deny", { application_id: a.id })}
                  disabled={actionLoading !== null}
                  className="flex-1 rounded-lg bg-red-100 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                >
                  {actionLoading === "deny" ? "…" : "Decline"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Non-creator: Apply */}
      {!isCreator && !isClosed && !myApplication && slotsOpen > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-4 space-y-3">
          {!showApplyForm ? (
            <button
              type="button"
              onClick={() => setShowApplyForm(true)}
              className="w-full rounded-xl bg-[var(--pine)] py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
            >
              {listing.auto_accept ? "Join This Group" : "Request to Join"}
            </button>
          ) : (
            <>
              <div className="text-sm font-semibold">
                {listing.auto_accept ? "Join this group" : "Send a request to the organizer"}
              </div>
              <textarea
                value={applyMessage}
                onChange={(e) => setApplyMessage(e.target.value)}
                placeholder="Introduce yourself (optional)"
                rows={2}
                className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => doAction("apply", { message: applyMessage.trim() || null })}
                  disabled={actionLoading !== null}
                  className="flex-1 rounded-xl bg-[var(--pine)] py-2.5 text-sm font-semibold text-white shadow-sm hover:shadow-md disabled:opacity-60"
                >
                  {actionLoading === "apply" ? "Sending…" : listing.auto_accept ? "Join" : "Send Request"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowApplyForm(false); setApplyMessage(""); }}
                  className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:bg-black/[0.03]"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Non-creator: Application status */}
      {!isCreator && myApplication && (
        <div className={cx(
          "rounded-2xl border p-4 text-center",
          myApplication.status === "accepted" ? "border-emerald-200/60 bg-emerald-50/50" :
          myApplication.status === "denied" ? "border-red-200/60 bg-red-50/50" :
          "border-amber-200/60 bg-amber-50/50"
        )}>
          <div className={cx(
            "text-sm font-semibold",
            myApplication.status === "accepted" ? "text-emerald-700" :
            myApplication.status === "denied" ? "text-red-700" :
            "text-amber-700"
          )}>
            {myApplication.status === "accepted" ? "You're in! See you on the course." :
             myApplication.status === "denied" ? "Your request was declined." :
             "Your request is pending approval."}
          </div>
        </div>
      )}

      {/* Creator: Cancel listing */}
      {isCreator && !isClosed && (
        <button
          type="button"
          onClick={() => {
            if (!confirm("Cancel this listing? All accepted players will be notified.")) return;
            doAction("cancel");
          }}
          disabled={actionLoading !== null}
          className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Cancel Listing
        </button>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
    </div>
  );
}
