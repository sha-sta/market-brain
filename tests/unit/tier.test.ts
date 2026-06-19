import { describe, it, expect } from "vitest";
import { buildStaticPrefix, buildTypeSpec, buildDynamicTail, TIER_GUIDANCE } from "@/server/normalize/prompt";
import { validateNoteData } from "@/server/normalize/schemas";

// Commit 2 — the extractor assigns a permanence `_tier` to chronological nodes (news/catalyst/signal),
// understanding each tier's REAL time-scale, with a conservative "when unsure, keep longer" default so
// the downstream decay engine never over-deletes. The tier guidance lives in the cache-stable prefix.

describe("permanence tier — extractor prompt", () => {
  const typeSpec = buildTypeSpec();
  const prefix = buildStaticPrefix(typeSpec);
  const line = (prefix: string, type: string) => prefix.split("\n").find((l) => l.startsWith(`- ${type}:`)) ?? "";

  it("names all four tiers with real time-scales + a conservative default", () => {
    for (const t of ["ephemeral", "routine", "notable", "landmark"]) expect(TIER_GUIDANCE).toContain(t);
    expect(TIER_GUIDANCE).toContain("days");
    expect(TIER_GUIDANCE).toContain("weeks");
    expect(TIER_GUIDANCE).toContain("months");
    expect(TIER_GUIDANCE).toMatch(/WHEN UNSURE/);
  });

  it("lists _tier on news, catalyst, signal — but not filing or structural types", () => {
    expect(line(typeSpec, "news")).toContain("_tier [one of: ephemeral|routine|notable|landmark]");
    expect(line(typeSpec, "catalyst")).toContain("_tier");
    expect(line(typeSpec, "signal")).toContain("_tier");
    expect(line(typeSpec, "filing")).not.toContain("_tier");
    expect(line(typeSpec, "company")).not.toContain("_tier");
  });

  it("puts tier guidance in the cached prefix, not the per-chunk tail", () => {
    expect(prefix).toContain(TIER_GUIDANCE);
    expect(prefix).toContain("PERMANENCE TIER");
    expect(buildDynamicTail("some raw text", {})).not.toContain("PERMANENCE TIER");
  });

  it("introduces no buy/sell/hold advice vocab", () => {
    expect(TIER_GUIDANCE.toLowerCase()).not.toMatch(/\b(buy|sell|hold|price target|recommend)\b/);
  });
});

describe("permanence tier — schema preservation", () => {
  it("preserves a valid _tier on news/catalyst/signal", () => {
    const n = validateNoteData("news", { headline: "h", _tier: "ephemeral" });
    expect(n.success).toBe(true);
    if (n.success) expect(n.data._tier).toBe("ephemeral");
    const c = validateNoteData("catalyst", { name: "Earnings", _tier: "landmark" });
    expect(c.success).toBe(true);
    if (c.success) expect(c.data._tier).toBe("landmark");
    const s = validateNoteData("signal", { name: "RSI break", _tier: "routine" });
    expect(s.success).toBe(true);
    if (s.success) expect(s.data._tier).toBe("routine");
  });

  it("coerces an unknown _tier to undefined without throwing", () => {
    const r = validateNoteData("news", { headline: "h", _tier: "bogus" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data._tier).toBeUndefined();
  });

  it("omitting _tier is fine (left undefined for the conservative default downstream)", () => {
    const r = validateNoteData("news", { headline: "h" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data._tier).toBeUndefined();
  });
});
