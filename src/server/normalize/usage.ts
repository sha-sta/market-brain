// Token-usage accounting for extraction (#9). Pure + dependency-free so it's unit-tested and reused
// by the manual cost eval (scripts/eval-extraction.ts). No `server-only` import — callable anywhere.
import { HAIKU, SONNET } from "./model";

/** Normalized per-call token usage. `inputTokens` is the TOTAL prompt tokens; of those,
 *  `cachedInputTokens` were cache reads (cheap) and `cacheWriteTokens` were written into the cache
 *  (pricier than normal input). The remainder is billed at the full input rate. */
export interface ExtractUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  model: string;
}

/** Per-document running total: summed tokens + accumulated dollar cost (cost is summed per chunk so a
 *  doc that mixes Haiku and Sonnet chunks is priced correctly). */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export const EMPTY_USAGE: UsageTotals = Object.freeze({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 });

// The subset of an `ai` generateText result we read — typed loosely so we don't couple to the exact
// AI SDK version's surface (and never need an `any`). v6 exposes cache read/write in inputTokenDetails;
// older shapes / providerMetadata are kept as fallbacks.
interface GenResultUsageLike {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number; // deprecated alias for inputTokenDetails.cacheReadTokens
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  };
  providerMetadata?: { anthropic?: { cacheReadInputTokens?: number; cacheCreationInputTokens?: number } };
}

const n = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Pull usage out of an `ai` generateText result. Cache reads/writes come from `usage.inputTokenDetails`
 *  when present, with the deprecated alias + Anthropic providerMetadata as fallbacks. Missing -> 0. */
export function extractUsage(result: GenResultUsageLike, model: string): ExtractUsage {
  const details = result.usage?.inputTokenDetails;
  const cacheRead =
    details?.cacheReadTokens ?? result.usage?.cachedInputTokens ?? result.providerMetadata?.anthropic?.cacheReadInputTokens;
  const cacheWrite = details?.cacheWriteTokens ?? result.providerMetadata?.anthropic?.cacheCreationInputTokens;
  return {
    inputTokens: n(result.usage?.inputTokens),
    outputTokens: n(result.usage?.outputTokens),
    cachedInputTokens: n(cacheRead),
    cacheWriteTokens: n(cacheWrite),
    model,
  };
}

// Approximate USD per 1M tokens. Cache READS are ~1/10th of input; cache WRITES are ~1.25x input
// (Anthropic). EDIT THESE if pricing changes — they only affect the cost ESTIMATE, never behavior.
interface Rate {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}
const PRICING: Record<string, Rate> = {
  [HAIKU]: { input: 1.0, cached: 0.1, cacheWrite: 1.25, output: 5.0 },
  [SONNET]: { input: 3.0, cached: 0.3, cacheWrite: 3.75, output: 15.0 },
  // OpenAI (via the gateway) for the model eval (scripts/eval-extraction.ts) — approximate per-1M USD.
  // OpenAI prompt caching isn't engaged here (the Anthropic cacheControl breakpoint is a no-op for
  // them), so cached/cacheWrite tokens stay 0; their rates are set to the input rate for safety.
  "openai/gpt-4o-mini": { input: 0.15, cached: 0.075, cacheWrite: 0.15, output: 0.6 },
  "openai/gpt-4o": { input: 2.5, cached: 1.25, cacheWrite: 2.5, output: 10.0 },
  "openai/gpt-4.1-mini": { input: 0.4, cached: 0.1, cacheWrite: 0.4, output: 1.6 },
};
const FALLBACK: Rate = PRICING[SONNET]; // unknown model -> price conservatively (the dearer rate)

/** Estimate the dollar cost of one extraction call. Cache reads bill at the read rate, cache writes at
 *  the write rate, and the remaining (uncached, unwritten) input at the full rate. */
export function estimateCost(u: ExtractUsage): number {
  const rate = PRICING[u.model] ?? FALLBACK;
  const plainInput = Math.max(0, u.inputTokens - u.cachedInputTokens - u.cacheWriteTokens);
  return (
    (plainInput * rate.input +
      u.cachedInputTokens * rate.cached +
      u.cacheWriteTokens * rate.cacheWrite +
      u.outputTokens * rate.output) /
    1_000_000
  );
}

/** Fold one chunk's usage into a per-document running total (cost computed per chunk, then summed). */
export function addChunkUsage(total: UsageTotals, u: ExtractUsage): UsageTotals {
  return {
    inputTokens: total.inputTokens + u.inputTokens,
    outputTokens: total.outputTokens + u.outputTokens,
    cachedInputTokens: total.cachedInputTokens + u.cachedInputTokens,
    costUsd: total.costUsd + estimateCost(u),
  };
}
