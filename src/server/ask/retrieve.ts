import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { mergeRetrieval, searchNodes } from "@/lib/graph";
import { toVector } from "@/server/normalize/upsert";
import { snippetOf, type AskSource } from "./prompt";

// Hybrid retrieval for /ask: vector (match_nodes pgvector) ∪ full-text (the `search` tsvector),
// merged + deduped + ranked. Vector catches paraphrase/semantic matches; FTS catches exact terms
// (names, acronyms) the embedding model smears. Pure orchestration over an injected embedder so it
// is integration-testable with a stub (no live LLM). Uses the caller's RLS client.

type Client = SupabaseClient<Database>;

export interface RetrieveDeps {
  embed: (texts: string[]) => Promise<number[][]>;
}

export async function retrieveSources(
  supabase: Client,
  question: string,
  graphId: string,
  deps: RetrieveDeps,
  cap = 8,
): Promise<AskSource[]> {
  const [embeddings, fts] = await Promise.all([
    deps.embed([question]).catch(() => [] as number[][]),
    searchNodes(supabase, question, graphId, { limit: 10 }),
  ]);

  const vectorIds: string[] = [];
  const embedding = embeddings[0];
  if (embedding && embedding.length > 0) {
    const { data: matches } = await supabase.rpc("match_nodes", {
      query_embedding: toVector(embedding),
      p_graph_id: graphId,
      match_threshold: 0.3,
      match_count: 8,
    });
    vectorIds.push(...(matches ?? []).map((m) => m.id));
  }

  const ids = mergeRetrieval(vectorIds, fts.map((n) => n.id), cap);
  if (ids.length === 0) return [];

  const { data: nodes } = await supabase.from("nodes").select("id, title, type, data").eq("graph_id", graphId).in("id", ids);
  const byId = new Map((nodes ?? []).map((n) => [n.id, n]));
  // Preserve the merged ranking order.
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => ({ id: n.id, title: n.title, type: n.type, snippet: snippetOf(n.data) }));
}
