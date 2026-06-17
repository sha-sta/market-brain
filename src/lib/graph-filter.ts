import type { GraphNode } from "@/lib/graph";

export interface NodeFilter {
  active: boolean; // a query is in effect (caller dims non-matches); false => render everything normally
  ids: Set<string>; // matching node ids
}

/** Pure: which node ids match a search query (case-insensitive substring over title / type / tags).
 *  Empty or whitespace-only query => inactive (no filtering). A non-empty query that matches nothing
 *  is active with an empty set, so the caller dims the whole graph (clear "no results" feedback). */
export function matchNodes(nodes: readonly GraphNode[], query: string): NodeFilter {
  const q = query.trim().toLowerCase();
  if (!q) return { active: false, ids: new Set() };
  const ids = new Set<string>();
  for (const n of nodes) {
    if (
      n.title.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    ) {
      ids.add(n.id);
    }
  }
  return { active: true, ids };
}
