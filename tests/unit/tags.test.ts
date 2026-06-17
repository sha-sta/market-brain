import { describe, it, expect } from "vitest";
import { canonicalTag, normalizeTag, normalizeTags } from "@/server/normalize/tags";

describe("tag normalization", () => {
  it("kebabs and lowercases a raw tag", () => {
    expect(normalizeTag("Quantum Computing")).toBe("quantum-computing");
    expect(normalizeTag("AI / ML")).toBe("ai-ml");
  });

  it("applies finance aliases (canonical forms are singular)", () => {
    expect(canonicalTag("semis")).toBe("semiconductor");
    expect(canonicalTag("qc")).toBe("quantum-computing");
    expect(canonicalTag("ai")).toBe("artificial-intelligence");
    expect(canonicalTag("space")).toBe("aerospace");
  });

  it("a plural and its alias collapse to the SAME tag (semis == semiconductors)", () => {
    expect(normalizeTags(["chips"])).toEqual(["semiconductor"]);
    expect(normalizeTags(["semiconductors"])).toEqual(["semiconductor"]);
    expect(normalizeTags(["EVs"])).toEqual(["electric-vehicle"]);
  });

  it("normalizes, dedupes, and caps a list", () => {
    expect(normalizeTags(["Semis", "QC", "AI", "ai", "semiconductors"])).toEqual([
      "semiconductor",
      "quantum-computing",
      "artificial-intelligence",
    ]);
    expect(normalizeTags(["a", "b", "c", "d", "e", "f", "g"]).length).toBe(6);
    expect(normalizeTags(null)).toEqual([]);
  });
});
