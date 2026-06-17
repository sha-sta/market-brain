import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { composeBrief, type BriefData } from "./compose";
import { gatherBrief } from "./gather";
import type { SendResult } from "./resend";

// Orchestrate one graph's morning brief: ET-date idempotency (one send per graph per ET day), gather
// -> compose -> send -> archive in digest_log (the archived html powers the in-app /brief view). It
// ALWAYS composes + logs (a one-liner on quiet days) so the gift feels alive daily; sending is
// best-effort (degrades). sendBrief + summarize are injected so the integration test uses a fake
// Resend + no live LLM.

type Client = SupabaseClient<Database>;

export interface SendDigestDeps {
  sendBrief: (o: { to: string; subject: string; html: string }) => Promise<SendResult>;
  summarize?: (d: BriefData) => Promise<string>;
  to?: string; // recipient; when absent the brief is composed + archived but not emailed
  nowMs: number;
  tz?: string;
}

export interface SendDigestResult {
  graphId: string;
  date: string;
  status: "sent" | "archived" | "skipped" | "failed";
  resendId?: string;
  reason?: string;
}

/** YYYY-MM-DD in the given IANA timezone. */
function etDate(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
}

export async function sendDigestForGraph(supabase: Client, graphId: string, deps: SendDigestDeps): Promise<SendDigestResult> {
  const tz = deps.tz ?? "America/New_York";
  const date = etDate(deps.nowMs, tz);

  // Idempotency: a successful send today is never repeated.
  const { data: existing } = await supabase
    .from("digest_log")
    .select("status")
    .eq("graph_id", graphId)
    .eq("digest_date", date)
    .maybeSingle();
  if (existing?.status === "sent") return { graphId, date, status: "skipped", reason: "already sent today" };

  // Window since the previous brief — EXCLUDING today's row, so a same-day retry (after a failed or
  // archived send) doesn't shrink the window to minutes and produce a truncated brief. Else last 24h.
  const { data: prev } = await supabase
    .from("digest_log")
    .select("created_at")
    .eq("graph_id", graphId)
    .neq("digest_date", date)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sinceIso = prev?.created_at ?? new Date(deps.nowMs - 86_400_000).toISOString();

  const data = await gatherBrief(supabase, graphId, { date, sinceIso, nowMs: deps.nowMs });
  const { subject, html } = await composeBrief(data, { summarize: deps.summarize });

  let status: SendDigestResult["status"] = "archived";
  let resendId: string | undefined;
  let reason: string | undefined;
  if (deps.to) {
    const res = await deps.sendBrief({ to: deps.to, subject, html });
    if (res.ok) {
      status = "sent";
      resendId = res.id;
    } else {
      status = "failed";
      reason = res.error;
    }
  } else {
    reason = "no recipient configured (DIGEST_TO) — composed + archived only";
  }

  // Archive (upsert on the unique (graph_id, digest_date)). Logged regardless of send outcome so the
  // in-app /brief always has today's brief. Surface a write error rather than swallowing it.
  const { error: logErr } = await supabase
    .from("digest_log")
    .upsert(
      { graph_id: graphId, digest_date: date, html, resend_id: resendId ?? null, status },
      { onConflict: "graph_id,digest_date" },
    );
  if (logErr) {
    return { graphId, date, status: "failed", resendId, reason: `digest_log write failed: ${logErr.message}` };
  }

  return { graphId, date, status, resendId, reason };
}
