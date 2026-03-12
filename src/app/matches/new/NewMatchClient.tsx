"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/supabase";
import { ClubPicker, type ApiTeeInfo } from "@/app/components/ClubPicker";
import { OpponentPicker } from "@/app/components/OpponentPicker";
import { cx } from "@/lib/utils";

type SelectedOpponent = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  handicap_index: number | null;
  clubs: string[];
};

export default function NewMatchPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  const [opponent, setOpponent] = useState<SelectedOpponent | null>(null);
  const [courseName, setCourseName] = useState("");
  const [roundDate, setRoundDate] = useState("");
  const [roundTime, setRoundTime] = useState("");

  const [courseApiId, setCourseApiId] = useState<string | null>(null);
  const [courseTees, setCourseTees] = useState<ApiTeeInfo[]>([]);
  const [selectedTee, setSelectedTee] = useState<string | null>(null);
  const [guestFee, setGuestFee] = useState<number | null>(null);
  const [courseAccessType, setCourseAccessType] = useState<string | null>(null);
  const [format, setFormat] = useState<"stroke_play" | "match_play">("stroke_play");
  const [useHandicap, setUseHandicap] = useState(false);
  const [isLadderMatch, setIsLadderMatch] = useState(false);
  const [holeCount, setHoleCount] = useState<9 | 18>(18);

  const [playMode, setPlayMode] = useState<"same_course" | "different_courses">("same_course");
  const [inviteMode, setInviteMode] = useState<"player" | "link">("player");
  const [inviteMatchId, setInviteMatchId] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const preset = sp.get("course");
    if (preset) setCourseName(preset);
    if (sp.get("mode") === "link") setInviteMode("link");
    if (sp.get("ladder") === "true") {
      setIsLadderMatch(true);
      setFormat("stroke_play");
      setUseHandicap(true);
    }

    let handled = false;

    function handleUser(user: { id: string; email?: string } | null | undefined) {
      if (!user) {
        setStatus("You're not signed in.");
        return;
      }
      setMeId(user.id);
      setMeEmail(user.email ?? null);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handled = true;
      handleUser(session?.user ?? null);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!handled) handleUser(session?.user ?? null);
    });

    // Pre-select opponent from query param (e.g. from ladder challenge)
    const oppParam = sp.get("opponent");
    if (oppParam) {
      supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url, handicap_index")
        .eq("id", oppParam)
        .single()
        .then(({ data }) => {
          if (data) {
            setOpponent({
              id: data.id,
              display_name: data.display_name,
              email: data.email,
              avatar_url: data.avatar_url,
              handicap_index: data.handicap_index,
              clubs: [],
            });
          }
        });
    }

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createMatch(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    setLoading(true);

    if (!meId || !meEmail) {
      setStatus("You're not signed in.");
      setLoading(false);
      return;
    }

    if (inviteMode === "player" && !opponent) {
      setStatus("Select an opponent.");
      setLoading(false);
      return;
    }

    if (opponent && opponent.id === meId) {
      setStatus("You can't challenge yourself.");
      setLoading(false);
      return;
    }

    const isDifferentCourses = playMode === "different_courses" && !isLadderMatch;
    const course = isDifferentCourses ? "Different Courses" : courseName.trim();
    if (!course) {
      setStatus("Pick a club/course.");
      setLoading(false);
      return;
    }

    // Build round_time ISO string from date + time inputs
    let roundTimeISO: string | null = null;
    if (roundDate) {
      const timePart = roundTime || "00:00";
      roundTimeISO = new Date(`${roundDate}T${timePart}`).toISOString();
    }

    const isLinkInvite = inviteMode === "link";
    const oppEmail = isLinkInvite ? "" : (opponent?.email ?? "");

    const { data, error } = await supabase
      .from("matches")
      .insert({
        creator_id: meId,
        opponent_id: isLinkInvite ? null : (opponent?.id ?? null),
        opponent_email: oppEmail,
        course_name: course,
        golf_course_api_id: isDifferentCourses ? null : courseApiId,
        selected_tee: isDifferentCourses ? null : selectedTee,
        status: "proposed",
        round_time: roundTimeISO,
        format,
        use_handicap: useHandicap,
        guest_fee: guestFee,
        is_ladder_match: isLadderMatch,
        hole_count: holeCount,
        play_mode: playMode,
        terms_status: "pending",
        terms_last_proposed_by: meId,
        terms_last_proposed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      setStatus(error.message);
      setLoading(false);
      return;
    }

    // For link invites, show the share UI instead of navigating away
    if (isLinkInvite) {
      setLoading(false);
      setInviteMatchId(data.id);
      return;
    }

    setLoading(false);
    router.push(`/matches/${data.id}`);
  }

  // Share screen after link invite creation
  if (inviteMatchId) {
    const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${inviteMatchId}`;
    const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Match created!</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Share the link below with your opponent. They'll sign up and the match will be waiting.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-6 shadow-sm space-y-5">
          {/* Match summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">Course</span>
              <span className="font-semibold">{courseName}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--muted)]">Format</span>
              <span className="font-semibold">{format === "match_play" ? "Match Play" : "Stroke Play"}{useHandicap ? " (Net)" : ""} · {holeCount} holes</span>
            </div>
            {roundDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted)]">Date</span>
                <span className="font-semibold">{new Date(`${roundDate}T${roundTime || "00:00"}`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border)] pt-5">
            <div className="text-xs font-medium uppercase tracking-[0.15em] text-[var(--muted)] mb-3">
              Invite link
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--paper-2)] px-3 py-2.5">
              <code className="flex-1 truncate text-xs text-[var(--ink)]">{inviteUrl}</code>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteUrl);
                  setStatus("Copied!");
                  setTimeout(() => setStatus(null), 2000);
                } catch {}
              }}
              className="flex-1 rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-semibold transition hover:shadow-sm"
            >
              {status === "Copied!" ? "Copied!" : "Copy link"}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: "Golf match challenge",
                      text: "You've been challenged to a round on Reciprocity!",
                      url: inviteUrl,
                    });
                  } catch {}
                }}
                className="flex-1 rounded-xl bg-[var(--pine)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:shadow-md"
              >
                Share
              </button>
            )}
          </div>

          <p className="text-xs text-[var(--muted)]">
            Send via text, WhatsApp, iMessage, or any messaging app.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/matches/${inviteMatchId}`}
            className="rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-px hover:shadow-md"
          >
            View match
          </Link>
          <Link
            href="/matches"
            className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Back to matches
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Match</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick a club, propose terms, and challenge your opponent.
        </p>
      </div>

      <form onSubmit={createMatch} className="space-y-5">
        {/* Invite mode toggle */}
        <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-white/60 p-1">
          <button
            type="button"
            onClick={() => { setInviteMode("player"); setOpponent(null); }}
            className={cx(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
              inviteMode === "player"
                ? "bg-[var(--pine)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            )}
          >
            Existing player
          </button>
          <button
            type="button"
            onClick={() => { setInviteMode("link"); setOpponent(null); }}
            className={cx(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
              inviteMode === "link"
                ? "bg-[var(--pine)] text-white shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            )}
          >
            Invite via link
          </button>
        </div>

        {inviteMode === "player" ? (
          meId ? (
            <OpponentPicker meId={meId} value={opponent} onChange={setOpponent} />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
              Loading...
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--pine)]/30 bg-[var(--pine)]/5 p-5 text-center">
            <div className="text-sm font-medium text-[var(--ink)]">
              Invite via link
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              A shareable link will be generated after you create the match. Send it to your opponent via text, WhatsApp, or any messaging app.
            </p>
          </div>
        )}

        {/* Play mode toggle (hidden for ladder matches) */}
        {!isLadderMatch && (
          <div>
            <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-white/60 p-1">
              <button
                type="button"
                onClick={() => setPlayMode("same_course")}
                className={cx(
                  "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
                  playMode === "same_course"
                    ? "bg-[var(--pine)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                )}
              >
                Same Course
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlayMode("different_courses");
                  setUseHandicap(true);
                }}
                className={cx(
                  "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
                  playMode === "different_courses"
                    ? "bg-[var(--pine)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                )}
              >
                Different Courses
              </button>
            </div>
            {playMode === "different_courses" && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Each player plays at their own course. Winner determined by handicap differential.
              </p>
            )}
          </div>
        )}

        {playMode === "different_courses" && !isLadderMatch ? (
          <div className="rounded-2xl border border-dashed border-[var(--pine)]/30 bg-[var(--pine)]/5 p-5 text-center">
            <div className="text-sm font-medium text-[var(--ink)]">
              Different courses
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Each player will choose their own course and tee when submitting their round.
            </p>
          </div>
        ) : meId ? (
          <div>
            <ClubPicker
              value={courseName}
              onChange={(name) => { setCourseName(name); }}
              onGuestFeeChange={setGuestFee}
              onCourseApiIdChange={(id) => { setCourseApiId(id); if (!id) { setCourseTees([]); setSelectedTee(null); } }}
              onTeesChange={(tees) => { setCourseTees(tees); setSelectedTee(tees.length > 0 ? tees[0].name : null); }}
              onAccessTypeChange={setCourseAccessType}
              userId={meId}
            />
            {courseTees.length > 0 && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Select tees</div>
                <div className="flex flex-wrap gap-2">
                  {courseTees.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => setSelectedTee(t.name)}
                      className={cx(
                        "rounded-lg px-3 py-1.5 text-sm font-semibold transition",
                        selectedTee === t.name
                          ? "bg-[var(--pine)] text-white shadow-sm"
                          : "border border-[var(--border)] bg-white text-[var(--ink)] hover:bg-[var(--paper)]"
                      )}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {selectedTee && (() => {
                  const t = courseTees.find((t) => t.name === selectedTee);
                  if (!t) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                      {t.slope != null && <span>Slope: <span className="font-semibold text-[var(--ink)]">{t.slope}</span></span>}
                      {t.rating != null && <span>Rating: <span className="font-semibold text-[var(--ink)]">{t.rating}</span></span>}
                      {t.par != null && <span>Par: <span className="font-semibold text-[var(--ink)]">{t.par}</span></span>}
                      {t.yards != null && <span>Yards: <span className="font-semibold text-[var(--ink)]">{t.yards}</span></span>}
                    </div>
                  );
                })()}
              </div>
            )}
            {guestFee != null && courseTees.length === 0 && (
              <div className="mt-2 text-xs text-[var(--muted)]">
                Guest fee of <span className="font-semibold">${guestFee}</span> will be shown to your opponent.
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4 text-sm text-[var(--muted)]">
            Loading clubs...
          </div>
        )}

        {playMode !== "different_courses" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
              DATE
            </label>
            <input
              type="date"
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={roundDate}
              onChange={(e) => setRoundDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
              TEE TIME
            </label>
            <input
              type="time"
              className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none transition focus:border-[var(--pine)] focus:ring-1 focus:ring-[var(--pine)]"
              value={roundTime}
              onChange={(e) => setRoundTime(e.target.value)}
            />
          </div>
        </div>
        )}

        <div className="rounded-2xl border border-[var(--border)] bg-white/60 p-5">
          <div className="text-xs font-medium tracking-[0.18em] text-[var(--muted)]">
            MATCH TERMS
          </div>

          {/* Holes */}
          <div className="mt-4">
            <label className="text-sm font-medium">Holes</label>
            <div className="mt-2 flex gap-2">
              {([18, 9] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { if (!isLadderMatch) setHoleCount(n); }}
                  disabled={isLadderMatch}
                  className={cx(
                    "flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition",
                    holeCount === n
                      ? "border-[var(--pine)] bg-[var(--pine)] text-white"
                      : "border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--pine)]/40",
                    isLadderMatch && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {n} holes
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Format</label>
              <select
                className="w-full rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-sm outline-none disabled:opacity-50"
                value={format}
                onChange={(e) => setFormat(e.target.value as any)}
                disabled={isLadderMatch}
              >
                <option value="stroke_play">Stroke Play</option>
                <option value="match_play">Match Play</option>
              </select>
            </div>

            <div className="space-y-3 pt-6">
              <div className="flex items-center gap-2">
                <input
                  id="useHandicap"
                  type="checkbox"
                  checked={useHandicap}
                  onChange={(e) => setUseHandicap(e.target.checked)}
                  disabled={isLadderMatch || (playMode === "different_courses" && !isLadderMatch)}
                  className="h-4 w-4 rounded border-[var(--border)] disabled:opacity-50"
                />
                <label htmlFor="useHandicap" className="text-sm font-medium">
                  Use handicap (net scoring)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="isLadderMatch"
                  type="checkbox"
                  checked={isLadderMatch}
                  onChange={(e) => {
                    setIsLadderMatch(e.target.checked);
                    if (e.target.checked) {
                      setFormat("stroke_play");
                      setUseHandicap(true);
                      setHoleCount(18);
                    }
                  }}
                  className="h-4 w-4 rounded border-[var(--border)]"
                />
                <label htmlFor="isLadderMatch" className="text-sm font-medium">
                  Ladder match (affects rankings)
                </label>
              </div>
              {isLadderMatch && (
                <div className="text-xs text-[var(--muted)]">
                  Ladder matches are always stroke play with handicap.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-xl bg-[var(--pine)] px-5 py-3 text-sm font-semibold text-[var(--paper)] transition hover:-translate-y-[1px] hover:shadow-[0_10px_26px_rgba(0,0,0,.18)] disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Creating..." : "Create match"}
          </button>

          <Link
            href="/matches"
            className="text-sm text-[var(--muted)] transition hover:text-[var(--ink)]"
          >
            Cancel
          </Link>
        </div>

        {status && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {status}
          </div>
        )}
      </form>
    </div>
  );
}
