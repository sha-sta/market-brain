import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { verifyEvidence } from "@/server/normalize/relations";
import { upsertEdge } from "@/server/normalize/upsert";
import { reportError } from "@/lib/observability";
import { normalizeStrength, enforceFloor } from "./calibration";
import { gatherThesisEvidence } from "./subgraph";
import type { JudgeInput, JudgeOutput } from "./thesis-prompt";

// The strict thesis-judge: gather the evidence subgraph -> ask the (injected) judge -> GROUND it (drop
// any edge whose quote isn't verbatim in the cited evidence, or cites a hallucinated id) -> enforceFloor
// on the VERIFIED counts so the model can't inflate -> persist confirms/challenges edges (WEAK, never
// assertable) + the verdict onto the thesis node. Injected `judge` => integration-tested with a stub.

type Client = SupabaseClient<Database>;
const asJson = (v: unknown): Json => v as Json;

export type Judge = (input: JudgeInput) => Promise<JudgeOutput>;
export interface JudgeDeps {
  judge: Judge;
  nowMs?: number;
}

export interface JudgeResult {
  thesisId: string;
  strength: string;
  confirming: number;
  challenging: number;
  edgesWritten: number;
}

function thesisStatus(strength: string): string {
  if (strength === "well-supported" || strength === "supported") return "confirmed";
  // Anything below "supported" did NOT meet the strict bar -> "challenged" (incl. "unsupported", so a
  // judged-but-baseless thesis never looks identical to an unjudged one). The precise reason + counts
  // live in data.judge; last_judged_at marks that it was judged at all.
  return "challenged";
}

export async function judgeThesis(
  supabase: Client,
  graphId: string,
  thesis: { id: string; data: Record<string, unknown> },
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const { input, evidenceById } = await gatherThesisEvidence(supabase, graphId, thesis);
  const out = await deps.judge(input);

  // Ground every claimed edge: it must cite a real evidence id AND quote it verbatim. Survivors only.
  let confirming = 0;
  let challenging = 0;
  let edgesWritten = 0;
  for (const edge of out.edges) {
    const snippet = evidenceById.get(edge.evidence_id);
    if (!snippet) continue; // hallucinated id
    if (!verifyEvidence(edge.quote, snippet)) continue; // paraphrase / fabricated quote
    await upsertEdge(supabase, edge.evidence_id, thesis.id, edge.relation, graphId, {
      relation_type: edge.relation, // confirms_thesis / challenges_thesis — both WEAK, never assertable
      method: "thesis_judge",
      confidence: edge.confidence,
      evidence_quote: edge.quote,
    });
    edgesWritten += 1;
    if (edge.relation === "confirms_thesis") confirming += 1;
    else challenging += 1;
  }

  // The model cannot rate higher than the VERIFIED evidence justifies.
  const strength = enforceFloor(normalizeStrength(out.strength), confirming, challenging);
  const bearCase = out.bear_case.trim() || "No disconfirming evidence found in the graph; treat as unproven, not strong.";
  const nowIso = new Date(deps.nowMs ?? Date.now()).toISOString();

  const newData: Record<string, unknown> = {
    ...thesis.data,
    judge: {
      strength,
      rationale: out.rationale,
      bear_case: bearCase,
      disconfirming: out.disconfirming,
      confirming: out.confirming,
      thin_reasoning_flags: out.thin_reasoning_flags,
      confirming_count: confirming,
      challenging_count: challenging,
      judged_at: nowIso,
    },
  };
  // Direct update: data.judge doesn't change the embedded text (the thesis `statement`), so no re-embed;
  // it's analysis added to the node, not a supersede, so no revision snapshot.
  const { error } = await supabase
    .from("nodes")
    .update({ data: asJson(newData), status: thesisStatus(strength), last_judged_at: nowIso })
    .eq("graph_id", graphId)
    .eq("id", thesis.id);
  if (error) throw new Error(`thesis verdict write failed: ${error.message}`);

  return { thesisId: thesis.id, strength, confirming, challenging, edgesWritten };
}

/** Re-judge up to `max` theses, oldest-judged first (bounded daily Sonnet cost). Per-thesis isolation. */
export async function judgeTheses(supabase: Client, graphId: string, deps: JudgeDeps, opts: { max?: number } = {}): Promise<JudgeResult[]> {
  const max = opts.max ?? 5;
  const { data: theses } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("graph_id", graphId)
    .eq("type", "thesis")
    .in("lifecycle", ["active", "stale"])
    .order("last_judged_at", { ascending: true, nullsFirst: true })
    .limit(max);

  const results: JudgeResult[] = [];
  for (const t of theses ?? []) {
    try {
      results.push(await judgeThesis(supabase, graphId, { id: t.id, data: (t.data ?? {}) as Record<string, unknown> }, deps));
    } catch (e) {
      reportError(e, { scope: "judgeTheses", thesisId: t.id });
    }
  }
  return results;
}
