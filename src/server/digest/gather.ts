import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { rankItems } from "@/server/market/rank";
import type { BriefData, Connection, FilingItem, Mover, NewsItem, ThesisCheck } from "./compose";

// Gather the graph's deltas since the last brief into the pure BriefData composeBrief consumes. All
// reads degrade to [] on absence. The connection-surfacing step ("TSMC appears across 3 of your
// holdings") is the graph's trick a news reader can't do — an entity linked to multiple holdings.

type Client = SupabaseClient<Database>;

const MAX_NEWS = 8;
const MAX_MOVERS = 8;
const MAX_CONNECTIONS = 5;
const MAX_THESIS_CHECKS = 5;
const STRENGTH_ORDER: Record<string, number> = { unsupported: 0, weak: 1, contested: 2, supported: 3, "well-supported": 4 };

function num(v: unknown): number | null {
  const s = typeof v === "string" ? v.trim() : v;
  const n = typeof s === "string" ? (s === "" ? NaN : Number(s)) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function gatherBrief(
  supabase: Client,
  graphId: string,
  opts: { date: string; sinceIso: string; nowMs: number },
): Promise<BriefData> {
  const [movers, news, filings, alerts, connections, thesisChecks] = await Promise.all([
    gatherMovers(supabase, graphId),
    gatherNews(supabase, graphId, opts.sinceIso, opts.nowMs),
    gatherFilings(supabase, graphId, opts.sinceIso),
    gatherAlerts(supabase, graphId, opts.sinceIso),
    gatherConnections(supabase, graphId),
    gatherThesisChecks(supabase, graphId, opts.sinceIso),
  ]);
  return { date: opts.date, movers, news, filings, alerts, connections, thesisChecks };
}

async function titles(supabase: Client, graphId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("nodes").select("id, title").eq("graph_id", graphId).in("id", ids);
  return new Map((data ?? []).map((n) => [n.id, n.title]));
}

/** Latest snapshot per tracked node, sorted by absolute day move. */
async function gatherMovers(supabase: Client, graphId: string): Promise<Mover[]> {
  const { data: snaps } = await supabase
    .from("price_snapshots")
    .select("node_id, ticker, price, change_pct, captured_at")
    .eq("graph_id", graphId)
    .order("captured_at", { ascending: false })
    .limit(400);
  const latest = new Map<string, { ticker: string; price: number | null; change: number | null }>();
  for (const s of snaps ?? []) {
    if (!latest.has(s.node_id)) latest.set(s.node_id, { ticker: s.ticker, price: num(s.price), change: num(s.change_pct) });
  }
  if (latest.size === 0) return [];
  const titleById = await titles(supabase, graphId, [...latest.keys()]);
  const movers: Mover[] = [...latest.entries()].map(([id, v]) => ({
    title: titleById.get(id) ?? v.ticker,
    ticker: v.ticker,
    price: v.price,
    changePct: v.change,
  }));
  movers.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  return movers.slice(0, MAX_MOVERS);
}

/** New news nodes since the last brief, ranked, with the holdings each names (mentions edges). */
async function gatherNews(supabase: Client, graphId: string, sinceIso: string, nowMs: number): Promise<NewsItem[]> {
  const { data: rows } = await supabase
    .from("nodes")
    .select("id, title, data, created_at")
    .eq("graph_id", graphId)
    .eq("type", "news")
    .in("lifecycle", ["active", "stale"]) // exclude archived/superseded from the brief
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(60);
  if (!rows || rows.length === 0) return [];

  const ranked = rankItems(
    rows.map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return { id: r.id, title: r.title, data: d, publishedAt: typeof d.published_at === "string" ? d.published_at : r.created_at, materiality: typeof d.materiality === "string" ? d.materiality : null };
    }),
    nowMs, // recency is measured from NOW, not the window start (else every fresh item ties at max)
  ).slice(0, MAX_NEWS);

  // One query for all mentions edges of the chosen news nodes -> holding titles.
  const ids = ranked.map((r) => r.id);
  const { data: edges } = await supabase
    .from("edges")
    .select("src_id, dst_id")
    .eq("graph_id", graphId)
    .eq("type", "mentions")
    .in("src_id", ids);
  const dstIds = [...new Set((edges ?? []).map((e) => e.dst_id))];
  const titleById = await titles(supabase, graphId, dstIds);
  const mentionsBySrc = new Map<string, string[]>();
  for (const e of edges ?? []) {
    const t = titleById.get(e.dst_id);
    if (!t) continue;
    const arr = mentionsBySrc.get(e.src_id) ?? [];
    arr.push(t);
    mentionsBySrc.set(e.src_id, arr);
  }

  return ranked.map((r) => {
    const d = r.data;
    return {
      headline: typeof d.headline === "string" ? d.headline : r.title,
      url: typeof d.url === "string" ? d.url : null,
      source: typeof d.source === "string" ? d.source : null,
      sentiment: typeof d.sentiment === "string" ? d.sentiment : null,
      materiality: typeof d.materiality === "string" ? d.materiality : null,
      mentions: mentionsBySrc.get(r.id) ?? [],
    };
  });
}

async function gatherFilings(supabase: Client, graphId: string, sinceIso: string): Promise<FilingItem[]> {
  const { data: rows } = await supabase
    .from("nodes")
    .select("data, created_at")
    .eq("graph_id", graphId)
    .eq("type", "filing")
    .in("lifecycle", ["active", "stale"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(20);
  return (rows ?? []).map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return {
      formType: typeof d.form_type === "string" ? d.form_type : "filing",
      company: typeof d.company === "string" ? d.company.replace(/\[\[|\]\]/g, "") : null,
      url: typeof d.url === "string" ? d.url : null,
    };
  });
}

async function gatherAlerts(supabase: Client, graphId: string, sinceIso: string): Promise<string[]> {
  const { data: rows } = await supabase
    .from("alert_events")
    .select("message, fired_at")
    .eq("graph_id", graphId)
    .gte("fired_at", sinceIso)
    .order("fired_at", { ascending: false })
    .limit(20);
  return (rows ?? []).map((r) => r.message);
}

/** Entities (suppliers, peers, news subjects) linked to >= 2 of the tracked names — the cross-holding
 *  connections a news reader can't see. */
async function gatherConnections(supabase: Client, graphId: string): Promise<Connection[]> {
  const { data: tracked } = await supabase
    .from("tracked_entities")
    .select("node_id")
    .eq("graph_id", graphId)
    .eq("candidate_status", "active");
  const trackedIds = new Set((tracked ?? []).map((t) => t.node_id));
  if (trackedIds.size < 2) return [];

  const { data: edges } = await supabase.from("edges").select("src_id, dst_id").eq("graph_id", graphId).limit(3000);
  const holdingsByEntity = new Map<string, Set<string>>();
  for (const e of edges ?? []) {
    const sIn = trackedIds.has(e.src_id);
    const dIn = trackedIds.has(e.dst_id);
    if (sIn === dIn) continue; // want exactly one endpoint tracked (entity <-> holding)
    const entity = sIn ? e.dst_id : e.src_id;
    const holding = sIn ? e.src_id : e.dst_id;
    if (trackedIds.has(entity)) continue;
    const set = holdingsByEntity.get(entity) ?? new Set<string>();
    set.add(holding);
    holdingsByEntity.set(entity, set);
  }

  const ranked = [...holdingsByEntity.entries()]
    .filter(([, h]) => h.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_CONNECTIONS);
  if (ranked.length === 0) return [];

  const idsForTitles = [...new Set(ranked.flatMap(([entity, h]) => [entity, ...h]))];
  const titleById = await titles(supabase, graphId, idsForTitles);
  return ranked.map(([entity, h]) => ({
    entity: titleById.get(entity) ?? entity,
    holdings: [...h].map((id) => titleById.get(id) ?? id),
  }));
}

/** Theses re-judged since the last brief, with the strict-critic verdict. Problems (weak/contested/
 *  unsupported) are surfaced first — the brief leads with what's NOT holding up. */
async function gatherThesisChecks(supabase: Client, graphId: string, sinceIso: string): Promise<ThesisCheck[]> {
  const { data: rows } = await supabase
    .from("nodes")
    .select("id, title, data")
    .eq("graph_id", graphId)
    .eq("type", "thesis")
    .in("lifecycle", ["active", "stale"])
    .gte("last_judged_at", sinceIso)
    .order("last_judged_at", { ascending: false })
    .limit(20);

  const checks: ThesisCheck[] = [];
  for (const r of rows ?? []) {
    const judge = ((r.data ?? {}) as Record<string, unknown>).judge;
    if (!judge || typeof judge !== "object") continue;
    const j = judge as Record<string, unknown>;
    checks.push({
      nodeId: r.id,
      title: r.title,
      strength: typeof j.strength === "string" ? j.strength : "weak",
      bearCase: typeof j.bear_case === "string" ? j.bear_case : "",
      confirming: typeof j.confirming_count === "number" ? j.confirming_count : 0,
      challenging: typeof j.challenging_count === "number" ? j.challenging_count : 0,
    });
  }
  checks.sort((a, b) => (STRENGTH_ORDER[a.strength] ?? 1) - (STRENGTH_ORDER[b.strength] ?? 1));
  return checks.slice(0, MAX_THESIS_CHECKS);
}
