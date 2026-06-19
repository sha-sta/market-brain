import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { writeNodeData, toVector, type NodePrior } from "@/server/normalize/upsert";
import type { NodeType } from "@/server/normalize/types";
import { pastDeadline } from "@/server/lib/deadline";
import { reportError } from "@/lib/observability";
import { SUPERSEDE_SIMILARITY, shouldSupersede, sharesSubject } from "./thesis-supersede-rules";

// Theses are the user's standing OPINIONS — replaced when he forms a new view, never time-decayed. This
// detects when a freshly-added thesis NEAR-RESTATES an existing one about the same subject and, at high
// confidence, marks the old one superseded (pointing at the new) through the writeNodeData choke-point
// so it snapshots a reversible revision and the judge stops re-judging it (subgraph filters active/stale).

type Client = SupabaseClient<Database>;

export interface SupersedeCandidate {
  oldId: string;
  newId: string;
  similarity: number;
}

/** Does `newThesis` replace an existing thesis? Re-embeds its statement, finds the nearest thesis nodes
 *  (active/stale, self excluded) via match_nodes, and returns the top one that clears the similarity bar
 *  AND shares a subject. One embed + one RPC; null when nothing qualifies. */
export async function detectThesisSupersede(
  supabase: Client,
  graphId: string,
  newThesis: { id: string; data: Record<string, unknown> },
  embed: (text: string) => Promise<number[]>,
): Promise<SupersedeCandidate | null> {
  const statement = typeof newThesis.data.statement === "string" ? newThesis.data.statement.trim() : "";
  if (!statement || !sharesSubjectAnchor(newThesis.data)) return null;

  const vec = await embed(statement);
  if (vec.length === 0) return null;

  const { data: hits } = await supabase.rpc("match_nodes", {
    query_embedding: toVector(vec),
    p_graph_id: graphId,
    match_threshold: SUPERSEDE_SIMILARITY, // RPC already drops anything below the bar
    match_count: 5,
    exclude_id: newThesis.id,
  });
  const thesisHits = (hits ?? []).filter((h) => h.type === "thesis");
  if (thesisHits.length === 0) return null;

  // match_nodes is type/subject-agnostic, so confirm the shared-subject requirement on the candidates.
  const { data: rows } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("graph_id", graphId)
    .in("id", thesisHits.map((h) => h.id))
    .in("lifecycle", ["active", "stale"]);
  const dataById = new Map((rows ?? []).map((r) => [r.id, (r.data ?? {}) as Record<string, unknown>]));

  for (const h of thesisHits) {
    // thesisHits are similarity-desc; take the first that also shares a subject and clears the bar.
    const old = dataById.get(h.id);
    if (!old) continue;
    if (shouldSupersede(h.similarity, sharesSubject(newThesis.data, old))) {
      return { oldId: h.id, newId: newThesis.id, similarity: h.similarity };
    }
  }
  return null;
}

function sharesSubjectAnchor(data: Record<string, unknown>): boolean {
  return Array.isArray(data.about) && data.about.length > 0;
}

/** Mark the OLD thesis superseded, pointing at the NEW one — via writeNodeData so it snapshots a
 *  revision (reversible) and satisfies the 0034 invariant (superseded_by => lifecycle='superseded'). */
export async function applyThesisSupersede(supabase: Client, graphId: string, candidate: SupersedeCandidate): Promise<boolean> {
  const { data: row } = await supabase
    .from("nodes")
    .select("type, title, status, data")
    .eq("graph_id", graphId)
    .eq("id", candidate.oldId)
    .maybeSingle();
  if (!row) return false;
  const prior: NodePrior = {
    type: row.type as NodeType,
    title: row.title,
    status: row.status,
    data: (row.data ?? {}) as Record<string, unknown>,
  };
  try {
    await writeNodeData(
      supabase,
      graphId,
      candidate.oldId,
      { lifecycle: "superseded", supersededBy: candidate.newId },
      { prior, reason: "thesis-supersede", snapshot: true },
    );
    return true;
  } catch (e) {
    reportError(e, { scope: "applyThesisSupersede", oldId: candidate.oldId });
    return false;
  }
}

/** Daily pass: for theses added since the run started, auto-supersede the prior thesis each near-restates
 *  (high-confidence only). Time-boxed under the cron deadline. Returns the count applied. */
export async function reconcileThesisSupersede(
  supabase: Client,
  graphId: string,
  opts: { sinceIso: string; embed: (text: string) => Promise<number[]>; deadlineMs?: number },
): Promise<number> {
  const { data: fresh } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("graph_id", graphId)
    .eq("type", "thesis")
    .in("lifecycle", ["active", "stale"])
    .gte("created_at", opts.sinceIso)
    .limit(50);

  let applied = 0;
  for (const t of fresh ?? []) {
    if (pastDeadline(opts.deadlineMs)) break;
    try {
      const cand = await detectThesisSupersede(supabase, graphId, { id: t.id, data: (t.data ?? {}) as Record<string, unknown> }, opts.embed);
      if (cand && (await applyThesisSupersede(supabase, graphId, cand))) applied += 1;
    } catch (e) {
      reportError(e, { scope: "reconcileThesisSupersede", thesisId: t.id });
    }
  }
  return applied;
}
