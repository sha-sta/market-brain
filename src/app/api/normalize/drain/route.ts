import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainPending } from "@/server/normalize/drain";

// Manual ops/backfill sweep: claim a batch of pending raw_uploads and normalize each. Normalization
// is on-demand only (the dump box hits `/api/normalize/run` after each upload) — this route is NOT
// scheduled; curl it with the CRON_SECRET to reprocess anything left pending (e.g. an on-demand
// trigger that never fired). Protected by CRON_SECRET. Node.js runtime — needs service-role + AI.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Fail closed: if CRON_SECRET is unset the endpoint is unreachable (never open to the internet).
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await drainPending(createAdminClient());
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "drain failed" }, { status: 500 });
  }
}
