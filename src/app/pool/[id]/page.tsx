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

type PoolRating = {
  avg: number;
  count: number;
};

type ClubMembership = {
  club_name: string;
  guest_fee: number | null;
};

type Application = {
  id: string;
  applicant_id: string;
  message: string | null;
  status: string;
  created_at: string;
  profile: Profile | null;
  pool_rating: PoolRating | null;
  clubs: ClubMembership[];
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
  hole_count?: number;
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

function StarRating({
  value,
  onChange,
  readonly = false,
  size = 16,
}: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: number;
}) {
  return (
    <div className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={cx(
            "transition",
            readonly ? "cursor-default" : "cursor-pointer hover:scale-110"
          )}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={star <= value ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
            className={star <= value ? "text-amber-400" : "text-slate-300"}
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function RatingBadge({ rating }: { rating: PoolRating }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-amber-400">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      <span className="text-[10px] font-semibold text-amber-700">{rating.avg}</span>
      <span className="text-[10px] text-amber-600/70">({rating.count})</span>
    </div>
  );
}

export default function PoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [listing, setListing] = useState<Listing | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [myApplication, setMyApplication] = useState<Application | null>(null);
  const [myRatings, setMyRatings] = useState<Record<string, { rating: number; comment: string | null }>>({});
  const [hasAttested, setHasAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState("");
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rating form state
  const [ratingPlayerId, setRatingPlayerId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editAutoAccept, setEditAutoAccept] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

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
        setMyRatings(json.myRatings ?? {});
        setHasAttested(json.hasAttested ?? false);
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
      await loadDetail();
      setShowApplyForm(false);
      setApplyMessage("");
      setRatingPlayerId(null);
      setRatingValue(0);
      setRatingComment("");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    }
    setActionLoading(null);
  }

  function startEditing() {
    if (!listing) return;
    setEditNotes(listing.notes ?? "");
    setEditAutoAccept(listing.auto_accept);
    setEditing(true);
  }

  async function saveEdit() {
    setEditSaving(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/pool/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          notes: editNotes.trim() || null,
          auto_accept: editAutoAccept,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Save failed");
      } else {
        setEditing(false);
        await loadDetail();
      }
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    }
    setEditSaving(false);
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
  const isCompleted = listing.status === "completed";
  const isClosed = isCancelled || isExpired;
  const roundPassed = new Date(listing.round_time).getTime() < Date.now();
  const timeGate = (listing.hole_count ?? 18) === 9
    ? 1 * 60 * 60 * 1000 + 35 * 60 * 1000  // 1:35
    : 3 * 60 * 60 * 1000 + 15 * 60 * 1000;  // 3:15
  const roundPlus5h = new Date(listing.round_time).getTime() + timeGate < Date.now();

  // Players the creator can rate (accepted applicants, after round completed)
  const ratablePlayers = isCreator && isCompleted
    ? acceptedApps.filter((a) => !myRatings[a.applicant_id])
    : [];

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
          {listing.hole_count && listing.hole_count !== 18 && (
            <div className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-600">
              {listing.hole_count} holes
            </div>
          )}
          {listing.auto_accept && (
            <div className="rounded-full bg-purple-50 px-2.5 py-1 font-medium text-purple-600">
              Auto-accept
            </div>
          )}
        </div>

        {/* Edit button for creator */}
        {isCreator && !isClosed && !isCompleted && !editing && (
          <button
            type="button"
            onClick={startEditing}
            className="text-xs font-medium text-[var(--pine)] hover:underline"
          >
            Edit listing
          </button>
        )}

        {/* Edit form */}
        {editing && (
          <div className="space-y-3 rounded-xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-3">
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Anything players should know…"
                rows={3}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm resize-none"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editAutoAccept}
                onChange={(e) => setEditAutoAccept(e.target.checked)}
                className="h-4 w-4 rounded accent-[var(--pine)]"
              />
              <span className="text-sm">Auto-accept players</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 rounded-lg bg-[var(--pine)] py-2 text-xs font-semibold text-white hover:bg-[var(--pine)]/90 disabled:opacity-60"
              >
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs text-[var(--muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {listing.notes && !editing && (
          <div className="rounded-xl bg-[var(--paper)] p-3 text-sm text-[var(--ink)]">
            {listing.notes}
          </div>
        )}

        {/* Organizer */}
        <div>
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Organizer</div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--green-light)] text-[10px] font-bold text-[var(--pine)]">
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
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--green-light)] text-[8px] font-bold text-[var(--pine)]">
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
                  {a.pool_rating && <RatingBadge rating={a.pool_rating} />}
                  {myRatings[a.applicant_id] && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--muted)]">
                      Your rating: <StarRating value={myRatings[a.applicant_id].rating} readonly size={12} />
                    </span>
                  )}
                  {!myRatings[a.applicant_id] && (
                    <span className="ml-auto text-[10px] font-medium text-emerald-600">Accepted</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Creator: Pending applications — show pool rating to help decide */}
      {isCreator && pendingApps.length > 0 && (
        <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 p-4 space-y-3">
          <div className="text-sm font-semibold text-amber-800">
            Pending Requests ({pendingApps.length})
          </div>
          {pendingApps.map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--border)] bg-white p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--green-light)] text-[9px] font-bold text-[var(--pine)]">
                  {initials(a.profile?.display_name ?? "?")}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{a.profile?.display_name ?? "Player"}</span>
                    {a.pool_rating && <RatingBadge rating={a.pool_rating} />}
                  </div>
                  {a.profile?.handicap_index != null && (
                    <div className="text-xs text-amber-700">HCP {a.profile.handicap_index}</div>
                  )}
                  {!a.pool_rating && (
                    <div className="text-[10px] text-[var(--muted)]">No pool ratings yet</div>
                  )}
                </div>
              </div>
              {a.clubs && a.clubs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {a.clubs.map((c: ClubMembership, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /></svg>
                      {c.club_name}
                      {c.guest_fee != null && <span className="text-blue-500">${c.guest_fee}</span>}
                    </span>
                  ))}
                </div>
              )}
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

      {/* Creator: Rate players after round */}
      {ratablePlayers.length > 0 && (
        <div className="rounded-2xl border border-[var(--pine)]/20 bg-[var(--pine)]/5 p-4 space-y-3">
          <div className="text-sm font-semibold text-[var(--pine)]">
            Rate Your Players
          </div>
          <p className="text-xs text-[var(--muted)]">
            How was your experience? Ratings help other organizers make decisions.
          </p>
          {ratablePlayers.map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--border)] bg-white p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--green-light)] text-[9px] font-bold text-[var(--pine)]">
                  {initials(a.profile?.display_name ?? "?")}
                </div>
                <span className="text-sm font-semibold">{a.profile?.display_name ?? "Player"}</span>
              </div>
              {ratingPlayerId === a.applicant_id ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">Rating:</span>
                    <StarRating value={ratingValue} onChange={setRatingValue} />
                  </div>
                  <textarea
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Quick comment (optional)"
                    rows={2}
                    className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => doAction("rate", {
                        rated_id: a.applicant_id,
                        rating: ratingValue,
                        comment: ratingComment.trim() || null,
                      })}
                      disabled={ratingValue === 0 || actionLoading !== null}
                      className="flex-1 rounded-lg bg-[var(--pine)] py-1.5 text-xs font-semibold text-white hover:bg-[var(--pine)]/90 disabled:opacity-50"
                    >
                      {actionLoading === "rate" ? "Submitting…" : "Submit Rating"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRatingPlayerId(null); setRatingValue(0); setRatingComment(""); }}
                      className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs text-[var(--muted)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setRatingPlayerId(a.applicant_id); setRatingValue(0); setRatingComment(""); }}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--paper)] py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-black/[0.05]"
                >
                  Rate this player
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Non-creator: Apply */}
      {!isCreator && !isClosed && !isCompleted && !myApplication && slotsOpen > 0 && (
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
            {myApplication.status === "accepted"
              ? listing.status === "completed"
                ? hasAttested ? "Round confirmed. The host earned a Tee." : "Round complete. You'll be prompted to confirm it occurred."
                : roundPassed ? "Hope you had a great round!" : "You're in! See you on the course."
              : myApplication.status === "denied" ? "Your request was declined."
              : "Your request is pending approval."}
          </div>
        </div>
      )}

      {/* Creator: Complete round (after tee time + 5 hours) */}
      {isCreator && roundPlus5h && listing.status !== "completed" && !isClosed && (
        <button
          type="button"
          onClick={() => {
            if (!confirm("Mark this round as complete? 1 Tee will be deducted from each guest.")) return;
            doAction("complete_round");
          }}
          disabled={actionLoading !== null}
          className="w-full rounded-xl bg-[var(--pine)] py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-60"
        >
          {actionLoading === "complete_round" ? "Completing…" : "Complete Round"}
        </button>
      )}

      {isCreator && listing.status === "completed" && (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">
          Round completed. Guests will be prompted to confirm it occurred.
        </div>
      )}

      {/* Creator: Cancel listing */}
      {isCreator && !isClosed && listing.status !== "completed" && (
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
