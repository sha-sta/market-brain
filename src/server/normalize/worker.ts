import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { ExtractEnvelope } from "./extract-schema";
import { buildTypeSpec, type ExistingEntity } from "./prompt";
import { validateNoteData } from "./schemas";
import { assemble, type ExtractedNote } from "./assemble";
import { isNodeType, type NodeRecord } from "./types";
import { embedText, insertNoteNode, upsertEdge, upsertEdges, upsertNode, upsertRelations } from "./upsert";
import { chunkText } from "./chunk";
import { normalizeTags } from "./tags";
import { mergeNode } from "./merge";
import { CONFIDENCE_WEAK } from "./relations";
import { applyCorrections } from "./reconcile";
import type { RawRelation, RawCorrection } from "./extract-schema";
import { addChunkUsage, EMPTY_USAGE, type ExtractUsage, type UsageTotals } from "./usage";
import { noteIdFor } from "./note-id";
import { reportError } from "@/lib/observability";

// Orchestrates one raw_uploads row: extract -> validate (retry once) -> dedupe/merge/insert ->
// edges -> embeddings, updating status. extract/embed are INJECTED so the worker is fully
// integration-tested with stubs (no live API); the drain route wires the real AI Gateway calls.
// A news article and a user note are both just raw_uploads rows — the cron manufactures the former.

type Client = SupabaseClient<Database>;

/** What an extractor returns: the parsed envelope + optionally the call's token usage. */
export interface ExtractResult {
  envelope: ExtractEnvelope;
  usage?: ExtractUsage;
}

export type Extractor = (
  rawText: string,
  typeSpec: string,
  errors?: string[],
  existingEntities?: ExistingEntity[],
) => Promise<ExtractResult>;
export type Embedder = (texts: string[]) => Promise<number[][]>;
/** Retrieve the nearest existing graph nodes for a chunk, injected as [[id]] link hints. Optional on
 *  WorkerDeps: when absent the worker extracts per-doc-blind. */
export type NeighborLookup = (queryText: string, graphId: string, k?: number) => Promise<ExistingEntity[]>;

/** Outcome of grounding one entity's identity in real market data. */
export interface EntityEnrichSummary {
  nodeId: string;
  enriched: boolean; // a field was filled from a real data source
  fieldsFilled: string[]; // e.g. ["ticker", "cik", "sector"]
  skipped: "not-a-company" | "private" | "already-grounded" | "not-found" | null;
}

/** Ground a `company` node's identity (ticker/cik/sector/exchange) in real market data (FMP/Finnhub)
 *  when the LLM left those blank — grounding identity in data, not the model. Optional on WorkerDeps
 *  (every stub-based worker test keeps compiling with just { extract, embed }). graphId scopes the
 *  lookup. */
export type EntityEnricher = (
  nodeId: string,
  graphId: string,
  sourceUploadId?: string | null,
) => Promise<EntityEnrichSummary>;

export interface WorkerDeps {
  extract: Extractor;
  embed: Embedder;
  neighbors?: NeighborLookup;
  enrichEntities?: EntityEnricher;
}

export interface WorkerResult {
  id: string;
  status: "done" | "failed";
  nodeIds: string[]; // extracted ENTITY node ids (excludes the note node)
  noteId?: string; // the first-class note node created for this document
  chunksFailed?: number; // chunks whose LLM output never parsed (skipped, not fatal to the document)
  usage?: UsageTotals; // summed token usage + estimated $ cost across the document's chunks
  error?: string;
}

// Fed back to the model when its output couldn't be parsed at all (not a per-field validation issue).
const PARSE_RETRY_HINT =
  "Your previous response was not valid JSON in the required shape (it failed to parse). Return STRICT, " +
  "COMPLETE JSON matching the schema exactly — a single top-level object, no prose, no markdown fences, " +
  "no trailing text, and no extra objects.";

/** One extraction attempt that never throws: returns the envelope, or null if extract() threw (bad
 *  JSON / envelope schema). Lets the worker retry or skip a single chunk instead of failing the whole
 *  document on one chunk's malformed LLM output. */
async function safeExtract(
  deps: WorkerDeps,
  chunk: string,
  typeSpec: string,
  errors: string[] | undefined,
  existingEntities: ExistingEntity[] | undefined,
): Promise<ExtractResult | null> {
  try {
    return await deps.extract(chunk, typeSpec, errors, existingEntities);
  } catch {
    return null;
  }
}

// The required identity field per type. The model often puts the entity name only in the top-level
// `title`, leaving frontmatter empty, so we backfill it from the title before validating. (filing has
// no single required field, so it is omitted — it validates without a backfill.)
const PRIMARY_FIELD: Record<string, string> = {
  company: "name",
  person: "name",
  sector: "name",
  theme: "name",
  news: "headline",
  thesis: "statement",
  catalyst: "name",
  macro_factor: "name",
  risk: "name",
  product: "name",
  commodity: "name",
  organization: "name",
  signal: "name",
};

/** Build valid NodeRecords from an extraction envelope; collect per-note validation errors. */
function buildNodes(env: ExtractEnvelope): { nodes: NodeRecord[]; errors: string[] } {
  const taken = new Set<string>();
  const nodes: NodeRecord[] = [];
  const errors: string[] = [];
  for (const note of env.notes) {
    // `note` is a worker-only type — never accept one emitted by the extractor (defensive).
    if (note.type === "note") continue;
    if (!isNodeType(note.type)) {
      errors.push(`unknown type '${note.type}' for '${note.title}'`);
      continue;
    }
    const fm: Record<string, unknown> = { ...note.frontmatter };
    const primary = PRIMARY_FIELD[note.type];
    if (primary && !fm[primary] && note.title) fm[primary] = note.title;
    const v = validateNoteData(note.type, fm);
    if (!v.success) {
      errors.push(`${note.type} '${note.title}': ${v.error}`);
      continue;
    }
    const extracted: ExtractedNote = {
      type: note.type,
      id: note.id,
      title: note.title,
      data: v.data,
      body: note.body,
      tags: note.tags,
    };
    nodes.push(assemble(extracted, taken));
  }
  return { nodes, errors };
}

/** First ~80 chars of the summary (fallback: the raw text) on a word boundary, for the note title. */
function noteTitle(summary: string, rawText: string): string {
  const src = (summary || rawText).replace(/\s+/g, " ").trim();
  if (!src) return "Untitled note";
  if (src.length <= 80) return src;
  return `${src.slice(0, 80).replace(/\s+\S*$/, "")}…`;
}

// reason: UsageTotals is a plain numeric record (JSON-origin values), so the unknown->Json assertion
// is sound — mirrors upsert.ts's asJson (a single allowed assertion, not as-unknown-as).
const usageJson = (u: unknown): Json => u as Json;

async function setStatus(
  supabase: Client,
  id: string,
  status: "done" | "failed",
  error: string | null,
  usage?: UsageTotals,
): Promise<void> {
  const patch: Database["public"]["Tables"]["raw_uploads"]["Update"] = {
    status,
    error,
    processed_at: new Date().toISOString(),
  };
  if (usage) patch.usage = usageJson(usage);
  await supabase.from("raw_uploads").update(patch).eq("id", id);
}

/** Process a single raw_uploads row end-to-end. Always resolves (errors land in status='failed'). */
export async function processRawUpload(
  supabase: Client,
  id: string,
  deps: WorkerDeps,
): Promise<WorkerResult> {
  const { data: row } = await supabase.from("raw_uploads").select("*").eq("id", id).maybeSingle();
  if (!row) return { id, status: "failed", nodeIds: [], error: "raw_upload not found" };

  // Hoisted so a late failure still records the tokens already spent on the chunks that ran.
  let usageTotal: UsageTotals = EMPTY_USAGE;
  try {
    const rawText = row.raw_text;
    if (!rawText || !rawText.trim()) {
      throw new Error("no text to normalize (pdf/image vision extraction not yet configured)");
    }

    const typeSpec = buildTypeSpec();

    // Extract per chunk so long docs fit the model's context. Entities that recur across chunks share
    // a slug, so we merge them by id; chunk summaries/tags fold into the note node.
    const entitiesById = new Map<string, NodeRecord>();
    const summaries: string[] = [];
    const docTags: string[] = [];
    const relations: RawRelation[] = [];
    const corrections: RawCorrection[] = [];
    let docTitle = "";
    let chunksFailed = 0;
    for (const chunk of chunkText(rawText)) {
      // Graph-aware extraction: surface the nearest existing nodes as [[id]] link hints so a new doc
      // connects by semantics, not only by naming a slug. A hint only — dedupe/merge stays gated by
      // upsertNode, so a genuinely new entity is never merged just because a neighbor was shown.
      const existingEntities = deps.neighbors ? await deps.neighbors(chunk, row.graph_id) : undefined;

      // Attempt extraction. If the LLM output won't even parse, retry ONCE with a parse hint; if it
      // still fails, SKIP this chunk so one bad chunk can't fail the whole document.
      let res = await safeExtract(deps, chunk, typeSpec, undefined, existingEntities);
      if (!res) {
        res = await safeExtract(deps, chunk, typeSpec, [PARSE_RETRY_HINT], existingEntities);
        if (!res) {
          chunksFailed += 1;
          continue;
        }
      }
      if (res.usage) usageTotal = addChunkUsage(usageTotal, res.usage);
      // Per-note validation retry: the envelope parsed but some notes failed field validation.
      let built = buildNodes(res.envelope);
      if (built.errors.length > 0) {
        const retry = await safeExtract(deps, chunk, typeSpec, built.errors, existingEntities);
        if (retry) {
          if (retry.usage) usageTotal = addChunkUsage(usageTotal, retry.usage);
          res = retry;
          built = buildNodes(retry.envelope);
        }
      }
      const env = res.envelope;
      for (const node of built.nodes) {
        const existing = entitiesById.get(node.id);
        entitiesById.set(node.id, existing ? mergeNode(existing, node).merged : node);
      }
      if (env.docNote?.summary.trim()) summaries.push(env.docNote.summary.trim());
      if (env.docNote?.tags) docTags.push(...env.docNote.tags);
      if (!docTitle && env.docNote?.title?.trim()) docTitle = env.docNote.title.trim();
      if (env.relations) relations.push(...env.relations);
      if (env.corrections) corrections.push(...env.corrections);
    }
    const entities = [...entitiesById.values()];

    // The first-class note node for the whole document: full markdown body + combined summary/tags.
    const summary = summaries.join(" ");
    const note: NodeRecord = {
      id: noteIdFor(row.contributor, rawText),
      type: "note",
      title: docTitle || noteTitle(summary, rawText),
      status: "active",
      tags: normalizeTags(docTags),
      relatesTo: [],
      source: "upload",
      data: summary ? { body: rawText, summary } : { body: rawText },
    };

    // One embedding batch: note first, then entities (so embeddings[0] is the note).
    const embeddings = await deps.embed([embedText(note), ...entities.map(embedText)]);
    await insertNoteNode(supabase, note, embeddings[0] ?? [], row.contributor, row.graph_id);

    const resolved: Array<{ record: NodeRecord; id: string }> = [];
    for (let i = 0; i < entities.length; i += 1) {
      // supersede: a re-ingest from a NEWER source swaps stale narrative fields (living graph), snapshots
      // a revision, and re-embeds via the choke-point. The incoming embedding still drives the dedupe boost.
      const res = await upsertNode(supabase, entities[i], embeddings[i + 1] ?? [], row.contributor, row.graph_id, {
        supersede: true,
        sourceUploadId: row.id,
        embed: (t) => deps.embed([t]).then((r) => r[0] ?? []),
      });
      resolved.push({ record: entities[i], id: res.id });
    }
    // Structural edges (wikilinks) after every node exists (FK requires the target row).
    for (const { record, id: nid } of resolved) {
      await upsertEdges(supabase, nid, record, row.graph_id, row.id);
    }
    // Provenance: note --mentions--> each extracted entity (weak; never assertable).
    for (const { id: nid } of resolved) {
      await upsertEdge(supabase, note.id, nid, "mentions", row.graph_id, {
        relation_type: "mentions",
        method: "provenance",
        confidence: CONFIDENCE_WEAK,
        source_upload_id: row.id,
      });
    }
    // Grounded edges from the extractor's relations array — evidence-verified, the source of every
    // assertable fact. Runs after every node exists so subject/object ids resolve.
    await upsertRelations(supabase, relations, rawText, row.id, row.graph_id);

    // Fact reconciliation: apply the extractor's flagged corrections to permanent nodes (high-confidence
    // + verbatim-verified auto-apply via writeNodeData; mid-confidence queue for review). No extra LLM —
    // the corrections rode the extraction envelope. Runs after nodes exist so targets resolve.
    if (corrections.length > 0) {
      await applyCorrections(supabase, row.graph_id, corrections, rawText, row.id, (t) => deps.embed([t]).then((r) => r[0] ?? []));
    }

    // Ground each company's identity (ticker/cik/sector) in real market data when the LLM left it
    // blank — identity comes from FMP/Finnhub, not the model (the anti-fabrication grounding step).
    // Per-entity failure isolation: one lookup
    // throwing must not fail the doc. Private companies are skipped inside the enricher (no quote API).
    if (deps.enrichEntities) {
      for (const { record, id: nid } of resolved) {
        if (record.type !== "company") continue;
        try {
          await deps.enrichEntities(nid, row.graph_id, row.id);
        } catch (e) {
          reportError(e, { scope: "worker.enrichEntities", nodeId: nid });
        }
      }
    }

    await setStatus(supabase, id, "done", null, usageTotal);
    return { id, status: "done", nodeIds: resolved.map((r) => r.id), noteId: note.id, chunksFailed, usage: usageTotal };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await setStatus(supabase, id, "failed", error, usageTotal);
    return { id, status: "failed", nodeIds: [], usage: usageTotal, error };
  }
}
