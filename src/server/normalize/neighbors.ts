import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { embedTexts } from "./embed";
import { toVector } from "./upsert";
import type { NeighborLookup } from "./worker";

// Live nearest-node lookup for graph-aware extraction (#8). Embeds a chunk and pulls the top-K
// existing nodes via the match_nodes pgvector RPC, mapped to {id,title,type} link hints for the
// prompt. The threshold is higher than the dedupe vector-boost so only confident neighbors surface —
// these are linking suggestions, never auto-merges (merge stays gated by upsertNode). Server-only.

type Client = SupabaseClient<Database>;

const NEIGHBOR_THRESHOLD = 0.5; // confident-similarity floor for a hint
const NEIGHBOR_COUNT = 8;

// graphId is per-CALL (not factory-bound): one drain processes uploads belonging to different graphs,
// so the worker supplies each row's graph_id when it asks for neighbors. Lookups never cross graphs.
export function makeNeighborLookup(supabase: Client): NeighborLookup {
  return async (queryText, graphId, k = NEIGHBOR_COUNT) => {
    const [embedding] = await embedTexts([queryText]);
    if (!embedding) return [];
    const { data } = await supabase.rpc("match_nodes", {
      query_embedding: toVector(embedding),
      p_graph_id: graphId,
      match_threshold: NEIGHBOR_THRESHOLD,
      match_count: k,
    });
    return (data ?? []).map((n) => ({ id: n.id, title: n.title, type: n.type }));
  };
}
