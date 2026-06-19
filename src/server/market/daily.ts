import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { drainPending } from "@/server/normalize/drain";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { NodeType } from "@/server/normalize/types";
import { upsertEdge, writeNodeData } from "@/server/normalize/upsert";
import { archiveCutoffMs, asOfFromData } from "@/server/normalize/lifecycle";
import { judgeTheses, type Judge } from "@/server/critic/thesis-judge";
import { reconcileThesisSupersede } from "@/server/critic/thesis-supersede";
import { CONFIDENCE_WEAK } from "@/server/normalize/relations";
import { canonicalizeUrl, normTicker } from "@/server/normalize/dedupe";
import { reportError } from "@/lib/observability";
import { pLimit } from "./p-limit";
import type { MarketDeps } from "./types";

// The daily flagship, per graph: load the tracked entities, snapshot public prices, fetch company
// news and MANUFACTURE raw_uploads rows from it (the key reuse insight — a news article is just a
// raw_uploads row), drain them through the UNCHANGED worker into `news` nodes, then deterministically
// link each news node to the holdings it names by ticker hard-key. Fully injected (MarketDeps +
// WorkerDeps) so the integration test runs it with stubs — no live API. The route calls this then
// sendDigest (1 Vercel-Hobby cron does fetch + brief together).

type Client = SupabaseClient<Database>;

export interface DailyDeps {
  market: MarketDeps;
  worker: WorkerDeps; // extract/embed/neighbors/enrichEntities — passed to drainPending
  contributorId: string; // profile id manufactured news raw_uploads are attributed to
  nowMs: number;
  judge?: Judge; // strict thesis-judge (Sonnet); omitted when AI Gateway is unconfigured
  /** Soft deadline (absolute epoch ms) the cron passes so the LLM-heavy steps (drain + thesis-judge)
   *  yield with budget left for the digest. Omitted => unbounded (the integration tests' fast path). */
  deadlineMs?: number;
}

/** Max news articles drained per company per run. Finnhub returns articles WITHOUT a materiality score
 *  (that's assigned later by the extractor), so the only signal available at ingest is recency — we keep
 *  the newest N and let the rest fall to the next run. Bounds the slowest step (drain) and the graph's growth. */
export const NEWS_PER_COMPANY_CAP = 8;

export interface DailySummary {
  graphId: string;
  trackedCompanies: number;
  snapshots: number;
  newsEnqueued: number;
  newsSkipped: number;
  drained: number;
  mentionsLinked: number;
  archived: number; // chronological nodes soft-hidden this run (tiered decay)
  deleted: number; // long-archived chronological nodes hard-deleted this run (reference-guarded)
  pruned: boolean;
  thesesJudged: number;
  thesesSuperseded: number; // freshly-added theses that auto-replaced a prior near-restatement
  discovered: number;
}

interface CompanyRow {
  id: string;
  ticker: string;
  isPublic: boolean;
}

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Load this graph's tracked company nodes (resolved to id + verbatim ticker + is_public). */
async function trackedCompanies(supabase: Client, graphId: string): Promise<CompanyRow[]> {
  // Only ACTIVE tracked entities incur API calls — candidates (engine-discovered, not yet promoted)
  // are the cost firewall and must never be fetched here.
  const { data: tracked } = await supabase
    .from("tracked_entities")
    .select("node_id")
    .eq("graph_id", graphId)
    .eq("candidate_status", "active");
  const ids = (tracked ?? []).map((t) => t.node_id);
  if (ids.length === 0) return [];
  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, type, data")
    .eq("graph_id", graphId)
    .eq("type", "company")
    .in("id", ids);
  const out: CompanyRow[] = [];
  for (const n of nodes ?? []) {
    const data = (n.data ?? {}) as Record<string, unknown>;
    out.push({ id: n.id, ticker: normTicker(data.ticker), isPublic: data.is_public !== false });
  }
  return out;
}

/** Step 2 — snapshot live prices for public companies that carry a ticker. Private cos are skipped
 *  (guarded on is_public) so they never get a fabricated price. */
async function snapshotPrices(supabase: Client, graphId: string, companies: CompanyRow[], deps: DailyDeps): Promise<number> {
  const limit = pLimit(3);
  let snapshots = 0;
  await Promise.all(
    companies
      .filter((c) => c.isPublic && c.ticker)
      .map((c) =>
        limit.run(async () => {
          try {
            const q = await deps.market.quote(c.ticker);
            if (!q || q.price === null) return;
            const { error } = await supabase.from("price_snapshots").insert({
              graph_id: graphId,
              node_id: c.id,
              ticker: c.ticker,
              price: q.price,
              change_pct: q.changePct,
              market_cap: q.marketCap,
              captured_at: new Date(deps.nowMs).toISOString(),
            });
            if (!error) snapshots += 1;
          } catch (e) {
            reportError(e, { scope: "daily.quote", ticker: c.ticker }); // one ticker can't fail the batch
          }
        }),
      ),
  );
  return snapshots;
}

/** Step 3 — fetch company news and enqueue an idempotent `news` raw_uploads row per fresh article. */
async function enqueueNews(
  supabase: Client,
  graphId: string,
  companies: CompanyRow[],
  deps: DailyDeps,
): Promise<{ enqueued: number; skipped: number }> {
  const from = ymd(deps.nowMs - 86_400_000); // yesterday
  const to = ymd(deps.nowMs);
  const limit = pLimit(2);
  const seenThisRun = new Set<string>();
  let enqueued = 0;
  let skipped = 0;

  await Promise.all(
    companies
      .filter((c) => c.isPublic && c.ticker)
      .map((c) =>
        limit.run(async () => {
          try {
            const fetched = await deps.market.news(c.ticker, from, to);
            // Cap at ingest: keep only the newest N by publishedAt (the lone pre-extract signal). The
            // overflow is counted as skipped and left for the next run, bounding drain cost + growth.
            const articles = [...fetched]
              .sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0))
              .slice(0, NEWS_PER_COMPANY_CAP);
            if (fetched.length > articles.length) skipped += fetched.length - articles.length;
            for (const a of articles) {
            const url = canonicalizeUrl(a.url);
            if (!url) continue;
            if (seenThisRun.has(url)) {
              skipped += 1;
              continue;
            }
            seenThisRun.add(url);
            // Idempotent across runs: skip a URL already enqueued in this graph.
            const { data: existing } = await supabase
              .from("raw_uploads")
              .select("id")
              .eq("graph_id", graphId)
              .eq("source_ref", url)
              .maybeSingle();
            if (existing) {
              skipped += 1;
              continue;
            }
            const body = [
              `HEADLINE: ${a.headline}`,
              a.source ? `SOURCE: ${a.source}` : "",
              `URL: ${url}`,
              a.publishedAt ? `PUBLISHED: ${a.publishedAt}` : "",
              a.tickers.length ? `TICKERS: ${a.tickers.join(", ")}` : `TICKERS: ${c.ticker}`,
              "",
              a.summary ?? "",
            ]
              .filter((l) => l !== "")
              .join("\n");
            const { error } = await supabase.from("raw_uploads").insert({
              graph_id: graphId,
              contributor: deps.contributorId,
              kind: "news",
              source_ref: url,
              raw_text: body,
              status: "pending",
            });
            if (!error) enqueued += 1;
            }
          } catch (e) {
            reportError(e, { scope: "daily.news", ticker: c.ticker }); // one ticker can't fail the batch
          }
        }),
      ),
  );
  return { enqueued, skipped };
}

/** Step 5 — after drain, link each news node created this run to the company nodes it names by ticker
 *  hard-key (a deterministic, grounded `mentions` edge — the holdings↔news linkage the brief needs). */
async function linkNewsMentions(supabase: Client, graphId: string, runStartIso: string): Promise<number> {
  // company ticker -> node id (only companies that carry a verbatim ticker)
  const { data: companyRows } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("graph_id", graphId)
    .eq("type", "company");
  const byTicker = new Map<string, string>();
  for (const c of companyRows ?? []) {
    const t = normTicker(((c.data ?? {}) as Record<string, unknown>).ticker);
    if (t) byTicker.set(t, c.id);
  }
  if (byTicker.size === 0) return 0;

  const { data: newsRows } = await supabase
    .from("nodes")
    .select("id, data, updated_at")
    .eq("graph_id", graphId)
    .eq("type", "news")
    .gte("updated_at", runStartIso)
    .limit(1000);

  let linked = 0;
  for (const n of newsRows ?? []) {
    const tickers = ((n.data ?? {}) as Record<string, unknown>).tickers;
    if (!Array.isArray(tickers)) continue;
    for (const raw of tickers) {
      const companyId = byTicker.get(normTicker(raw));
      if (!companyId || companyId === n.id) continue;
      await upsertEdge(supabase, n.id, companyId, "mentions", graphId, {
        relation_type: "mentions",
        method: "ticker_match",
        confidence: CONFIDENCE_WEAK,
      });
      linked += 1;
    }
  }
  return linked;
}

// Chronological types eligible for tiered decay (structural types + note + thesis never decay here).
const DECAY_TYPES = ["news", "catalyst", "signal", "filing"];

/** Tiered decay upkeep, per graph. (1) ARCHIVE active chronological nodes whose effective date is past
 *  their tier's archive window — a soft-hide (edges + a revision kept, recoverable via /archived). (2)
 *  HARD-DELETE long-archived nodes past their delete window via the reference-guarded prune RPC, which
 *  reclaims the row + its embedding but never touches a node that is evidence for an active thesis or
 *  linked to an active tracked entity. Snapshots a revision per archive. Returns counts. */
export async function decayStaleNodes(supabase: Client, graphId: string, nowMs: number): Promise<{ archived: number; deleted: number }> {
  const { data: rows } = await supabase
    .from("nodes")
    .select("id, type, title, status, data, created_at")
    .eq("graph_id", graphId)
    .in("type", DECAY_TYPES)
    .eq("lifecycle", "active");
  let archived = 0;
  for (const r of rows ?? []) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const cutoff = archiveCutoffMs(r.type, data, nowMs);
    if (cutoff == null) continue; // this type/tier never archives (e.g. a landmark catalyst)
    const effective = asOfFromData(data, Date.parse(r.created_at) || nowMs);
    if (effective >= cutoff) continue; // still fresh enough
    try {
      await writeNodeData(
        supabase,
        graphId,
        r.id,
        { lifecycle: "archived" },
        { prior: { type: r.type as NodeType, title: r.title, status: r.status, data }, reason: "archive", snapshot: true },
      );
      archived += 1;
    } catch (e) {
      reportError(e, { scope: "decayStaleNodes.archive", nodeId: r.id });
    }
  }

  let deleted = 0;
  try {
    const { data: n, error } = await supabase.rpc("prune_archived_nodes", {
      p_graph_id: graphId,
      p_now: new Date(nowMs).toISOString(),
    });
    if (error) throw new Error(error.message);
    deleted = n ?? 0;
  } catch (e) {
    reportError(e, { scope: "decayStaleNodes.prune", graph: graphId });
  }
  return { archived, deleted };
}

const AUTO_TRACK_DECAY_DAYS = 21;
const AUTO_TRACK_TYPES = new Set(["company", "sector", "theme", "product", "commodity"]);

/** Auto-discovery: promote entities linked to >= 2 ACTIVE tracked names to tracked CANDIDATES (source
 *  'auto', NOT fetched — the cost firewall) so the engine grows the watch-list without the user curating
 *  it. Manual/active rows are never touched. Stale candidates (not re-surfaced in 21d) are dropped.
 *  Returns counts. */
export async function detectConnections(supabase: Client, graphId: string, nowMs: number): Promise<{ discovered: number; dropped: number }> {
  const { data: tracked } = await supabase
    .from("tracked_entities")
    .select("node_id, source, candidate_status")
    .eq("graph_id", graphId);
  const active = new Set((tracked ?? []).filter((t) => t.candidate_status === "active").map((t) => t.node_id));
  // Never re-classify a manual follow or an already-active entry.
  const protectedIds = new Set((tracked ?? []).filter((t) => t.candidate_status === "active" || t.source === "manual").map((t) => t.node_id));

  // Decay first (independent of promotion): auto candidates not re-surfaced in the window are dropped,
  // which bounds the candidate pool. Runs even when there aren't enough active names to discover more.
  const cutoff = new Date(nowMs - AUTO_TRACK_DECAY_DAYS * 86_400_000).toISOString();
  const { data: droppedRows } = await supabase
    .from("tracked_entities")
    .update({ candidate_status: "dropped" })
    .eq("graph_id", graphId)
    .eq("source", "auto")
    .eq("candidate_status", "candidate")
    .lt("last_surfaced_at", cutoff)
    .select("node_id");
  const dropped = (droppedRows ?? []).length;

  if (active.size < 2) return { discovered: 0, dropped };

  const { data: edges } = await supabase.from("edges").select("src_id, dst_id").eq("graph_id", graphId).limit(3000);
  const holdingsByEntity = new Map<string, Set<string>>();
  for (const e of edges ?? []) {
    const sIn = active.has(e.src_id);
    const dIn = active.has(e.dst_id);
    if (sIn === dIn) continue; // want exactly one endpoint tracked (entity <-> holding)
    const entity = sIn ? e.dst_id : e.src_id;
    if (protectedIds.has(entity)) continue;
    const set = holdingsByEntity.get(entity) ?? new Set<string>();
    set.add(sIn ? e.src_id : e.dst_id);
    holdingsByEntity.set(entity, set);
  }
  const candidates = [...holdingsByEntity.entries()].filter(([, h]) => h.size >= 2);

  // Only promote node TYPES worth tracking (a company/sector/theme/product/commodity — not a news node).
  let discovered = 0;
  if (candidates.length > 0) {
    const { data: nodes } = await supabase
      .from("nodes")
      .select("id, type")
      .eq("graph_id", graphId)
      .in("id", candidates.map(([id]) => id));
    const typeById = new Map((nodes ?? []).map((n) => [n.id, n.type]));
    const nowIso = new Date(nowMs).toISOString();
    for (const [entity, h] of candidates) {
      if (!AUTO_TRACK_TYPES.has(typeById.get(entity) ?? "")) continue;
      const { error } = await supabase.from("tracked_entities").upsert(
        { graph_id: graphId, node_id: entity, kind: "discovered", source: "auto", candidate_status: "candidate", score: h.size, last_surfaced_at: nowIso },
        { onConflict: "graph_id,node_id" },
      );
      if (!error) discovered += 1;
    }
  }

  return { discovered, dropped };
}

/** Run the daily fetch→graph pipeline for one graph. Returns a summary (the route also sends the
 *  brief afterwards via sendDigest). Always attempts every step; per-call failures degrade. */
export async function runDailyForGraph(supabase: Client, graphId: string, deps: DailyDeps): Promise<DailySummary> {
  const runStartIso = new Date(deps.nowMs).toISOString();
  const companies = await trackedCompanies(supabase, graphId);

  const snapshots = await snapshotPrices(supabase, graphId, companies, deps);
  const { enqueued, skipped } = await enqueueNews(supabase, graphId, companies, deps);
  const drain = await drainPending(supabase, deps.worker, 5, { deadlineMs: deps.deadlineMs });
  const mentionsLinked = await linkNewsMentions(supabase, graphId, runStartIso);

  // Living-graph upkeep, isolated so a failure never aborts the fetch/brief.
  let archived = 0;
  let deleted = 0;
  try {
    ({ archived, deleted } = await decayStaleNodes(supabase, graphId, deps.nowMs));
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.decay", graph: graphId });
  }
  let pruned = false;
  try {
    const { error } = await supabase.rpc("prune_snapshots", { p_graph_id: graphId });
    if (error) throw new Error(error.message);
    pruned = true;
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.prune", graph: graphId });
  }

  // Auto-discovery: grow the watch-list from the graph's own connections (candidates only — never fetched).
  let discovered = 0;
  try {
    discovered = (await detectConnections(supabase, graphId, deps.nowMs)).discovered;
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.detectConnections", graph: graphId });
  }

  // Strict thesis-judge over the freshest evidence (bounded Sonnet cost). Only when a judge is wired.
  let thesesJudged = 0;
  if (deps.judge) {
    try {
      const judged = await judgeTheses(supabase, graphId, { judge: deps.judge, nowMs: deps.nowMs }, { deadlineMs: deps.deadlineMs });
      thesesJudged = judged.length;
    } catch (e) {
      reportError(e, { scope: "runDailyForGraph.judge", graph: graphId });
    }
  }

  // Replace a standing opinion when a freshly-added thesis near-restates it (high-confidence, reversible).
  // Time-boxed under the same deadline so it never starves the digest; isolated so a failure can't abort.
  let thesesSuperseded = 0;
  try {
    thesesSuperseded = await reconcileThesisSupersede(supabase, graphId, {
      sinceIso: runStartIso,
      embed: (t) => deps.worker.embed([t]).then((r) => r[0] ?? []),
      deadlineMs: deps.deadlineMs,
    });
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.thesisSupersede", graph: graphId });
  }

  return {
    graphId,
    trackedCompanies: companies.length,
    snapshots,
    newsEnqueued: enqueued,
    newsSkipped: skipped,
    drained: drain.processed,
    mentionsLinked,
    archived,
    deleted,
    pruned,
    thesesJudged,
    thesesSuperseded,
    discovered,
  };
}
