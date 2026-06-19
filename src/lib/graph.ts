import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isStrong } from "@/server/normalize/relations";

// Read queries for browse/search + node detail. Take a Supabase client so they're reusable from
// server components and integration-testable. RLS means only active users get rows.

type Client = SupabaseClient<Database>;
export type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];

export interface NodeListItem {
  id: string;
  type: string;
  title: string;
  status: string | null;
  tags: string[];
}

export interface SearchOpts {
  tags?: string[]; // filter to nodes carrying ANY of these tags (OR-semantics)
  limit?: number;
  includeHidden?: boolean; // include archived/superseded nodes (default: false — hide stale)
}

/** Full-text search over the `search` tsvector; empty query => most-recently-updated. An optional
 *  tag filter narrows to nodes overlapping any selected tag. Hidden (archived/superseded) nodes are
 *  excluded by default. Scoped to one graph. */
export async function searchNodes(
  supabase: Client,
  q: string,
  graphId: string,
  opts: SearchOpts = {},
): Promise<NodeListItem[]> {
  const { tags = [], limit = 50, includeHidden = false } = opts;
  let query = supabase.from("nodes").select("id, type, title, status, tags").eq("graph_id", graphId).limit(limit);
  if (!includeHidden) query = query.in("lifecycle", ["active", "stale"]);
  if (tags.length > 0) query = query.overlaps("tags", tags);
  if (q.trim()) {
    query = query.textSearch("search", q, { type: "websearch", config: "english" });
  } else {
    query = query.order("updated_at", { ascending: false });
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((n) => ({ ...n, tags: n.tags ?? [] }));
}

/** Merge vector (pgvector) and FTS retrieval id lists for /ask. Ids found by BOTH rank first (in
 *  vector order — strongest signal), then the remaining vector hits, then the remaining FTS hits;
 *  deduped and capped. Pure + testable. */
export function mergeRetrieval(vectorIds: readonly string[], ftsIds: readonly string[], cap = 10): string[] {
  const inFts = new Set(ftsIds);
  const both = vectorIds.filter((id) => inFts.has(id));
  const bothSet = new Set(both);
  const ordered = [
    ...both,
    ...vectorIds.filter((id) => !bothSet.has(id)),
    ...ftsIds.filter((id) => !bothSet.has(id)),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

// The whole-graph shape for the home force-graph (react-force-graph wants source/target keys).
export interface GraphNode {
  id: string;
  title: string;
  type: string;
  tags: string[];
  degree: number;
}
export interface GraphLink {
  source: string;
  target: string;
  type: string;
  relation_type: string; // representative: the strongest relation present on this node pair
  relations: string[]; // every relation_type on the pair, deduped, first-seen order (for the tooltip)
  strong: boolean; // any STRONG relation present -> solid styling (precomputed for the canvas)
}
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  total: number; // total node count (may exceed nodes.length when capped)
  capped: boolean;
}

const GRAPH_NODE_CAP = 1000;

/** Pure: fold node + edge rows into the force-graph shape. Degree = number of incident kept edges
 *  (node radius ∝ degree, counted per raw edge). Multi-edges between the same unordered node pair
 *  are collapsed into ONE link so they don't render as overlapping lines (#10): the representative
 *  relation is the strongest present (any STRONG -> solid), and every relation_type is carried in
 *  `relations` for the hover tooltip. Only links whose BOTH endpoints are in the node set are kept. */
export function toGraphData(
  nodeRows: ReadonlyArray<{ id: string; title: string; type: string; tags: string[] | null }>,
  edgeRows: ReadonlyArray<{ src_id: string; dst_id: string; type: string; relation_type: string }>,
  total = nodeRows.length,
): GraphData {
  const ids = new Set(nodeRows.map((n) => n.id));
  const degree = new Map<string, number>();
  const byPair = new Map<string, GraphLink>();
  for (const e of edgeRows) {
    if (!ids.has(e.src_id) || !ids.has(e.dst_id)) continue;
    degree.set(e.src_id, (degree.get(e.src_id) ?? 0) + 1);
    degree.set(e.dst_id, (degree.get(e.dst_id) ?? 0) + 1);
    const key = [e.src_id, e.dst_id].sort().join("|");
    const existing = byPair.get(key);
    if (existing) {
      if (!existing.relations.includes(e.relation_type)) {
        existing.relations.push(e.relation_type);
        const strong = existing.relations.find(isStrong);
        existing.strong = Boolean(strong);
        existing.relation_type = strong ?? existing.relations[0];
      }
    } else {
      byPair.set(key, {
        source: e.src_id,
        target: e.dst_id,
        type: e.type,
        relation_type: e.relation_type,
        relations: [e.relation_type],
        strong: isStrong(e.relation_type),
      });
    }
  }
  const links: GraphLink[] = [...byPair.values()];
  const nodes: GraphNode[] = nodeRows.map((n) => ({
    id: n.id,
    title: n.title,
    type: n.type,
    tags: n.tags ?? [],
    degree: degree.get(n.id) ?? 0,
  }));
  return { nodes, links, total, capped: total > nodes.length };
}

/** Whole-graph fetch for the home visualization, scoped to one graph. Caps at GRAPH_NODE_CAP
 *  most-recent nodes (now per-graph; pagination/clustering is future work). */
export async function getGraph(supabase: Client, graphId: string): Promise<GraphData> {
  const [{ data: nodeRows }, { count }] = await Promise.all([
    supabase
      .from("nodes")
      .select("id, title, type, tags")
      .eq("graph_id", graphId)
      .order("updated_at", { ascending: false })
      .limit(GRAPH_NODE_CAP),
    supabase.from("nodes").select("id", { count: "exact", head: true }).eq("graph_id", graphId),
  ]);
  const nodes = nodeRows ?? [];
  const ids = nodes.map((n) => n.id);
  // Any kept link has its src in the node set, so fetching by src_id covers all of them.
  const { data: edgeRows } = ids.length
    ? await supabase
        .from("edges")
        .select("src_id, dst_id, type, relation_type")
        .eq("graph_id", graphId)
        .in("src_id", ids)
    : { data: [] };
  return toGraphData(nodes, edgeRows ?? [], count ?? nodes.length);
}

/** Distinct tag values across one graph's nodes, sorted — for the browse filter chips. */
export async function distinctTags(supabase: Client, graphId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("nodes")
    .select("tags")
    .eq("graph_id", graphId)
    .not("tags", "is", null);
  if (error) throw new Error(error.message);
  const all = new Set<string>();
  for (const row of data ?? []) for (const t of row.tags ?? []) all.add(t);
  return [...all].sort();
}

/** A node by id within a graph. The id alone is no longer unique (the same slug can exist in another
 *  graph), so both keys are required. */
export async function getNode(supabase: Client, id: string, graphId: string): Promise<NodeRow | null> {
  const { data } = await supabase.from("nodes").select("*").eq("graph_id", graphId).eq("id", id).maybeSingle();
  return data;
}

export interface Neighbor {
  type: string;
  evidence: string | null; // verbatim source quote for grounded edges (provenance), else null
  support: number; // how many distinct source uploads corroborated this edge (>=1)
  node: { id: string; title: string; type: string };
}

/** Incoming + outgoing edges, resolved to the neighbour node's id/title/type, carrying each edge's
 *  evidence quote so the node detail can show WHY a relationship exists. */
export async function getNeighbors(
  supabase: Client,
  id: string,
  graphId: string,
): Promise<{ outgoing: Neighbor[]; incoming: Neighbor[] }> {
  const [{ data: out }, { data: inc }] = await Promise.all([
    supabase.from("edges").select("type, dst_id, evidence_quote, support_count").eq("graph_id", graphId).eq("src_id", id),
    supabase.from("edges").select("type, src_id, evidence_quote, support_count").eq("graph_id", graphId).eq("dst_id", id),
  ]);
  const ids = [...(out ?? []).map((e) => e.dst_id), ...(inc ?? []).map((e) => e.src_id)];
  const nodes = ids.length
    ? (await supabase.from("nodes").select("id, title, type").eq("graph_id", graphId).in("id", ids)).data ?? []
    : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const toNeighbor = (
    e: { type: string; evidence_quote: string | null; support_count: number },
    nid: string,
  ): Neighbor | null => {
    const node = byId.get(nid);
    return node ? { type: e.type, evidence: e.evidence_quote, support: e.support_count, node } : null;
  };
  return {
    outgoing: (out ?? []).map((e) => toNeighbor(e, e.dst_id)).filter((x): x is Neighbor => x !== null),
    incoming: (inc ?? []).map((e) => toNeighbor(e, e.src_id)).filter((x): x is Neighbor => x !== null),
  };
}

export interface Related {
  id: string;
  type: string;
  title: string;
  similarity: number;
}

/** pgvector "related" panel: nearest neighbours by embedding within the node's own graph, excluding
 *  the node itself. */
export async function getRelated(supabase: Client, node: NodeRow, limit = 6): Promise<Related[]> {
  if (!node.embedding) return [];
  const { data } = await supabase.rpc("match_nodes", {
    query_embedding: node.embedding,
    p_graph_id: node.graph_id,
    match_threshold: 0.3,
    match_count: limit,
    exclude_id: node.id,
  });
  return data ?? [];
}

export interface AssetView {
  id: string;
  kind: string;
  caption: string | null;
  url: string | null;
}

/** Linked binary assets with short-lived signed URLs (the bucket is private). Scoped to one graph. */
export async function getAssets(supabase: Client, id: string, graphId: string): Promise<AssetView[]> {
  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, caption, storage_path")
    .eq("graph_id", graphId)
    .eq("node_id", id);
  const out: AssetView[] = [];
  for (const a of assets ?? []) {
    const { data: signed } = await supabase.storage.from("assets").createSignedUrl(a.storage_path, 3600);
    out.push({ id: a.id, kind: a.kind, caption: a.caption, url: signed?.signedUrl ?? null });
  }
  return out;
}
