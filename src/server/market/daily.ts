import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { drainPending } from "@/server/normalize/drain";
import type { WorkerDeps } from "@/server/normalize/worker";
import { upsertEdge, writeNodeData } from "@/server/normalize/upsert";
import { newsArchiveCutoffMs } from "@/server/normalize/lifecycle";
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
}

export interface DailySummary {
  graphId: string;
  trackedCompanies: number;
  snapshots: number;
  newsEnqueued: number;
  newsSkipped: number;
  drained: number;
  mentionsLinked: number;
  archivedNews: number;
  pruned: boolean;
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
            const articles = await deps.market.news(c.ticker, from, to);
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

/** Archive stale, aging news so it drops out of default views + RAG (recoverable; edges preserved). A
 *  news node archives when its effective date (published_at, else created_at) is older than the
 *  materiality-based window. Snapshots a revision per node. Returns the count archived. */
export async function archiveStaleNews(supabase: Client, graphId: string, nowMs: number): Promise<number> {
  const { data: rows } = await supabase
    .from("nodes")
    .select("id, title, status, data, created_at")
    .eq("graph_id", graphId)
    .eq("type", "news")
    .eq("lifecycle", "active");
  let archived = 0;
  for (const r of rows ?? []) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const dateStr = typeof data.published_at === "string" && data.published_at ? data.published_at : r.created_at;
    const t = Date.parse(dateStr);
    const effective = Number.isNaN(t) ? nowMs : t;
    if (effective >= newsArchiveCutoffMs(data.materiality, nowMs)) continue; // still fresh enough
    try {
      await writeNodeData(
        supabase,
        graphId,
        r.id,
        { lifecycle: "archived" },
        { prior: { type: "news", title: r.title, status: r.status, data }, reason: "archive", snapshot: true },
      );
      archived += 1;
    } catch (e) {
      reportError(e, { scope: "archiveStaleNews", nodeId: r.id });
    }
  }
  return archived;
}

/** Run the daily fetch→graph pipeline for one graph. Returns a summary (the route also sends the
 *  brief afterwards via sendDigest). Always attempts every step; per-call failures degrade. */
export async function runDailyForGraph(supabase: Client, graphId: string, deps: DailyDeps): Promise<DailySummary> {
  const runStartIso = new Date(deps.nowMs).toISOString();
  const companies = await trackedCompanies(supabase, graphId);

  const snapshots = await snapshotPrices(supabase, graphId, companies, deps);
  const { enqueued, skipped } = await enqueueNews(supabase, graphId, companies, deps);
  const drain = await drainPending(supabase, deps.worker);
  const mentionsLinked = await linkNewsMentions(supabase, graphId, runStartIso);

  // Living-graph upkeep, isolated so a failure never aborts the fetch/brief.
  let archivedNews = 0;
  try {
    archivedNews = await archiveStaleNews(supabase, graphId, deps.nowMs);
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.archive", graph: graphId });
  }
  let pruned = false;
  try {
    const { error } = await supabase.rpc("prune_snapshots", { p_graph_id: graphId });
    if (error) throw new Error(error.message);
    pruned = true;
  } catch (e) {
    reportError(e, { scope: "runDailyForGraph.prune", graph: graphId });
  }

  return {
    graphId,
    trackedCompanies: companies.length,
    snapshots,
    newsEnqueued: enqueued,
    newsSkipped: skipped,
    drained: drain.processed,
    mentionsLinked,
    archivedNews,
    pruned,
  };
}
