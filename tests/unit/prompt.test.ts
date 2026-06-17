import { describe, it, expect } from "vitest";
import { SYSTEM, buildPrompt, buildStaticPrefix, buildTypeSpec } from "@/server/normalize/prompt";

describe("buildTypeSpec", () => {
  it("lists the finance entity types and EXCLUDES the worker-only note type", () => {
    const spec = buildTypeSpec();
    for (const t of ["company", "person", "sector", "theme", "news", "filing", "thesis"]) {
      expect(spec).toContain(`- ${t}:`);
    }
    expect(spec).not.toContain("- note:");
  });
  it("marks the ticker field and headline requirement", () => {
    const spec = buildTypeSpec();
    expect(spec).toContain("ticker");
    expect(spec).toContain("headline [str] (required)");
  });
});

describe("SYSTEM + static prefix guardrails", () => {
  it("forbids advice and ticker fabrication", () => {
    const lower = SYSTEM.toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("buy/sell");
    expect(lower).toContain("verbatim");
  });
  it("the static prefix teaches verbatim tickers + no recommendations", () => {
    const prefix = buildStaticPrefix(buildTypeSpec());
    expect(prefix).toContain("VERBATIM");
    expect(prefix.toLowerCase()).toContain("never guess");
    expect(prefix).toContain("supplies_to");
    expect(prefix).not.toMatch(/\b(buy|sell|hold)\s+(rating|recommendation)\b/i);
  });
});

describe("buildPrompt", () => {
  it("concatenates the static prefix and the dynamic tail (with the raw note)", () => {
    const p = buildPrompt("NVDA up 3% on earnings", buildTypeSpec());
    expect(p).toContain("NVDA up 3% on earnings");
    expect(p).toContain("RAW NOTE:");
  });
});
