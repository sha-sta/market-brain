import { describe, it, expect } from "vitest";
import { materialityScore, rankItems, recencyDecay, scoreItem } from "@/server/market/rank";

const NOW = Date.parse("2026-06-17T12:00:00Z");

describe("recencyDecay", () => {
  it("is 1 at now, ~0.5 one half-life (24h) ago, 0.3 when undated", () => {
    expect(recencyDecay("2026-06-17T12:00:00Z", NOW)).toBeCloseTo(1, 5);
    expect(recencyDecay("2026-06-16T12:00:00Z", NOW)).toBeCloseTo(0.5, 5);
    expect(recencyDecay(null, NOW)).toBe(0.3);
    expect(recencyDecay("not a date", NOW)).toBe(0.3);
  });
});

describe("materialityScore", () => {
  it("maps high/med/low and defaults the unknown", () => {
    expect(materialityScore("high")).toBe(1);
    expect(materialityScore("med")).toBe(0.5);
    expect(materialityScore("low")).toBe(0.2);
    expect(materialityScore(null)).toBe(0.4);
  });
});

describe("rankItems", () => {
  it("ranks a relevant, fresh, material item above a stale, irrelevant one", () => {
    const hot = { semanticSim: 0.9, publishedAt: "2026-06-17T11:00:00Z", materiality: "high" };
    const cold = { semanticSim: 0.1, publishedAt: "2026-05-01T00:00:00Z", materiality: "low" };
    const [first] = rankItems([cold, hot], NOW);
    expect(first).toBe(hot);
    expect(scoreItem(hot, NOW)).toBeGreaterThan(scoreItem(cold, NOW));
  });

  it("is stable for equal scores (preserves input order)", () => {
    const a = { semanticSim: 0.5, publishedAt: "2026-06-17T12:00:00Z", materiality: "med" };
    const b = { semanticSim: 0.5, publishedAt: "2026-06-17T12:00:00Z", materiality: "med" };
    const ranked = rankItems([a, b], NOW);
    expect(ranked[0]).toBe(a);
    expect(ranked[1]).toBe(b);
  });
});
