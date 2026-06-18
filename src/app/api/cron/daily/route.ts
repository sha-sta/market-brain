import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { liveMarketDeps } from "@/server/market";
import { runDailyForGraph } from "@/server/market/daily";
import { makeFinanceEnricher } from "@/server/market/enrich";
import { extractEntities } from "@/server/normalize/extract";
import { embedTexts } from "@/server/normalize/embed";
import { makeNeighborLookup } from "@/server/normalize/neighbors";
import type { WorkerDeps } from "@/server/normalize/worker";
import { sendDigestForGraph } from "@/server/digest/send-digest";
import { sendBrief as sendViaResend } from "@/server/digest/resend";
import { sendViaGmail } from "@/server/digest/gmail";
import { summarizeBrief } from "@/server/digest/summarize";
import { digestTo, digestTz, gmailUser } from "@/lib/env";
import { reportError } from "@/lib/observability";

// The single daily cron (Vercel Hobby allows 1/day): for EVERY graph, fetch prices + news into the
// graph, then compose + send the morning brief — fetch and brief together, never split. CRON_SECRET
// fail-closed. Node runtime (AI Gateway + service-role). maxDuration is the platform's 300s ceiling.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Fail closed: if CRON_SECRET is unset the endpoint is unreachable (never open to the internet).
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowMs = Date.now();
  const market = liveMarketDeps();

  // Manufactured news raw_uploads need a contributor (a real profile). Attribute to an active admin
  // (the graph owner). If none exists yet, the fetch step is skipped; the brief still runs over
  // whatever is already in the graph.
  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("status", "active")
    .order("is_admin", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contributorId = admin?.id;

  const worker: WorkerDeps = {
    extract: extractEntities,
    embed: embedTexts,
    neighbors: makeNeighborLookup(supabase),
    enrichEntities: makeFinanceEnricher(supabase, market, (t) => embedTexts([t]).then((r) => r[0] ?? [])),
  };
  // The brief's LLM intro only runs when the AI Gateway is configured; otherwise it's template-only.
  const summarize = process.env.AI_GATEWAY_API_KEY ? summarizeBrief : undefined;
  // Email sender: prefer Gmail SMTP (no domain needed, reaches any inbox), else Resend. Recipient
  // defaults to the Gmail account when DIGEST_TO isn't set, so a brief always has somewhere to go.
  const sendBrief = process.env.GMAIL_APP_PASSWORD ? sendViaGmail : sendViaResend;
  const to = digestTo() ?? gmailUser();

  const { data: graphs } = await supabase.from("graphs").select("id");
  const results: Array<{ graph: string; daily: unknown; digest: unknown }> = [];
  // Per-graph isolation: one graph's failure (or one of its two phases) must never abort the rest or
  // skip the brief. The daily fetch and the brief are wrapped independently so a fetch failure still
  // lets the brief run over whatever is already in the graph.
  for (const g of graphs ?? []) {
    let daily: unknown = { skipped: "no active profile to attribute news to" };
    if (contributorId) {
      try {
        daily = await runDailyForGraph(supabase, g.id, { market, worker, contributorId, nowMs });
      } catch (e) {
        reportError(e, { scope: "cron.daily", graph: g.id });
        daily = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    let digest: unknown;
    try {
      digest = await sendDigestForGraph(supabase, g.id, { sendBrief, summarize, to, nowMs, tz: digestTz() });
    } catch (e) {
      reportError(e, { scope: "cron.digest", graph: g.id });
      digest = { error: e instanceof Error ? e.message : String(e) };
    }
    results.push({ graph: g.id, daily, digest });
  }

  return NextResponse.json({ ok: true, results });
}
