import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { EntityEnricher } from "@/server/normalize/worker";
import { pastDeadline } from "@/server/lib/deadline";
import { reportError } from "@/lib/observability";
import { gapFillDue } from "./gap-fill-rules";

// The "add what's MISSING, not more news" pass: ground essential identity facts (cik/exchange/website)
// on tracked companies that carry a ticker but were never market-grounded — via the existing finance
// enricher (NO LLM). Bounded (cap per run) + throttled (weekly) + deadline-guarded so it never grows the
// graph with noise or threatens the 300s budget. Research-discovered relation gaps (competitors/products)
// remain a deliberate future extension; this delivers the cheap, high-signal identity win first.

type Client = SupabaseClient<Database>;

/** Active tracked PUBLIC companies that have a ticker but no market grounding yet — the cheap gap the
 *  finance enricher can fill. Excludes private cos (no quote API), already-grounded cos, and untracked. */
export async function detectStructuralGaps(supabase: Client, graphId: string): Promise<string[]> {
  const { data: tracked } = await supabase
    .from("tracked_entities")
    .select("node_id")
    .eq("graph_id", graphId)
    .eq("candidate_status", "active");
  const ids = (tracked ?? []).map((t) => t.node_id);
  if (ids.length === 0) return [];

  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("graph_id", graphId)
    .eq("type", "company")
    .in("id", ids);

  const gaps: string[] = [];
  for (const n of nodes ?? []) {
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (d.is_public === false) continue; // private: no quote/profile API
    if (!d.ticker) continue; // the enricher can't ground without a ticker (never guesses one)
    if (d.market_provenance) continue; // already grounded
    gaps.push(n.id);
  }
  return gaps;
}

export interface GapFillResult {
  due: boolean;
  attempted: number;
  filled: number;
}

/** Once per interval, ground up to `maxPerRun` ungrounded tracked companies. Records the run up front so
 *  an empty/partial pass still resets the weekly clock (never hammers daily). No enricher => no-op (but
 *  the clock still advances). Deadline-guarded so it yields budget to the digest. */
export async function gapFillStructure(
  supabase: Client,
  graphId: string,
  opts: { nowMs: number; enrich?: EntityEnricher; deadlineMs?: number; maxPerRun?: number; intervalDays?: number },
): Promise<GapFillResult> {
  const { data: graph } = await supabase.from("graphs").select("last_gap_fill_at").eq("id", graphId).maybeSingle();
  if (!gapFillDue(graph?.last_gap_fill_at ?? null, opts.nowMs, opts.intervalDays ?? 7)) {
    return { due: false, attempted: 0, filled: 0 };
  }
  // Reset the clock first: a due pass counts even if it grounds nothing, so we don't retry every day.
  await supabase.from("graphs").update({ last_gap_fill_at: new Date(opts.nowMs).toISOString() }).eq("id", graphId);
  if (!opts.enrich) return { due: true, attempted: 0, filled: 0 };

  const gaps = await detectStructuralGaps(supabase, graphId);
  const cap = opts.maxPerRun ?? 3;
  let attempted = 0;
  let filled = 0;
  for (const nodeId of gaps.slice(0, cap)) {
    if (pastDeadline(opts.deadlineMs)) break;
    attempted += 1;
    try {
      const r = await opts.enrich(nodeId, graphId);
      if (r.enriched) filled += 1;
    } catch (e) {
      reportError(e, { scope: "gapFillStructure", nodeId });
    }
  }
  return { due: true, attempted, filled };
}
