// Model selection + tiering. Vercel AI Gateway model IDs use DOTS.
//
// Lean cost posture: HAIKU does the high-volume grunt work (extraction, classification, gap-finding);
// SONNET is reserved for judgment (thesis critic, connection synthesis, brief intro). Extraction is
// Haiku-FIRST but ESCALATES to Sonnet on a validation retry or an unusually large chunk, where a
// mis-extracted ticker is likelier and the stronger model earns its cost. enrichEntities also grounds
// tickers/CIKs from real market data regardless of model, so a Haiku slip is corrected downstream.
// (Requires AI_GATEWAY_API_KEY with PAID credits — the free tier blocks the latest Claude.)

export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.6";

/** A chunk longer than this escalates extraction to Sonnet on the first attempt. Deliberately half of
 *  chunkText's `maxChars` (8000, see chunk.ts): news items (~200-700 chars) stay on Haiku, while the
 *  upper half of a research-doc chunk goes straight to Sonnet. Keep these two in proportion. */
export const ESCALATE_CHARS = 4000;

/** The kinds of LLM work in the system, each routed to a tier. */
export type Task = "extract" | "classify" | "gapfind" | "synthesis" | "critic" | "briefIntro";

export interface ModelTier {
  extract: string;
  classify: string;
  gapfind: string;
  synthesis: string;
  critic: string;
  briefIntro: string;
}

/** Grunt work -> Haiku; judgment -> Sonnet. */
export const DEFAULT_TIER: ModelTier = Object.freeze({
  extract: HAIKU,
  classify: HAIKU,
  gapfind: HAIKU,
  synthesis: SONNET,
  critic: SONNET,
  briefIntro: SONNET,
});

/** Resolve the model for a task; pass a custom tier to override (e.g. an all-Haiku cheap dry run). */
export function modelFor(task: Task, tier: ModelTier = DEFAULT_TIER): string {
  return tier[task];
}

/**
 * Pick the extraction model: Haiku-first, escalating to Sonnet on a validation retry or a large chunk.
 * Signature kept so the worker/extractor call sites stay identical to the upstream pipeline.
 */
export function pickModel(inputLength: number, isRetry: boolean): string {
  if (isRetry || inputLength > ESCALATE_CHARS) return SONNET;
  return modelFor("extract");
}
