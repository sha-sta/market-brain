// Extraction model selection. Vercel AI Gateway model IDs use DOTS.
//
// MarketBrain extracts with SONNET for every chunk: the volume is tiny (~15 entities/day) and the
// stakes are higher than research notes — a fabricated ticker mis-merges companies — so the small
// per-call cost of the stronger model is worth it. HAIKU is retained only for the usage price map
// (usage.ts) and as the documented cheaper tier. (Requires AI_GATEWAY_API_KEY with PAID credits —
// the free tier blocks the latest Claude.)

export const HAIKU = "anthropic/claude-haiku-4.5";
export const SONNET = "anthropic/claude-sonnet-4.6";

/** Inputs longer than this would have escalated a haiku-first pipeline; kept for reference. */
export const ESCALATE_CHARS = 4000;

/**
 * Pick the extraction model. MarketBrain always uses SONNET (quality over cost at this volume); the
 * args are kept so the worker/extractor call sites stay identical to the upstream pipeline.
 */
export function pickModel(_inputLength: number, _isRetry: boolean): string {
  return SONNET;
}
