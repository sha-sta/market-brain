// Shared artifact schema for the grounding eval. The live pass (grounding.eval.ts) WRITES a RunArtifact;
// the deterministic scorer (score.ts) and the precision judge (precision.eval.ts) READ it. Keeping the
// shapes in one place is what lets scoring re-run offline (no LLM, no DB) over a saved run.

/** One pinned source document fed to the pipeline as a single `raw_uploads` row. */
export interface CorpusDoc {
  id: string; // stable slug, e.g. "news-nvda-01" / "filing-aapl-8k-01"
  kind: "news" | "filing";
  source_ref: string; // canonical url (news) or filing url — the dedupe/idempotency key
  ticker: string | null;
  raw_text: string; // exactly what the extractor consumes
  meta: Record<string, string>; // ticker, url, published_at / accession, form_type, cik
}

export interface CorpusManifest {
  generatedAt: string;
  window: { from: string; to: string };
  basket: string[];
  newsPerTicker: number;
  docCount: number;
  docs: Array<{ id: string; kind: string; source_ref: string; ticker: string | null; sha256: string }>;
}

/** A relation exactly as the LLM proposed it (pre-gate): the raw quote rides in `evidence`. */
export interface CapturedRelation {
  subject: string;
  relation: string;
  object: string;
  evidence: string;
}

/** An entity exactly as the LLM proposed it (pre-dedupe): frontmatter may carry a proposed ticker. */
export interface CapturedNote {
  type: string;
  title: string;
  frontmatter: Record<string, unknown>;
}

export interface CapturedCorrection {
  target: string;
  field: string;
  new: string;
  evidence: string;
  confidence: number;
  kind: string;
}

/** Everything the extractor proposed for one corpus doc, plus the row it landed in. */
export interface PerDocCapture {
  docId: string;
  kind: string;
  source_ref: string;
  ticker: string | null;
  rawText: string; // the full doc text the gate verifies evidence against (upsertRelations uses row.raw_text)
  rowId: string | null;
  notes: CapturedNote[];
  relations: CapturedRelation[];
  corrections: CapturedCorrection[];
}

/** The edge as production actually persisted it (post-gate), incl. the DB-computed `assertable` column. */
export interface DbEdge {
  relation_type: string;
  confidence: number;
  evidence_quote: string | null;
  assertable: boolean | null;
  method: string;
  src_id: string;
  dst_id: string;
  source_upload_id: string | null;
}

export interface DbNode {
  id: string;
  type: string;
  title: string;
  ticker: string | null;
}

export interface RunArtifact {
  runId: string;
  generatedAt: string;
  manifestSha: string;
  extractor: string; // human note: which models the live pass used
  docs: PerDocCapture[];
  db: {
    edges: DbEdge[];
    nodes: DbNode[];
    mergeCandidates: number;
  };
}
