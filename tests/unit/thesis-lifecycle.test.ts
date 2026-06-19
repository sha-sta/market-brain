import { describe, it, expect } from "vitest";
import { shouldSupersede, sharesSubject, aboutIds, SUPERSEDE_SIMILARITY } from "@/server/critic/thesis-supersede-rules";
import { validateThesisStatement, formatThesisDump } from "@/app/(app)/theses/thesis-input";

// Commit 4 — pure rules for thesis replacement + add-thesis input.

describe("shouldSupersede — near-restatement bar", () => {
  it("requires BOTH a shared subject and similarity >= 0.92", () => {
    expect(SUPERSEDE_SIMILARITY).toBe(0.92);
    expect(shouldSupersede(0.91, true)).toBe(false); // just under the bar
    expect(shouldSupersede(0.92, true)).toBe(true); // at the bar
    expect(shouldSupersede(0.99, false)).toBe(false); // identical but different subject -> not a replacement
  });
});

describe("sharesSubject / aboutIds", () => {
  it("strips [[ ]] and detects subject overlap", () => {
    expect([...aboutIds({ about: ["[[nvidia]]", "[[ai]]"] })]).toEqual(["nvidia", "ai"]);
    expect(sharesSubject({ about: ["[[nvidia]]"] }, { about: ["nvidia", "amd"] })).toBe(true);
    expect(sharesSubject({ about: ["[[nvidia]]"] }, { about: ["[[tsmc]]"] })).toBe(false);
    expect(sharesSubject({ about: [] }, { about: ["[[nvidia]]"] })).toBe(false);
  });
});

describe("add-thesis input", () => {
  it("rejects an empty statement (returned, never thrown)", () => {
    expect(validateThesisStatement("   ")).toEqual({ ok: false, message: "Write your thesis first." });
  });

  it("accepts and trims a real statement", () => {
    expect(validateThesisStatement("  NVIDIA dominates AI compute  ")).toEqual({ ok: true, statement: "NVIDIA dominates AI compute" });
  });

  it("rejects an overlong statement", () => {
    const r = validateThesisStatement("x".repeat(2001));
    expect(r.ok).toBe(false);
  });

  it("formats a dump the extractor reads as a thesis (THESIS:/ABOUT:)", () => {
    expect(formatThesisDump("NVIDIA dominates AI", "[[nvidia]]")).toBe("THESIS: NVIDIA dominates AI\nABOUT: [[nvidia]]");
    expect(formatThesisDump("Rates stay higher for longer", "")).toBe("THESIS: Rates stay higher for longer");
  });
});
