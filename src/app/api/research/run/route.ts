import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { exaClient } from "@/server/market/websearch";
import { liveDeps } from "@/server/normalize/drain";
import { synthesizeResearch } from "@/server/research/synth";
import { runResearchJob } from "@/server/research/run";
import { reportError } from "@/lib/observability";

// On-demand processor for a queued research job. The research box POSTs {jobId} fire-and-forget right
// after submitting; this claims the job (SKIP LOCKED, so a double-trigger can't double-process), runs
// the web-research loop with the service-role client, and writes the result the UI is polling for.
// Node runtime; needs AI Gateway. Self-auths as an active user (the proxy excludes /api).
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const profile = await getProfile();
  if (!profile || profile.status !== "active") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const supabase = createAdminClient();
  // Ownership check: only the job's requester can trigger its processing (don't let an active user run
  // another user's job / spend AI on another graph). Single shared graph today, but correct for growth.
  const { data: owner } = await supabase.from("research_jobs").select("requester").eq("id", body.jobId).maybeSingle();
  if (!owner) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (owner.requester !== profile.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: claimed, error: claimErr } = await supabase.rpc("claim_research_job", { p_job_id: body.jobId });
  if (claimErr) return NextResponse.json({ error: "claim failed" }, { status: 500 });
  const job = claimed?.[0];
  if (!job) return NextResponse.json({ ok: true, skipped: "already claimed or not pending" });

  try {
    const result = await runResearchJob(
      supabase,
      { id: job.id, graph_id: job.graph_id, requester: job.requester, prompt: job.prompt },
      { web: exaClient(), worker: liveDeps(supabase), synthesize: synthesizeResearch, nowMs: Date.now() },
    );
    await supabase
      .from("research_jobs")
      .update({ status: "done", result_summary: result.summary })
      .eq("id", job.id);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    reportError(e, { scope: "research.run", job: job.id });
    await supabase
      .from("research_jobs")
      .update({ status: "failed", error: e instanceof Error ? e.message : "research failed" })
      .eq("id", job.id);
    return NextResponse.json({ error: "research failed" }, { status: 500 });
  }
}
