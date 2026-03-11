"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker } from "@/app/components/ClubPicker";
import { cx, initials } from "@/lib/utils";

type CommittedPlayer = {
  id: string | null;
  name: string;
  handicap_index?: number | null;
};

type SearchResult = {
  id: string;
  display_name: string | null;
  handicap_index: number | null;
};

export default function NewPoolPage() {
  const router = useRouter();
  const [meId, setMeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [courseName, setCourseName] = useState("");
  const [courseApiId, setCourseApiId] = useState<string | null>(null);
  const [courseCity, setCourseCity] = useState<string | null>(null);
  const [courseState, setCourseState] = useState<string | null>(null);
  const [roundDate, setRoundDate] = useState("");
  const [roundTime, setRoundTime] = useState("");
  const [totalSlots, setTotalSlots] = useState(1);
  const [guestFee, setGuestFee] = useState("");
  const [notes, setNotes] = useState("");
  const [autoAccept, setAutoAccept] = useState(false);

  // Committed players
  const [committed, setCommitted] = useState<CommittedPlayer[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [manualName, setManualName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        router.replace("/login");
        return;
      }
      setMeId(session.user.id);
    });
  }, [router]);

  // Search players
  useEffect(() => {
    if (playerSearch.length < 2) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, handicap_index")
        .ilike("display_name", `%${playerSearch}%`)
        .neq("id", meId ?? "")
        .limit(8);
      setSearchResults(data ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [playerSearch, meId]);

  function addCommittedPlayer(player: SearchResult) {
    if (committed.find((c) => c.id === player.id)) return;
    setCommitted((prev) => [
      ...prev,
      { id: player.id, name: player.display_name || "Player", handicap_index: player.handicap_index },
    ]);
    setPlayerSearch("");
    setSearchResults([]);
  }

  function addManualPlayer() {
    const name = manualName.trim();
    if (!name) return;
    setCommitted((prev) => [...prev, { id: null, name }]);
    setManualName("");
  }

  function removeCommitted(index: number) {
    setCommitted((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!courseName.trim()) { setError("Select a course"); return; }
    if (!roundDate || !roundTime) { setError("Set the date and time"); return; }

    const roundDateTime = new Date(`${roundDate}T${roundTime}`).toISOString();

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/pool", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          course_name: courseName,
          golf_course_api_id: courseApiId,
          round_time: roundDateTime,
          total_slots: totalSlots,
          guest_fee: guestFee ? Number(guestFee) : null,
          notes: notes.trim() || null,
          auto_accept: autoAccept,
          city: courseCity,
          state: courseState,
          committed_players: committed.map((c) => ({ id: c.id, name: c.name })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to create listing");
        setSaving(false);
        return;
      }
      router.push(`/pool/${json.listing.id}`);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong");
      setSaving(false);
    }
  }

  // Minimum date = tomorrow
  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  if (!meId) return null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Offer Slots</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Let others join your round</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Course */}
        <ClubPicker
          value={courseName}
          onChange={setCourseName}
          onCourseApiIdChange={setCourseApiId}
          onGuestFeeChange={(fee) => { if (fee != null) setGuestFee(String(fee)); }}
          onLocationChange={(city, state) => { setCourseCity(city); setCourseState(state); }}
          userId={meId}
          placeholder="Search your clubs…"
          myClubsOnly
        />

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Date</label>
            <input
              type="date"
              value={roundDate}
              min={minDate}
              onChange={(e) => setRoundDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium">Tee Time</label>
            <input
              type="time"
              value={roundTime}
              onChange={(e) => setRoundTime(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm"
              required
            />
          </div>
        </div>

        {/* Open Slots */}
        <div>
          <label className="text-sm font-medium">Open Slots</label>
          <p className="text-xs text-[var(--muted)]">How many players can join?</p>
          <div className="mt-2 flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTotalSlots(n)}
                className={cx(
                  "flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-semibold transition",
                  totalSlots === n
                    ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                    : "border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--pine)]/40"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Committed Players */}
        <div>
          <label className="text-sm font-medium">Committed Players</label>
          <p className="text-xs text-[var(--muted)]">Who is already playing? (optional)</p>

          {committed.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {committed.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--pine)] text-[9px] font-bold text-white">
                      {initials(c.name)}
                    </div>
                    <span className="text-sm font-medium">{c.name}</span>
                    {c.handicap_index != null && (
                      <span className="text-xs text-amber-700">({c.handicap_index})</span>
                    )}
                    {!c.id && <span className="text-[10px] text-[var(--muted)]">Guest</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeCommitted(i)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Search registered players */}
          <div className="relative mt-2">
            <input
              type="text"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder="Search registered players…"
              className="w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm"
            />
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-xl border border-[var(--border)] bg-white shadow-lg">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addCommittedPlayer(p)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/[0.03]"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--pine)] text-[9px] font-bold text-white">
                      {initials(p.display_name ?? "?")}
                    </div>
                    <span className="font-medium">{p.display_name}</span>
                    {p.handicap_index != null && (
                      <span className="text-xs text-amber-700">({p.handicap_index})</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add guest manually */}
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Add a guest by name…"
              className="flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualPlayer(); } }}
            />
            <button
              type="button"
              onClick={addManualPlayer}
              disabled={!manualName.trim()}
              className="shrink-0 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--pine)] hover:bg-[var(--pine)]/5 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>

        {/* Guest Fee */}
        <div>
          <label className="text-sm font-medium">Guest Fee</label>
          <p className="text-xs text-[var(--muted)]">Cost per player to join (optional)</p>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">$</span>
            <input
              type="number"
              value={guestFee}
              onChange={(e) => setGuestFee(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full rounded-xl border border-[var(--border)] bg-white py-2.5 pl-7 pr-3 text-sm"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything players should know (pace of play, cart included, etc.)"
            rows={3}
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-sm resize-none"
          />
        </div>

        {/* Auto Accept */}
        <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white/70 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoAccept}
            onChange={(e) => setAutoAccept(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] text-[var(--pine)] accent-[var(--pine)]"
          />
          <div>
            <div className="text-sm font-medium">Auto-accept players</div>
            <div className="text-xs text-[var(--muted)]">Players join instantly without your approval</div>
          </div>
        </label>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-[var(--pine)] py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-60"
        >
          {saving ? "Creating…" : "Create Listing"}
        </button>
      </form>
    </div>
  );
}
