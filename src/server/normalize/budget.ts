// Cost ceilings + a running cost meter. Pure + dependency-light so it's unit-tested and reused by the
// daily engine (per-run / per-day caps) and the research-job processor (per-job cap). The meter folds
// extraction token usage (priced via usage.ts) and raw dollar amounts (e.g. a web-search API call) into
// one total; `check(cap)` throws once the cap is reached so callers can skip remaining LLM work and
// still finish the cheap, deterministic parts (e.g. always send the template brief).
import { type ExtractUsage, type UsageTotals, EMPTY_USAGE, addChunkUsage } from "./usage";

/** The $60/mo budget, expressed as hard per-scope ceilings. EDIT THESE to retune spend. */
export interface CostCeilings {
  perRunUsd: number; // one daily-engine run for one graph
  perDayUsd: number; // all engine runs + research jobs for one ET day
  perJobUsd: number; // one interactive research job
}

export const DEFAULT_CEILINGS: CostCeilings = Object.freeze({ perRunUsd: 0.5, perDayUsd: 2, perJobUsd: 0.25 });

/** Thrown by CostMeter.check() when accumulated cost has reached/exceeded a cap. */
export class BudgetExceeded extends Error {
  constructor(
    readonly cap: number,
    readonly spent: number,
  ) {
    super(`budget exceeded: spent $${spent.toFixed(4)} >= cap $${cap.toFixed(4)}`);
    this.name = "BudgetExceeded";
  }
}

/** Accumulates the dollar cost of a unit of work (a run, a job). Never mutates the frozen EMPTY_USAGE. */
export class CostMeter {
  private totals: UsageTotals = EMPTY_USAGE;

  /** Fold one priced LLM call's token usage into the running total. */
  add(u: ExtractUsage): UsageTotals {
    this.totals = addChunkUsage(this.totals, u);
    return this.totals;
  }

  /** Add a raw dollar amount (a non-token cost, e.g. a web-search API call). Negatives are ignored. */
  addUsd(usd: number): void {
    this.totals = { ...this.totals, costUsd: this.totals.costUsd + Math.max(0, usd) };
  }

  spent(): number {
    return this.totals.costUsd;
  }

  usage(): UsageTotals {
    return this.totals;
  }

  /** Throw if accumulated cost has reached/exceeded the cap. Call BEFORE an expensive step. */
  check(cap: number): void {
    if (this.totals.costUsd >= cap) throw new BudgetExceeded(cap, this.totals.costUsd);
  }

  remaining(cap: number): number {
    return Math.max(0, cap - this.totals.costUsd);
  }
}
