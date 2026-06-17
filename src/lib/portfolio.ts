import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Portfolio math + data access. The P&L / allocation core is PURE (unit-tested); the rest reads
// positions + the latest price snapshot per holding. Public companies value off live price * shares;
// private companies (Anthropic, SpaceX — no quote API) value off a manual_value. No advice anywhere —
// this surfaces what the holdings are worth; the reader draws his own conclusions.

type Client = SupabaseClient<Database>;

export interface Position {
  id: string;
  nodeId: string;
  title: string;
  ticker: string | null;
  isPublic: boolean;
  isWatchlist: boolean;
  shares: number | null;
  costBasis: number | null;
  manualValue: number | null;
  account: string | null;
  notes: string | null;
}

export interface PriceInfo {
  price: number | null;
  changePct: number | null;
}

export interface PositionValue {
  id: string; // the positions-table row id (for edit/delete)
  nodeId: string;
  title: string;
  ticker: string | null;
  isPublic: boolean;
  marketValue: number | null;
  costValue: number | null;
  unrealizedPnL: number | null;
  unrealizedPct: number | null;
  dayChangePct: number | null;
}

function num(v: unknown): number | null {
  const s = typeof v === "string" ? v.trim() : v;
  const n = typeof s === "string" ? (s === "" ? NaN : Number(s)) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Pure: value one position against its latest price. Public = shares × price (and P&L vs cost basis);
 *  private = manual_value (no P&L — there's no market price). Missing inputs degrade to null, never 0. */
export function computePnL(p: Position, price: PriceInfo | undefined): PositionValue {
  const base = { id: p.id, nodeId: p.nodeId, title: p.title, ticker: p.ticker, isPublic: p.isPublic };
  if (!p.isPublic) {
    const mv = p.manualValue;
    return { ...base, marketValue: mv, costValue: null, unrealizedPnL: null, unrealizedPct: null, dayChangePct: null };
  }
  const px = price?.price ?? null;
  const shares = p.shares;
  const marketValue = px !== null && shares !== null ? px * shares : null;
  const costValue = p.costBasis !== null && shares !== null ? p.costBasis * shares : null;
  const unrealizedPnL = marketValue !== null && costValue !== null ? marketValue - costValue : null;
  const unrealizedPct = unrealizedPnL !== null && costValue ? (unrealizedPnL / costValue) * 100 : null;
  return { ...base, marketValue, costValue, unrealizedPnL, unrealizedPct, dayChangePct: price?.changePct ?? null };
}

export interface Allocation {
  total: number;
  weights: Array<{ nodeId: string; title: string; weight: number }>; // weight in [0,1], desc
  topConcentration: number; // largest single weight in [0,1]
}

/** Pure: portfolio weights + concentration from valued positions (uses marketValue; nulls ignored). */
export function allocation(values: PositionValue[]): Allocation {
  const withVal = values.filter((v) => v.marketValue !== null && v.marketValue > 0) as Array<PositionValue & { marketValue: number }>;
  const total = withVal.reduce((s, v) => s + v.marketValue, 0);
  if (total <= 0) return { total: 0, weights: [], topConcentration: 0 };
  const weights = withVal
    .map((v) => ({ nodeId: v.nodeId, title: v.title, weight: v.marketValue / total }))
    .sort((a, b) => b.weight - a.weight);
  return { total, weights, topConcentration: weights[0]?.weight ?? 0 };
}

// --- Data access -------------------------------------------------------------------------------

/** Latest price snapshot per node in the graph. */
export async function latestPrices(supabase: Client, graphId: string): Promise<Map<string, PriceInfo>> {
  const { data } = await supabase
    .from("price_snapshots")
    .select("node_id, price, change_pct, captured_at")
    .eq("graph_id", graphId)
    .order("captured_at", { ascending: false })
    .limit(500);
  const out = new Map<string, PriceInfo>();
  for (const s of data ?? []) {
    if (!out.has(s.node_id)) out.set(s.node_id, { price: num(s.price), changePct: num(s.change_pct) });
  }
  return out;
}

/** Positions joined to their company node (title/ticker/is_public). */
export async function getPositions(supabase: Client, graphId: string): Promise<Position[]> {
  const { data: rows } = await supabase
    .from("positions")
    .select("id, node_id, account, shares, cost_basis, manual_value, is_watchlist, notes")
    .eq("graph_id", graphId);
  if (!rows || rows.length === 0) return [];
  const ids = rows.map((r) => r.node_id);
  const { data: nodes } = await supabase.from("nodes").select("id, title, data").eq("graph_id", graphId).in("id", ids);
  const byId = new Map((nodes ?? []).map((n) => [n.id, n] as const));
  return rows.map((r) => {
    const node = byId.get(r.node_id);
    const d = ((node?.data ?? {}) as Record<string, unknown>);
    return {
      id: r.id,
      nodeId: r.node_id,
      title: node?.title ?? r.node_id,
      ticker: typeof d.ticker === "string" ? d.ticker : null,
      isPublic: d.is_public !== false,
      isWatchlist: r.is_watchlist,
      shares: num(r.shares),
      costBasis: num(r.cost_basis),
      manualValue: num(r.manual_value),
      account: r.account,
      notes: r.notes,
    };
  });
}

/** Value every position + portfolio-level allocation. The page's single data call. */
export async function getPortfolio(
  supabase: Client,
  graphId: string,
): Promise<{ positions: PositionValue[]; allocation: Allocation; raw: Position[] }> {
  const [positions, prices] = await Promise.all([getPositions(supabase, graphId), latestPrices(supabase, graphId)]);
  const valued = positions.map((p) => computePnL(p, prices.get(p.nodeId)));
  return { positions: valued, allocation: allocation(valued), raw: positions };
}
