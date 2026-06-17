// Canonical node types for the market knowledge graph. A node is a slug-keyed, dedupe-merged,
// embedded entity. High-churn numeric/time-series/user-config data (positions, prices, alerts,
// digests, tracking) lives in RELATIONAL tables, NOT here — see supabase/migrations/0026+.
//
// `note` is a first-class node for each dumped document (created by the worker, NOT emitted by the
// extractor — buildTypeSpec filters it out of the extraction prompt).

export const NODE_TYPES = [
  "company", // public OR private; ticker is identity for public, name for private
  "person", // execs / founders / insiders / analysts
  "sector", // first-class GICS-ish sector node
  "theme", // first-class investment theme (quantum-computing, ai, aerospace, ...)
  "news", // one research node per article (created by the daily cron or a paste)
  "filing", // SEC 8-K / Form 4
  "thesis", // the user's own investment thesis, as a node (so it embeds + gets confirm/challenge edges)
  "note", // a free-text dump, identical to brain's worker-only note
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export function isNodeType(s: string): s is NodeType {
  return (NODE_TYPES as readonly string[]).includes(s);
}

/** Type-specific fields (the old YAML frontmatter), stored in nodes.data jsonb. */
export type NoteData = Record<string, unknown>;

/**
 * An assembled, canonical node — the in-memory shape the pipeline works with before it
 * is written to Postgres. `data` holds the type-specific fields + `body` prose.
 */
export interface NodeRecord {
  id: string;
  type: NodeType;
  title: string;
  status: string;
  tags: string[];
  relatesTo: string[];
  source: string;
  data: NoteData;
}

/** Fields managed by the pipeline/DB — never set by the LLM inside frontmatter. */
export const MANAGED_FIELDS = ["id", "type", "created", "updated", "source"] as const;
