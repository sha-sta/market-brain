"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActive, getCurrentGraphId } from "@/lib/auth";
import { writeNodeData, type NodePrior } from "@/server/normalize/upsert";
import { embedTexts } from "@/server/normalize/embed";
import type { NodeType } from "@/server/normalize/types";
import { reportError } from "@/lib/observability";

// Manual living-graph control: correct a fact, archive an outdated node, or restore one. Every write
// goes through the writeNodeData choke-point, so it snapshots the prior state into node_revisions
// (reversible/auditable) and re-embeds only when the embedded text actually changed. Active-user gated.

const embed = (t: string) => embedTexts([t]).then((r) => r[0] ?? []);

// Only these may be hand-edited. Server-side allowlist (never trust the client `field`): excludes
// identity/hard-key fields (ticker/cik/accession/url/name — editing them would corrupt dedupe) and
// internal sub-objects (_provenance, judge, market_provenance).
const EDITABLE_FIELDS = new Set([
  "title",
  "summary",
  "description",
  "statement",
  "body",
  "outcome",
  "current_reading",
  "mitigation",
  "transaction",
  "role",
]);

async function loadPrior(
  supabase: Awaited<ReturnType<typeof createClient>>,
  graphId: string,
  nodeId: string,
): Promise<NodePrior | null> {
  const { data } = await supabase
    .from("nodes")
    .select("type, title, status, data")
    .eq("graph_id", graphId)
    .eq("id", nodeId)
    .maybeSingle();
  if (!data) return null;
  return {
    type: data.type as NodeType,
    title: data.title,
    status: data.status,
    data: (data.data ?? {}) as Record<string, unknown>,
  };
}

/** Edit one node field (a `data.*` field, or the top-level `title`/`body`). Snapshots a revision and
 *  re-embeds if the change touches the embedded text. */
export async function editNodeField(formData: FormData): Promise<void> {
  const profile = await requireActive();
  void profile;
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const nodeId = String(formData.get("node_id") ?? "");
  const field = String(formData.get("field") ?? "").trim();
  const value = String(formData.get("value") ?? "");
  if (!nodeId || !EDITABLE_FIELDS.has(field)) return; // reject identity/internal fields outright
  if (value.length > 10_000) throw new Error("That edit is too long. Keep it under 10,000 characters.");

  const prior = await loadPrior(supabase, graphId, nodeId);
  if (!prior) throw new Error("Node not found.");

  try {
    const patch = field === "title" ? { title: value } : { data: { ...prior.data, [field]: value } };
    await writeNodeData(supabase, graphId, nodeId, patch, { embed, prior, reason: "manual", snapshot: true });
  } catch (e) {
    reportError(e, { scope: "editNodeField" });
    throw new Error("Couldn't save that edit. Please try again.");
  }
  revalidatePath(`/node/${nodeId}`);
}

/** Archive a node: hide it from the graph views + RAG + brief (recoverable; its edges are preserved). */
export async function archiveNode(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const nodeId = String(formData.get("node_id") ?? "");
  if (!nodeId) return;
  const prior = await loadPrior(supabase, graphId, nodeId);
  if (!prior) throw new Error("Node not found.");
  try {
    await writeNodeData(supabase, graphId, nodeId, { lifecycle: "archived" }, { prior, reason: "archive", snapshot: true });
  } catch (e) {
    reportError(e, { scope: "archiveNode" });
    throw new Error("Couldn't archive. Please try again.");
  }
  revalidatePath(`/node/${nodeId}`);
}

/** Restore an archived/stale node back to active. */
export async function restoreNode(formData: FormData): Promise<void> {
  await requireActive();
  const graphId = await getCurrentGraphId();
  const supabase = await createClient();
  const nodeId = String(formData.get("node_id") ?? "");
  if (!nodeId) return;
  const prior = await loadPrior(supabase, graphId, nodeId);
  if (!prior) return;
  const { error } = await supabase
    .from("nodes")
    .update({ lifecycle: "active" })
    .eq("graph_id", graphId)
    .eq("id", nodeId);
  if (error) {
    reportError(error, { scope: "restoreNode" });
    throw new Error("Couldn't restore. Please try again.");
  }
  revalidatePath(`/node/${nodeId}`);
  revalidatePath("/archived"); // refresh the archived-browse list after a restore
}
