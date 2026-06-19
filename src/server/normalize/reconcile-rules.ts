// Pure rules for fact reconciliation (no IO, no server-only) so they unit-test in isolation. The IO
// that resolves the target node and writes the correction lives in reconcile.ts.

import { NARRATIVE_FIELDS, IDENTITY_FIELDS } from "./lifecycle";

// Auto-applying a correction OVERWRITES a stored value on a core entity, so the bar is deliberately
// higher than asserting a new edge (ASSERTABLE_CONFIDENCE = 0.8): only >= 0.85 + verified auto-applies.
// 0.6–0.85 queues for human review; below 0.6 is dropped as noise.
export const AUTO_APPLY_CONFIDENCE = 0.85;
export const QUEUE_CONFIDENCE = 0.6;

export type CorrectionAction = "apply" | "queue" | "skip";

/** What to do with a flagged correction, by confidence + whether its evidence verified verbatim. An
 *  unverified correction is ALWAYS skipped (no apply, no queue) — we never act on a paraphrase. Pure. */
export function planCorrection(confidence: number, verified: boolean): CorrectionAction {
  if (!verified) return "skip";
  if (confidence >= AUTO_APPLY_CONFIDENCE) return "apply";
  if (confidence >= QUEUE_CONFIDENCE) return "queue";
  return "skip";
}

/** A `value` correction may only touch a narrative field; identity/hard-key fields (ticker/cik/name…)
 *  are NEVER corrected this way — a rename routes to the alias path instead. Pure. */
export function isCorrectableField(field: string): boolean {
  return NARRATIVE_FIELDS.has(field) && !IDENTITY_FIELDS.has(field);
}
