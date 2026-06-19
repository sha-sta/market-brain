import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { writeNodeData, type NodePrior } from "./upsert";
import { verifyEvidence } from "./relations";
import { planCorrection, isCorrectableField } from "./reconcile-rules";
import type { RawCorrection } from "./extract-schema";
import type { NodeType } from "./types";
import { reportError } from "@/lib/observability";

// Cross-node fact correction: apply the extractor's flagged changes to PERMANENT nodes. High-confidence
// + evidence-verified changes apply through writeNodeData (snapshots a reversible revision); mid-
// confidence ones queue for review; unverified/low ones drop. Zero added LLM cost — corrections ride the
// extraction envelope the worker already produced. Identity fields are never overwritten (a rename
// appends former_name/aliases instead); a role change can also expire the stale insider_of edge.

type Client = SupabaseClient<Database>;

// Only permanent/structural entities are corrected in place — news/notes/etc. decay instead.
const PERMANENT_TYPES = new Set(["company", "person", "product", "organization", "sector"]);

export interface ReconcileResult {
  applied: number;
  queued: number;
  skipped: number;
}

export async function applyCorrections(
  supabase: Client,
  graphId: string,
  corrections: RawCorrection[],
  sourceText: string,
  sourceUploadId: string | null,
  embed: (text: string) => Promise<number[]>,
): Promise<ReconcileResult> {
  let applied = 0;
  let queued = 0;
  let skipped = 0;

  for (const c of corrections) {
    const targetId = String(c.target).replace(/^\[\[|\]\]$/g, "").trim();
    if (!targetId || !c.new) {
      skipped += 1;
      continue;
    }
    const { data: row } = await supabase
      .from("nodes")
      .select("type, title, status, data")
      .eq("graph_id", graphId)
      .eq("id", targetId)
      .maybeSingle();
    if (!row || !PERMANENT_TYPES.has(row.type)) {
      skipped += 1; // unknown target, or a non-permanent type (those decay, not corrected)
      continue;
    }

    const verified = verifyEvidence(c.evidence, sourceText);
    const action = planCorrection(c.confidence, verified);
    if (action === "skip") {
      skipped += 1;
      continue;
    }
    if (action === "queue") {
      const { error } = await supabase.from("correction_queue").insert({
        graph_id: graphId,
        node_id: targetId,
        field: c.field,
        old_value: c.old || null,
        new_value: c.new,
        evidence: c.evidence || null,
        confidence: c.confidence,
        kind: c.kind,
        source_upload_id: sourceUploadId,
      });
      if (error) reportError(error, { scope: "applyCorrections.queue", targetId });
      queued += 1;
      continue;
    }

    const prior: NodePrior = {
      type: row.type as NodeType,
      title: row.title,
      status: row.status,
      data: (row.data ?? {}) as Record<string, unknown>,
    };
    if (await applyOne(supabase, graphId, targetId, c, prior, sourceUploadId, embed)) applied += 1;
    else skipped += 1;
  }

  return { applied, queued, skipped };
}

async function applyOne(
  supabase: Client,
  graphId: string,
  targetId: string,
  c: RawCorrection,
  prior: NodePrior,
  sourceUploadId: string | null,
  embed: (text: string) => Promise<number[]>,
): Promise<boolean> {
  const opts = { embed, prior, reason: "fact-correction" as const, sourceUploadId, snapshot: true };
  try {
    if (c.kind === "rename") {
      // A rename NEVER overwrites `name` (the dedupe hard-key) — append the old name as provenance so
      // future articles using the old name still match, and the node keeps its canonical identity.
      const oldName = c.old || (typeof prior.data.name === "string" ? prior.data.name : "");
      if (!oldName) return false;
      const aliases = Array.isArray(prior.data.aliases) ? prior.data.aliases.map(String) : [];
      if (!aliases.includes(oldName)) aliases.push(oldName);
      await writeNodeData(supabase, graphId, targetId, { data: { ...prior.data, former_name: oldName, aliases } }, opts);
      return true;
    }
    if (c.kind === "relation_expiry") {
      // Role/relationship ended (CEO -> ex-CEO): update the narrative role AND retire the now-false
      // insider_of edge (edges have no lifecycle column, so "expire" = delete) so it stops asserting.
      const field = isCorrectableField(c.field) ? c.field : "role";
      await writeNodeData(supabase, graphId, targetId, { data: { ...prior.data, [field]: c.new } }, opts);
      await supabase.from("edges").delete().eq("graph_id", graphId).eq("src_id", targetId).eq("relation_type", "insider_of");
      return true;
    }
    // value: overwrite a single narrative field in place.
    if (!isCorrectableField(c.field)) return false; // identity/unknown field -> never auto-corrected
    await writeNodeData(supabase, graphId, targetId, { data: { ...prior.data, [c.field]: c.new } }, opts);
    return true;
  } catch (e) {
    reportError(e, { scope: "applyCorrections.applyOne", targetId });
    return false;
  }
}
