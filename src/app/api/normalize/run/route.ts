import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainPending } from "@/server/normalize/drain";

// On-demand normalization: the dump box POSTs here right after an upload so the graph updates within
// seconds instead of waiting for the daily backstop cron (Hobby plan caps crons at once/day).
// Self-auths as an active user (the proxy excludes /api) — clean 401, not a redirect — then uses the
// service-role client to claim + normalize pending uploads. Node.js runtime; needs AI Gateway.
export const maxDuration = 300;

export async function POST() {
  const profile = await getProfile();
  if (!profile || profile.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await drainPending(createAdminClient());
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "normalize failed" }, { status: 500 });
  }
}
