import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const admin = adminClient();

    // Fetch tournaments the user participates in
    const { data: participations, error: partErr } = await admin
      .from("tournament_participants")
      .select("tournament_id, status")
      .eq("user_id", user.id);

    if (partErr) {
      return NextResponse.json({ error: partErr.message }, { status: 500 });
    }

    const tournamentIds = (participations ?? []).map((p: any) => p.tournament_id);
    if (tournamentIds.length === 0) {
      return NextResponse.json({ tournaments: [], participantCounts: {} });
    }

    const { data: tournaments, error: tErr } = await admin
      .from("tournaments")
      .select("*")
      .in("id", tournamentIds)
      .order("created_at", { ascending: false });

    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }

    // Build status map (user's participation status per tournament)
    const statusMap: Record<string, string> = {};
    for (const p of participations as any[]) {
      statusMap[p.tournament_id] = p.status;
    }

    // Get participant counts
    const { data: allParts } = await admin
      .from("tournament_participants")
      .select("tournament_id")
      .in("tournament_id", tournamentIds)
      .eq("status", "accepted");

    const countMap: Record<string, number> = {};
    for (const p of (allParts ?? []) as any[]) {
      countMap[p.tournament_id] = (countMap[p.tournament_id] ?? 0) + 1;
    }

    return NextResponse.json({
      tournaments: (tournaments ?? []).map((t: any) => ({
        ...t,
        my_status: statusMap[t.id] ?? "invited",
      })),
      participantCounts: countMap,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as any;
    const action = String(body.action ?? "").trim();
    const admin = adminClient();

    // ---- CREATE ----
    if (action === "create") {
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim() || null;
      const periodType = String(body.period_type ?? "").trim();
      const periodCount = Number(body.period_count ?? 0);
      const startDate = String(body.start_date ?? "").trim();

      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      if (!["weekly", "monthly"].includes(periodType)) {
        return NextResponse.json({ error: "Invalid period type" }, { status: 400 });
      }
      if (periodCount < 1 || periodCount > 52) {
        return NextResponse.json({ error: "Period count must be 1-52" }, { status: 400 });
      }
      if (!startDate) return NextResponse.json({ error: "Start date is required" }, { status: 400 });

      // Compute end date
      const start = new Date(startDate + "T00:00:00");
      let end: Date;
      if (periodType === "weekly") {
        end = new Date(start);
        end.setDate(end.getDate() + periodCount * 7);
      } else {
        end = new Date(start);
        end.setMonth(end.getMonth() + periodCount);
      }
      const endDate = end.toISOString().split("T")[0];

      const { data: tournament, error: insErr } = await admin
        .from("tournaments")
        .insert({
          name,
          description,
          creator_id: user.id,
          period_type: periodType,
          period_count: periodCount,
          start_date: startDate,
          end_date: endDate,
          status: "active",
        })
        .select("*")
        .single();

      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

      // Add creator as accepted participant
      await admin.from("tournament_participants").insert({
        tournament_id: tournament.id,
        user_id: user.id,
        status: "accepted",
        joined_at: new Date().toISOString(),
      });

      return NextResponse.json({ tournament });
    }

    // ---- RESPOND (accept/decline invitation) ----
    if (action === "respond") {
      const tournamentId = String(body.tournament_id ?? "").trim();
      const response = String(body.response ?? "").trim();

      if (!tournamentId) return NextResponse.json({ error: "Missing tournament_id" }, { status: 400 });
      if (!["accepted", "declined"].includes(response)) {
        return NextResponse.json({ error: "Response must be accepted or declined" }, { status: 400 });
      }

      const updateData: any = { status: response };
      if (response === "accepted") updateData.joined_at = new Date().toISOString();

      const { error: upErr } = await admin
        .from("tournament_participants")
        .update(updateData)
        .eq("tournament_id", tournamentId)
        .eq("user_id", user.id);

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

      return NextResponse.json({ ok: true });
    }

    // ---- INVITE (add users by ID) ----
    if (action === "invite") {
      const tournamentId = String(body.tournament_id ?? "").trim();
      const userIds: string[] = body.user_ids ?? [];

      if (!tournamentId || userIds.length === 0) {
        return NextResponse.json({ error: "Missing tournament_id or user_ids" }, { status: 400 });
      }

      // Verify caller is a participant
      const { data: myPart } = await admin
        .from("tournament_participants")
        .select("id")
        .eq("tournament_id", tournamentId)
        .eq("user_id", user.id)
        .eq("status", "accepted")
        .maybeSingle();

      if (!myPart) {
        return NextResponse.json({ error: "You are not in this tournament" }, { status: 403 });
      }

      const rows = userIds.map((uid) => ({
        tournament_id: tournamentId,
        user_id: uid,
        status: "invited",
      }));

      const { error: invErr } = await admin
        .from("tournament_participants")
        .upsert(rows, { onConflict: "tournament_id,user_id", ignoreDuplicates: true });

      if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, invited: userIds.length });
    }

    // ---- COMPLETE ----
    if (action === "complete") {
      const tournamentId = String(body.tournament_id ?? "").trim();
      if (!tournamentId) return NextResponse.json({ error: "Missing tournament_id" }, { status: 400 });

      // Only creator can complete
      const { data: t } = await admin
        .from("tournaments")
        .select("creator_id")
        .eq("id", tournamentId)
        .single();

      if (!t || t.creator_id !== user.id) {
        return NextResponse.json({ error: "Only the creator can complete the tournament" }, { status: 403 });
      }

      await admin
        .from("tournaments")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", tournamentId);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("tournaments error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
