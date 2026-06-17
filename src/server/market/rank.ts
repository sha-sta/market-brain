// Pure ranking for news/research items surfaced in the cron + morning brief. Capping items by this
// score BEFORE the LLM keeps brief latency/cost bounded. Score blends relevance to the user's holdings
// (semantic similarity), recency (exponential decay), and the article's materiality. No IO — unit-tested.

export interface Rankable {
  semanticSim?: number | null; // 0..1 cosine similarity to the nearest tracked holding (match_nodes)
  publishedAt?: string | null; // ISO timestamp
  materiality?: string | null; // "high" | "med" | "low"
}

const W_REL = 0.5;
const W_REC = 0.3;
const W_MAT = 0.2;
const HALF_LIFE_HOURS = 24; // a day-old story is worth half a fresh one

/** Clamp to [0,1]. */
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Exponential recency decay in [0,1]: 1 at now, 0.5 at one half-life, →0 as it ages. A missing/invalid
 *  date is treated as neutral-old (0.3) rather than 0 so undated items aren't buried entirely. */
export function recencyDecay(publishedAt: string | null | undefined, nowMs: number): number {
  if (!publishedAt) return 0.3;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 0.3;
  const hours = Math.max(0, (nowMs - t) / 3_600_000);
  return clamp01(Math.pow(2, -hours / HALF_LIFE_HOURS));
}

/** Map materiality to [0,1]; unknown -> mid. */
export function materialityScore(m: string | null | undefined): number {
  switch ((m ?? "").toLowerCase()) {
    case "high":
      return 1;
    case "med":
    case "medium":
      return 0.5;
    case "low":
      return 0.2;
    default:
      return 0.4;
  }
}

/** Combined 0..1 score for one item. */
export function scoreItem(item: Rankable, nowMs: number): number {
  const rel = clamp01(item.semanticSim ?? 0);
  const rec = recencyDecay(item.publishedAt, nowMs);
  const mat = materialityScore(item.materiality);
  return W_REL * rel + W_REC * rec + W_MAT * mat;
}

/** Sort items by score descending (stable for equal scores). Returns a new array. */
export function rankItems<T extends Rankable>(items: readonly T[], nowMs: number): T[] {
  return items
    .map((item, i) => ({ item, i, s: scoreItem(item, nowMs) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
