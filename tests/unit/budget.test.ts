import { describe, it, expect } from "vitest";
import { CostMeter, BudgetExceeded, DEFAULT_CEILINGS } from "@/server/normalize/budget";
import { SONNET } from "@/server/normalize/model";

describe("CostMeter", () => {
  it("accumulates token usage into a running dollar total", () => {
    const m = new CostMeter();
    m.add({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, model: SONNET });
    expect(m.spent()).toBeCloseTo(3.0, 5); // $3 / 1M input for Sonnet
    m.add({ inputTokens: 0, outputTokens: 1_000_000, cachedInputTokens: 0, cacheWriteTokens: 0, model: SONNET });
    expect(m.spent()).toBeCloseTo(18.0, 5); // + $15 / 1M output
  });

  it("adds a raw dollar amount (e.g. web-search cost) and ignores negatives", () => {
    const m = new CostMeter();
    m.addUsd(0.1);
    m.addUsd(-5);
    expect(m.spent()).toBeCloseTo(0.1, 5);
  });

  it("check() throws BudgetExceeded once the cap is reached, not before", () => {
    const over = new CostMeter();
    over.addUsd(0.5);
    expect(() => over.check(0.5)).toThrow(BudgetExceeded);

    const under = new CostMeter();
    under.addUsd(0.4);
    expect(() => under.check(0.5)).not.toThrow();
  });

  it("remaining() never goes negative", () => {
    const m = new CostMeter();
    m.addUsd(0.9);
    expect(m.remaining(0.5)).toBe(0);
    expect(m.remaining(2)).toBeCloseTo(1.1, 5);
  });

  it("exposes the $60/mo default ceilings", () => {
    expect(DEFAULT_CEILINGS.perRunUsd).toBe(0.5);
    expect(DEFAULT_CEILINGS.perDayUsd).toBe(2);
    expect(DEFAULT_CEILINGS.perJobUsd).toBe(0.25);
  });
});
