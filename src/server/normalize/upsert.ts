import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { findDuplicate } from "./dedupe";
import { mergeNode } from "./merge";
import { slugify } from "./assemble";
import type { NodeRecord, NodeType } from "./types";
import type { RawRelation } from "./extract-schema";
import { CONFIDENCE_WIKILINK, fieldToRelation, resolveGroundedEdge } from "./relations";

// reason: node.data is JSON-origin (zod output of the LLM envelope), so the unknown->Json
// assertion is sound. unknown->Json is a single allowed assertion (not an as-unknown-as cast).
const asJson = (v: unknown): Json => v as Json;

// The IO side of normalization: dedupe an assembled node against the DB (fuzzy name ∪ pgvector
// boost), then merge into the existing node or insert a new one, and wire up edges from its
// wikilink fields. Uses the service-role client (bypasses RLS) — called only by the worker.

type Client = SupabaseClient<Database>;
type NodeRow = Database["public"]["Tables"]["nodes"]["Row"];

// Promote an ambiguous fuzzy match to a confident merge when the same node is also a close
// embedding neighbour (the "vector hit promotes a borderline match").
const VECTOR_BOOST_THRESHOLD = 0.9;
const WIKILINK = /\[\[([^\]]+)\]\]/g;

/** Text fed to the embedding model: the human-meaningful fields. For a `note` we embed only the
 *  title + summary, NOT the full body — long bodies get truncated by the embedding model, which
 *  drags the vector toward the document's opening. Entities embed their identity + prose fields
 *  (a company's name/description, a news headline/summary, a thesis statement). Pure. */
export function embedText(node: NodeRecord): string {
  const d = node.data;
  const fields =
    node.type === "note"
      ? [node.title, d.summary]
      : [node.title, d.name, d.headline, d.statement, d.description, d.definition, d.summary, d.body];
  return fields.filter((v): v is string => typeof v === "string" && v.length > 0).join(" ").trim();
}

/** number[] -> pgvector literal. */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Parse outbound edges from a node's wikilink fields ([[dst]] in any string/list field). Pure. */
export function extractLinks(node: NodeRecord): Array<{ dst: string; type: string }> {
  const links: Array<{ dst: string; type: string }> = [];
  const scan = (val: unknown, field: string) => {
    if (typeof val !== "string") return;
    for (const m of val.matchAll(WIKILINK)) links.push({ dst: m[1].trim(), type: field });
  };
  for (const [field, val] of Object.entries(node.data)) {
    if (Array.isArray(val)) val.forEach((v) => scan(v, field));
    else scan(val, field);
  }
  node.relatesTo.forEach((v) => scan(v, "relates_to"));
  return links;
}

function rowToRecord(row: Pick<NodeRow, "id" | "type" | "title" | "status" | "tags" | "data">): NodeRecord {
  return {
    id: row.id,
    type: row.type as NodeType,
    title: row.title,
    status: row.status ?? "active",
    tags: row.tags ?? [],
    relatesTo: [],
    source: "upload",
    data: (row.data ?? {}) as Record<string, unknown>,
  };
}

async function sameTypeCandidates(supabase: Client, type: string, graphId: string): Promise<NodeRecord[]> {
  const { data } = await supabase
    .from("nodes")
    .select("id, type, title, status, tags, data")
    .eq("graph_id", graphId)
    .eq("type", type)
    .limit(500);
  return (data ?? []).map(rowToRecord);
}

async function ensureUniqueId(supabase: Client, base: string, graphId: string): Promise<string> {
  let id = base;
  let n = 2;
  // Bump on collision with a DIFFERENT existing entity that happens to share the slug — WITHIN this
  // graph only. The same slug in another graph is a separate node (isolation), so it never bumps here.
  for (;;) {
    const { data } = await supabase.from("nodes").select("id").eq("graph_id", graphId).eq("id", id).maybeSingle();
    if (!data) return id;
    id = `${base}-${n}`;
    n += 1;
  }
}

export interface UpsertResult {
  id: string;
  action: "inserted" | "merged";
}

/** Dedupe `node` against the DB (within `graphId` only — dedupe never crosses graphs), then merge or
 *  insert. Returns the resolved node id. */
export async function upsertNode(
  supabase: Client,
  node: NodeRecord,
  embedding: number[],
  contributor: string | null,
  graphId: string,
): Promise<UpsertResult> {
  const candidates = await sameTypeCandidates(supabase, node.type, graphId);
  const fields = { title: node.title, ...node.data };
  const dup = findDuplicate(
    candidates.map((c) => ({ id: c.id, type: c.type, fields: { title: c.title, ...c.data } })),
    node.type,
    fields,
  );

  let verdict = dup.verdict;
  if (verdict === "ambiguous" && dup.best && embedding.length > 0) {
    const { data: neighbors } = await supabase.rpc("match_nodes", {
      query_embedding: toVector(embedding),
      p_graph_id: graphId,
      match_threshold: VECTOR_BOOST_THRESHOLD,
      match_count: 5,
    });
    if ((neighbors ?? []).some((n) => n.id === dup.best!.id)) verdict = "match";
  }

  if (verdict === "match" && dup.best) {
    const existing = candidates.find((c) => c.id === dup.best!.id)!;
    const { merged } = mergeNode(existing, node);
    const { error } = await supabase
      .from("nodes")
      .update({ data: asJson(merged.data), tags: merged.tags, embedding: toVector(embedding) })
      .eq("graph_id", graphId)
      .eq("id", existing.id);
    if (error) throw new Error(`node merge failed: ${error.message}`);
    return { id: existing.id, action: "merged" };
  }

  const id = await ensureUniqueId(supabase, node.id, graphId);
  const { error } = await supabase.from("nodes").insert({
    id,
    graph_id: graphId,
    type: node.type,
    title: node.title,
    status: node.status,
    data: asJson(node.data),
    tags: node.tags,
    contributor,
    embedding: toVector(embedding),
  });
  if (error) throw new Error(`node insert failed: ${error.message}`);
  // Ambiguous near-duplicate (fuzzy 72-87, not promoted by the vector boost): we inserted a NEW node
  // (the safe default — never auto-merge on doubt) but queue the pair for human review so a real merge
  // isn't silently lost. (SAME_AS review queue)
  if (verdict === "ambiguous" && dup.best) {
    await recordMergeCandidate(supabase, id, dup.best.id, dup.score, graphId);
  }
  return { id, action: "inserted" };
}

/** Queue an ambiguous (newId, existingId) pair for admin review in node_merge_candidates. */
async function recordMergeCandidate(
  supabase: Client,
  leftId: string,
  rightId: string,
  score: number,
  graphId: string,
): Promise<void> {
  const { error } = await supabase
    .from("node_merge_candidates")
    .insert({ graph_id: graphId, left_id: leftId, right_id: rightId, score });
  if (error) throw new Error(`merge candidate insert failed: ${error.message}`);
}

/** Insert a worker-built node directly — NO dedupe/merge — so each dumped document yields a
 *  DISTINCT note node (two dumps must never fuzzy-merge into one). Idempotent on re-run via the id
 *  conflict. Used for `note` nodes only. */
export async function insertNoteNode(
  supabase: Client,
  note: NodeRecord,
  embedding: number[],
  contributor: string | null,
  graphId: string,
): Promise<string> {
  const { error } = await supabase.from("nodes").upsert(
    {
      id: note.id,
      graph_id: graphId,
      type: note.type,
      title: note.title,
      status: note.status,
      data: asJson(note.data),
      tags: note.tags,
      contributor,
      embedding: toVector(embedding),
    },
    { onConflict: "graph_id,id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`note insert failed: ${error.message}`);
  return note.id;
}

// Edge integrity metadata persisted alongside (src,dst,type). `relation_type` + `confidence` +
// `evidence_quote` drive the DB's generated `assertable` column.
export interface EdgeMeta {
  relation_type: string;
  method: string;
  confidence: number;
  evidence_quote?: string | null;
  source_upload_id?: string | null;
}

/** Single edge writer. Goes through the `upsert_edge` RPC so the insert-or-refresh is atomic: on a
 *  (graph,src,dst,type) conflict it keeps the strongest confidence/evidence and bumps `support_count`
 *  when a DIFFERENT source upload corroborates the edge. Skips self-edges. */
async function writeEdge(
  supabase: Client,
  srcId: string,
  dstId: string,
  type: string,
  meta: EdgeMeta,
  graphId: string,
): Promise<boolean> {
  if (srcId === dstId) return false;
  const { error } = await supabase.rpc("upsert_edge", {
    p_graph_id: graphId,
    p_src_id: srcId,
    p_dst_id: dstId,
    p_type: type,
    p_relation_type: meta.relation_type,
    p_method: meta.method,
    p_confidence: meta.confidence,
    p_evidence_quote: meta.evidence_quote ?? undefined,
    p_source_upload_id: meta.source_upload_id ?? undefined,
  });
  if (error) throw new Error(`edge upsert failed: ${error.message}`);
  return true;
}

/** Idempotent typed edge insert (e.g. note --mentions--> entity). Defaults to a non-assertable
 *  wikilink edge; pass `meta` for provenance/grounded edges. Skips self-edges. */
export async function upsertEdge(
  supabase: Client,
  srcId: string,
  dstId: string,
  type: string,
  graphId: string,
  meta?: Partial<EdgeMeta>,
): Promise<void> {
  await writeEdge(
    supabase,
    srcId,
    dstId,
    type,
    {
      relation_type: meta?.relation_type ?? fieldToRelation(type),
      method: meta?.method ?? "wikilink",
      confidence: meta?.confidence ?? CONFIDENCE_WIKILINK,
      evidence_quote: meta?.evidence_quote,
      source_upload_id: meta?.source_upload_id,
    },
    graphId,
  );
}

/** Resolve a wikilink target to an actual node id WITHIN this graph: exact match, then slugified
 *  fallback (so [[NVIDIA]] finds the `nvidia` node). Scoping to graphId is critical: a [[Foo]] in
 *  graph B must never resolve to graph A's `foo`. */
async function resolveNodeId(supabase: Client, target: string, graphId: string): Promise<string | null> {
  const candidates = [target, slugify(target)];
  for (const candidate of candidates) {
    const { data } = await supabase
      .from("nodes")
      .select("id")
      .eq("graph_id", graphId)
      .eq("id", candidate)
      .maybeSingle();
    if (data) return data.id;
  }
  return null;
}

/** Insert STRUCTURAL edges for a node's wikilinks whose target node exists. These carry no evidence
 *  (method 'wikilink', low confidence) so even a strong-mapped field (founders->founded_by) is NOT
 *  assertable until a grounded relation corroborates it. Idempotent. Returns count. */
export async function upsertEdges(
  supabase: Client,
  srcId: string,
  node: NodeRecord,
  graphId: string,
  sourceUploadId?: string | null,
): Promise<number> {
  let created = 0;
  for (const { dst, type } of extractLinks(node)) {
    const resolved = await resolveNodeId(supabase, dst, graphId);
    if (!resolved || resolved === srcId) continue;
    await writeEdge(
      supabase,
      srcId,
      resolved,
      type,
      {
        relation_type: fieldToRelation(type),
        method: "wikilink",
        confidence: CONFIDENCE_WIKILINK,
        evidence_quote: null,
        source_upload_id: sourceUploadId ?? null,
      },
      graphId,
    );
    created += 1;
  }
  return created;
}

/** Create GROUNDED edges from the extractor's `relations` array. Each relation's verbatim evidence
 *  is verified against the source text; a STRONG claim that fails verification is downgraded to a
 *  non-assertable association rather than minting a false fact. Returns the count written. */
export async function upsertRelations(
  supabase: Client,
  relations: RawRelation[],
  sourceText: string,
  sourceUploadId: string | null,
  graphId: string,
): Promise<number> {
  let created = 0;
  for (const r of relations) {
    const srcId = await resolveNodeId(supabase, r.subject, graphId);
    const dstId = await resolveNodeId(supabase, r.object, graphId);
    if (!srcId || !dstId || srcId === dstId) continue;
    const g = resolveGroundedEdge(r.relation, r.evidence, sourceText);
    await writeEdge(
      supabase,
      srcId,
      dstId,
      g.relation_type,
      {
        relation_type: g.relation_type,
        method: g.method,
        confidence: g.confidence,
        evidence_quote: g.evidence_quote,
        source_upload_id: sourceUploadId,
      },
      graphId,
    );
    created += 1;
  }
  return created;
}
