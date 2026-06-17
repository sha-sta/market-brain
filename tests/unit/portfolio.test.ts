import { describe, it, expect } from "vitest";
import { allocation, computePnL, type Position, type PositionValue } from "@/lib/portfolio";

const pub = (over: Partial<Position> = {}): Position => ({
  id: "p1",
  nodeId: "nvidia",
  title: "NVIDIA",
  ticker: "NVDA",
  isPublic: true,
  isWatchlist: false,
  shares: 10,
  costBasis: 100,
  manualValue: null,
  account: null,
  notes: null,
  ...over,
});

describe("computePnL", () => {
  it("values a public holding off price × shares with P&L vs cost basis", () => {
    const v = computePnL(pub(), { price: 150, changePct: 2 });
    expect(v.marketValue).toBe(1500);
    expect(v.costValue).toBe(1000);
    expect(v.unrealizedPnL).toBe(500);
    expect(v.unrealizedPct).toBeCloseTo(50, 5);
    expect(v.dayChangePct).toBe(2);
  });

  it("degrades to null market value when there's no price (never 0)", () => {
    const v = computePnL(pub(), undefined);
    expect(v.marketValue).toBeNull();
    expect(v.unrealizedPnL).toBeNull();
  });

  it("values a private company off manual_value with no P&L (no market price)", () => {
    const v = computePnL(
      pub({ nodeId: "anthropic", title: "Anthropic", ticker: null, isPublic: false, shares: null, costBasis: null, manualValue: 50000 }),
      undefined,
    );
    expect(v.marketValue).toBe(50000);
    expect(v.unrealizedPnL).toBeNull();
    expect(v.costValue).toBeNull();
  });
});

describe("allocation", () => {
  it("computes weights (desc) and top concentration", () => {
    const values: PositionValue[] = [
      { id: "1", nodeId: "a", title: "A", ticker: null, isPublic: true, marketValue: 750, costValue: null, unrealizedPnL: null, unrealizedPct: null, dayChangePct: null },
      { id: "2", nodeId: "b", title: "B", ticker: null, isPublic: true, marketValue: 250, costValue: null, unrealizedPnL: null, unrealizedPct: null, dayChangePct: null },
    ];
    const a = allocation(values);
    expect(a.total).toBe(1000);
    expect(a.weights[0]).toEqual({ nodeId: "a", title: "A", weight: 0.75 });
    expect(a.topConcentration).toBe(0.75);
    expect(a.weights.reduce((s, w) => s + w.weight, 0)).toBeCloseTo(1, 5);
  });

  it("handles an all-empty portfolio", () => {
    expect(allocation([]).total).toBe(0);
    expect(allocation([]).topConcentration).toBe(0);
  });
});
