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

describe("catalyst schema", () => {
  it("requires name and defaults importance + about", () => {
    const r = validateNoteData("catalyst", { name: "NVDA Q2 earnings", event_date: "2026-08-20", about: ["[[nvidia]]"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.importance).toBe("med");
      expect(r.data.about).toEqual(["[[nvidia]]"]);
    }
    expect(validateNoteData("catalyst", { event_date: "2026-08-20" }).success).toBe(false); // no name
    expect(validateNoteData("catalyst", { name: "x", importance: "urgent" }).success).toBe(false); // bad enum
  });
});

describe("macro_factor schema", () => {
  it("requires name and defaults category + affects", () => {
    const r = validateNoteData("macro_factor", { name: "Fed funds rate", affects: ["[[semiconductors]]"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.category).toBe("other");
      expect(r.data.affects).toEqual(["[[semiconductors]]"]);
    }
    expect(validateNoteData("macro_factor", { category: "rates" }).success).toBe(false); // no name
    expect(validateNoteData("macro_factor", { name: "x", category: "vibes" }).success).toBe(false); // bad enum
  });
});

describe("risk schema", () => {
  it("requires name and defaults severity/likelihood + threatens", () => {
    const r = validateNoteData("risk", { name: "Taiwan concentration", threatens: ["[[tsmc]]", "[[nvidia]]"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.severity).toBe("med");
      expect(r.data.likelihood).toBe("med");
      expect(r.data.threatens).toEqual(["[[tsmc]]", "[[nvidia]]"]);
    }
    expect(validateNoteData("risk", { severity: "high" }).success).toBe(false); // no name
    expect(validateNoteData("risk", { name: "x", severity: "catastrophic" }).success).toBe(false); // bad enum
  });
});

describe("product schema", () => {
  it("requires name and defaults depends_on", () => {
    const r = validateNoteData("product", { name: "H200", maker: "[[nvidia]]", depends_on: ["[[hbm]]"] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.depends_on).toEqual(["[[hbm]]"]);
    expect(validateNoteData("product", { maker: "[[nvidia]]" }).success).toBe(false); // no name
  });
});

describe("commodity schema", () => {
  it("requires name and defaults used_in", () => {
    const r = validateNoteData("commodity", { name: "HBM", unit: "per stack" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.used_in).toEqual([]);
    expect(validateNoteData("commodity", { unit: "per tonne" }).success).toBe(false); // no name
  });
});

describe("organization schema", () => {
  it("requires name and defaults org_type + acts_on", () => {
    const r = validateNoteData("organization", { name: "SEC", acts_on: ["[[nvidia]]"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.org_type).toBe("other");
      expect(r.data.acts_on).toEqual(["[[nvidia]]"]);
    }
    expect(validateNoteData("organization", { org_type: "regulator" }).success).toBe(false); // no name
    expect(validateNoteData("organization", { name: "x", org_type: "cabal" }).success).toBe(false); // bad enum
  });
});

describe("signal schema", () => {
  it("requires name and defaults direction/strength + about", () => {
    const r = validateNoteData("signal", { name: "NVDA insider buying", about: ["[[nvidia]]"] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.direction).toBe("neutral");
      expect(r.data.strength).toBe("moderate");
      expect(r.data.about).toEqual(["[[nvidia]]"]);
    }
    expect(validateNoteData("signal", { direction: "bullish" }).success).toBe(false); // no name
    expect(validateNoteData("signal", { name: "x", direction: "sideways" }).success).toBe(false); // bad enum
  });
});
