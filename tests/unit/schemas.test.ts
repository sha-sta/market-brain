import { describe, it, expect } from "vitest";
import { validateNoteData } from "@/server/normalize/schemas";

describe("company schema", () => {
  it("accepts a public company and defaults is_public + status", () => {
    const r = validateNoteData("company", { name: "NVIDIA", ticker: "NVDA", sector: "[[semiconductors]]" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.is_public).toBe(true);
      expect(r.data.status).toBe("mentioned");
      expect(r.data.themes).toEqual([]);
    }
  });
  it("coerces a private company's manual_valuation to a number", () => {
    const r = validateNoteData("company", { name: "Anthropic", is_public: false, manual_valuation: "183000000000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.manual_valuation).toBe(183000000000);
  });
  it("rejects an invalid status (no buy/sell status exists)", () => {
    expect(validateNoteData("company", { name: "X", status: "buy" }).success).toBe(false);
  });
});

describe("news schema", () => {
  it("requires a headline and defaults sentiment/materiality", () => {
    const r = validateNoteData("news", { headline: "NVIDIA beats earnings", tickers: ["NVDA"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sentiment).toBe("neutral");
      expect(r.data.materiality).toBe("med");
    }
    expect(validateNoteData("news", { summary: "no headline" }).success).toBe(false);
  });
});

describe("thesis schema", () => {
  it("requires a statement and clamps/coerces confidence", () => {
    const r = validateNoteData("thesis", { statement: "Quantum is a decade out", confidence: "0.3" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.confidence).toBe(0.3);
      expect(r.data.status).toBe("active");
      expect(r.data.conviction).toBe("medium");
    }
    expect(validateNoteData("thesis", { confidence: 0.5 }).success).toBe(false); // no statement
  });
});

describe("validateNoteData guards", () => {
  it("rejects an unknown type", () => {
    expect(validateNoteData("stock", { name: "x" }).success).toBe(false);
  });
  it("a worker-built note (all-optional) validates", () => {
    expect(validateNoteData("note", { body: "raw", summary: "s" }).success).toBe(true);
  });
});
