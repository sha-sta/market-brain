// The thesis-judge prompt + output schema. Pure + unit-tested. The judge STRESS-TESTS one thesis
// against the evidence subgraph — skeptical by default, never agreeable. Output is strict JSON we
// validate leniently (bad array items are dropped, not fatal) then ground (every cited quote is
// verified verbatim against the evidence) before any edge is asserted.

import { z } from "zod";
import { STRENGTH_LABELS, STRENGTH_RUBRIC, type Strength } from "./calibration";

export interface EvidenceItem {
  id: string;
  type: string;
  title: string;
  snippet: string;
  publishedAt?: string | null;
  sentiment?: string | null;
  materiality?: string | null;
}

export interface JudgeInput {
  thesis: { id: string; statement: string; about: string[] };
  evidence: EvidenceItem[];
}

/** Drop malformed items instead of failing the whole array (the LLM occasionally fumbles one); a
 *  missing key or non-array value coerces to []. Pure. */
function lenientArray<T>(item: z.ZodType<T>): z.ZodType<T[]> {
  return z.unknown().optional().transform((v) => {
    const arr = Array.isArray(v) ? v : [];
    const out: T[] = [];
    for (const x of arr) {
      const r = item.safeParse(x);
      if (r.success) out.push(r.data);
    }
    return out;
  });
}

const evidenceRef = z.object({
  evidence_id: z.string(),
  quote: z.string().default(""),
  why: z.string().default(""),
});

const edgeClaim = z.object({
  evidence_id: z.string(),
  relation: z.enum(["confirms_thesis", "challenges_thesis"]),
  quote: z.string().default(""),
  confidence: z.coerce.number().min(0).max(1).catch(0.6),
});

export const judgeOutputSchema = z.object({
  strength: z.string().default("weak"),
  rationale: z.string().default(""),
  bear_case: z.string().default(""),
  disconfirming: lenientArray(evidenceRef),
  confirming: lenientArray(evidenceRef),
  thin_reasoning_flags: lenientArray(z.string()),
  edges: lenientArray(edgeClaim),
});

export type JudgeOutput = z.infer<typeof judgeOutputSchema>;
export type EdgeClaim = z.infer<typeof edgeClaim>;

const RUBRIC_BLOCK = STRENGTH_LABELS.map((l: Strength) => `  - ${l}: ${STRENGTH_RUBRIC[l]}`).join("\n");

export const JUDGE_SYSTEM = `You are the strict critic for a personal stock-research knowledge graph. Your job is to STRESS-TEST one investment thesis against the evidence in the graph — not to agree with it. You are skeptical by default and you NEVER soften a judgment to be agreeable. You output STRICT JSON only — no prose, no markdown fences.

Hard rules:
- Use ONLY the evidence items provided. Never invent a company, number, date, filing, or quote. Every "quote" you output MUST be copied VERBATIM from the "snippet" of the evidence item you cite (it is checked by exact substring match; a paraphrase is discarded).
- Cite evidence ONLY by the "id" of an item in the provided list. An id not in the list is a fabrication and will be rejected.
- You are NOT an advisor. NEVER output buy/sell/hold language, price targets, position sizing, or a recommendation. You assess only how well the EVIDENCE supports the CLAIM.
- "bear_case" is MANDATORY and non-empty: the single strongest argument that this thesis is WRONG, stated plainly, even when the thesis looks strong. If you find no disconfirming evidence in the graph, say so explicitly and treat the thesis as LESS proven, not more.
- Enumerate EVERY disconfirming item you can find in "disconfirming". Do not bury them.
- Calibrate "strength" strictly using this rubric (when in doubt, choose the LOWER label):
${RUBRIC_BLOCK}
  The user's own assertion is NOT evidence. A thesis with no confirming evidence is "unsupported".
- Flag thin reasoning in "thin_reasoning_flags": single-source, stale evidence, opinion-vs-primary-filing, correlation-as-causation, recency bias.
- Final self-check before emitting: if "strength" is "supported" or "well-supported", confirm you listed at least two independent confirming items AND addressed the bear_case; if not, lower it. If "bear_case" is empty or hedged, rewrite it as a real, specific objection.

For "edges", list the evidence->thesis links to assert: relation "confirms_thesis" or "challenges_thesis", the verbatim "quote", and a calibrated "confidence" (0..1).`;

export function buildJudgePrompt(input: JudgeInput): string {
  const evidence = input.evidence.length
    ? input.evidence
        .map(
          (e) =>
            `- id:${e.id} [${e.type}${e.publishedAt ? `, ${e.publishedAt}` : ""}${e.sentiment ? `, ${e.sentiment}` : ""}] ${e.title}\n  snippet: ${e.snippet}`,
        )
        .join("\n")
    : "(no evidence found in the graph for this thesis)";

  return `THESIS (id:${input.thesis.id}): ${input.thesis.statement}
About: ${input.thesis.about.join(", ") || "(unspecified)"}

EVIDENCE (cite only these ids; quote verbatim from each snippet):
${evidence}

Return JSON in exactly this shape:
{"strength":"<label>","rationale":"...","bear_case":"...","disconfirming":[{"evidence_id":"...","quote":"...","why":"..."}],"confirming":[{"evidence_id":"...","quote":"...","why":"..."}],"thin_reasoning_flags":["..."],"edges":[{"evidence_id":"...","relation":"confirms_thesis|challenges_thesis","quote":"...","confidence":0.0}]}`;
}
