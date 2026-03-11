import { NextResponse } from "next/server";
import { getAuthedUser, adminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/pushSend";

export const runtime = "nodejs";

/**
 * GET /api/pool/[id] — get a single pool listing with full details
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id } = await params;
    const admin = adminClient();

    const { data: listing, error: listErr } = await admin
      .from("pool_listings")
      .select("*")
      .eq("id", id)
      .single();

    if (listErr || !listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Fetch creator profile
    const { data: creator } = await admin
      .from("profiles")
      .select("id, display_name, handicap_index, avatar_url")
      .eq("id", listing.creator_id)
      .single();

    // Fetch committed players
    const { data: committed } = await admin
      .from("pool_committed")
      .select("id, player_id, player_name")
      .eq("listing_id", id);

    // Fetch committed player profiles
    const committedPlayerIds = (committed ?? [])
      .map((c: any) => c.player_id)
      .filter(Boolean);
    let committedProfiles: Record<string, any> = {};
    if (committedPlayerIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, display_name, handicap_index, avatar_url")
        .in("id", committedPlayerIds);
      if (profs) {
        for (const p of profs) committedProfiles[p.id] = p;
      }
    }

    // Fetch applications
    const { data: applications } = await admin
      .from("pool_applications")
      .select("id, applicant_id, message, status, created_at")
      .eq("listing_id", id)
      .order("created_at", { ascending: true });

    // Fetch applicant profiles
    const applicantIds = (applications ?? []).map((a: any) => a.applicant_id);
    let applicantProfiles: Record<string, any> = {};
    if (applicantIds.length > 0) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, display_name, handicap_index, avatar_url")
        .in("id", applicantIds);
      if (profs) {
        for (const p of profs) applicantProfiles[p.id] = p;
      }
    }

    const enrichedCommitted = (committed ?? []).map((c: any) => ({
      ...c,
      profile: c.player_id ? committedProfiles[c.player_id] ?? null : null,
    }));

    // Fetch pool ratings for all applicants (average + count)
    const allPlayerIds = [
      ...applicantIds,
      ...(committed ?? []).map((c: any) => c.player_id).filter(Boolean),
    ];
    let playerRatings: Record<string, { avg: number; count: number }> = {};
    if (allPlayerIds.length > 0) {
      const { data: ratings } = await admin
        .from("pool_ratings")
        .select("rated_id, rating")
        .in("rated_id", allPlayerIds);
      if (ratings) {
        const byPlayer: Record<string, number[]> = {};
        for (const r of ratings as any[]) {
          if (!byPlayer[r.rated_id]) byPlayer[r.rated_id] = [];
          byPlayer[r.rated_id].push(r.rating);
        }
        for (const [pid, vals] of Object.entries(byPlayer)) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          playerRatings[pid] = { avg: Math.round(avg * 10) / 10, count: vals.length };
        }
      }
    }

    // Fetch ratings the creator already submitted for this listing
    const { data: myRatings } = await admin
      .from("pool_ratings")
      .select("rated_id, rating, comment")
      .eq("listing_id", id)
      .eq("rater_id", user.id);
    const myRatingsMap: Record<string, { rating: number; comment: string | null }> = {};
    if (myRatings) {
      for (const r of myRatings as any[]) {
        myRatingsMap[r.rated_id] = { rating: r.rating, comment: r.comment };
      }
    }

    const enrichedApps = (applications ?? []).map((a: any) => ({
      ...a,
      profile: applicantProfiles[a.applicant_id] ?? null,
      pool_rating: playerRatings[a.applicant_id] ?? null,
    }));

    const acceptedCount = enrichedApps.filter((a: any) => a.status === "accepted").length;

    return NextResponse.json({
      listing: {
        ...listing,
        creator,
        committed: enrichedCommitted,
        applications: enrichedApps,
        slots_filled: enrichedCommitted.length + acceptedCount,
      },
      isCreator: user.id === listing.creator_id,
      myApplication: enrichedApps.find((a: any) => a.applicant_id === user.id) ?? null,
      myRatings: myRatingsMap,
    });
  } catch (e: any) {
    console.error("pool detail error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/pool/[id] — actions: apply, accept, deny, cancel
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error: userErr } = await getAuthedUser(request);
    if (userErr || !user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const { id: listingId } = await params;
    const body = (await request.json().catch(() => ({}))) as any;
    const action = String(body.action ?? "").trim();

    const admin = adminClient();

    const { data: listing } = await admin
      .from("pool_listings")
      .select("*")
      .eq("id", listingId)
      .single();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // --- Apply ---
    if (action === "apply") {
      if (user.id === listing.creator_id) {
        return NextResponse.json({ error: "Can't apply to your own listing" }, { status: 400 });
      }

      if (listing.status !== "open") {
        return NextResponse.json({ error: "This listing is no longer open" }, { status: 400 });
      }

      // Check slots
      const { count: acceptedCount } = await admin
        .from("pool_applications")
        .select("id", { count: "exact", head: true })
        .eq("listing_id", listingId)
        .eq("status", "accepted");

      const { count: committedCount } = await admin
        .from("pool_committed")
        .select("id", { count: "exact", head: true })
        .eq("listing_id", listingId);

      const filled = (acceptedCount ?? 0) + (committedCount ?? 0);
      if (filled >= listing.total_slots) {
        return NextResponse.json({ error: "All slots are filled" }, { status: 400 });
      }

      const status = listing.auto_accept ? "accepted" : "pending";

      const { error: appErr } = await admin
        .from("pool_applications")
        .upsert(
          {
            listing_id: listingId,
            applicant_id: user.id,
            message: body.message || null,
            status,
          },
          { onConflict: "listing_id,applicant_id" }
        );

      if (appErr) {
        return NextResponse.json({ error: appErr.message }, { status: 500 });
      }

      // Auto-fill check
      if (status === "accepted") {
        const newFilled = filled + 1;
        if (newFilled >= listing.total_slots) {
          await admin.from("pool_listings").update({ status: "full" }).eq("id", listingId);
        }
      }

      // Notify creator
      const { data: applicantProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const applicantName = applicantProfile?.display_name || "A player";
      const msg = listing.auto_accept
        ? `${applicantName} joined your group at ${listing.course_name}`
        : `${applicantName} wants to join your group at ${listing.course_name}`;

      await admin.from("notifications").insert({
        user_id: listing.creator_id,
        message: msg,
        read: false,
      });

      sendPushToUser(listing.creator_id, {
        title: listing.auto_accept ? "Player joined" : "New pool request",
        body: msg,
        url: `/pool/${listingId}`,
      }).catch(() => {});

      return NextResponse.json({ ok: true, status });
    }

    // --- Accept / Deny (creator only) ---
    if (action === "accept" || action === "deny") {
      if (user.id !== listing.creator_id) {
        return NextResponse.json({ error: "Only the organizer can do this" }, { status: 403 });
      }

      const applicationId = String(body.application_id ?? "").trim();
      if (!applicationId) {
        return NextResponse.json({ error: "Missing application_id" }, { status: 400 });
      }

      const { data: app } = await admin
        .from("pool_applications")
        .select("*")
        .eq("id", applicationId)
        .eq("listing_id", listingId)
        .single();

      if (!app) {
        return NextResponse.json({ error: "Application not found" }, { status: 404 });
      }

      const newStatus = action === "accept" ? "accepted" : "denied";

      await admin
        .from("pool_applications")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", applicationId);

      // If accepted, check if listing is now full
      if (action === "accept") {
        const { count: acceptedCount } = await admin
          .from("pool_applications")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId)
          .eq("status", "accepted");

        const { count: committedCount } = await admin
          .from("pool_committed")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", listingId);

        if ((acceptedCount ?? 0) + (committedCount ?? 0) >= listing.total_slots) {
          await admin.from("pool_listings").update({ status: "full" }).eq("id", listingId);
        }
      }

      // Notify applicant
      const { data: creatorProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      const creatorName = creatorProfile?.display_name || "The organizer";
      const notifMsg = action === "accept"
        ? `${creatorName} accepted you into the group at ${listing.course_name}`
        : `${creatorName} declined your request to join at ${listing.course_name}`;

      await admin.from("notifications").insert({
        user_id: app.applicant_id,
        message: notifMsg,
        read: false,
      });

      sendPushToUser(app.applicant_id, {
        title: action === "accept" ? "You're in!" : "Request declined",
        body: notifMsg,
        url: `/pool/${listingId}`,
      }).catch(() => {});

      return NextResponse.json({ ok: true });
    }

    // --- Cancel (creator only) ---
    if (action === "cancel") {
      if (user.id !== listing.creator_id) {
        return NextResponse.json({ error: "Only the organizer can cancel" }, { status: 403 });
      }

      await admin
        .from("pool_listings")
        .update({ status: "cancelled" })
        .eq("id", listingId);

      // Notify all accepted applicants
      const { data: accepted } = await admin
        .from("pool_applications")
        .select("applicant_id")
        .eq("listing_id", listingId)
        .eq("status", "accepted");

      if (accepted) {
        for (const a of accepted as any[]) {
          await admin.from("notifications").insert({
            user_id: a.applicant_id,
            message: `The group at ${listing.course_name} has been cancelled by the organizer.`,
            read: false,
          });
        }
      }

      return NextResponse.json({ ok: true });
    }

    // --- Rate (creator only, after round time has passed) ---
    if (action === "rate") {
      if (user.id !== listing.creator_id) {
        return NextResponse.json({ error: "Only the organizer can rate players" }, { status: 403 });
      }

      const roundTime = new Date(listing.round_time).getTime();
      if (Date.now() < roundTime) {
        return NextResponse.json({ error: "You can rate players after the round" }, { status: 400 });
      }

      const ratedId = String(body.rated_id ?? "").trim();
      const rating = Number(body.rating);
      if (!ratedId) return NextResponse.json({ error: "Missing rated_id" }, { status: 400 });
      if (!rating || rating < 1 || rating > 5) return NextResponse.json({ error: "Rating must be 1-5" }, { status: 400 });

      const { error: rateErr } = await admin
        .from("pool_ratings")
        .upsert(
          {
            listing_id: listingId,
            rater_id: user.id,
            rated_id: ratedId,
            rating,
            comment: body.comment || null,
          },
          { onConflict: "listing_id,rater_id,rated_id" }
        );

      if (rateErr) {
        return NextResponse.json({ error: rateErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("pool action error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
