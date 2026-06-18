import { describe, it, expect } from "vitest";
import { judgeOutputSchema, buildJudgePrompt, JUDGE_SYSTEM } from "@/server/critic/thesis-prompt";

describe("judgeOutputSchema — lenient, never crashes on a fumbled item", () => {
  it("drops malformed array items but keeps the valid ones", () => {
    const parsed = judgeOutputSchema.parse({
      strength: "supported",
      bear_case: "Customer concentration is unaddressed.",
      edges: [
        { evidence_id: "n1", relation: "confirms_thesis", quote: "beat estimates", confidence: 0.9 },
        { evidence_id: "n2", relation: "buy_now", quote: "x" }, // invalid relation -> dropped
        { quote: "missing id" }, // no evidence_id -> dropped
      ],
      confirming: [{ evidence_id: "n1", quote: "beat estimates", why: "supports growth" }],
    });
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].evidence_id).toBe("n1");
    expect(parsed.confirming).toHaveLength(1);
  });

  it("coerces confidence and defaults missing fields", () => {
    const parsed = judgeOutputSchema.parse({ strength: "weak", edges: [{ evidence_id: "n1", relation: "challenges_thesis", quote: "q", confidence: "0.7" }] });
    expect(parsed.edges[0].confidence).toBeCloseTo(0.7, 5);
    expect(parsed.bear_case).toBe(""); // defaulted; the judge enforces non-empty downstream
    expect(parsed.disconfirming).toEqual([]);
    expect(parsed.thin_reasoning_flags).toEqual([]);
  });

  it("tolerates a non-array edges value", () => {
    const parsed = judgeOutputSchema.parse({ strength: "weak", edges: "oops" });
    expect(parsed.edges).toEqual([]);
  });
});

describe("buildJudgePrompt + JUDGE_SYSTEM", () => {
  it("lists evidence by id and instructs verbatim quoting", () => {
    const p = buildJudgePrompt({
      thesis: { id: "quantum-thesis", statement: "Quantum is a decade out", about: ["[[ionq]]"] },
      evidence: [{ id: "n1", type: "news", title: "IonQ delays", snippet: "IonQ pushed its roadmap" }],
    });
    expect(p).toContain("id:n1");
    expect(p).toContain("quantum-thesis");
    expect(p).toContain("verbatim");
  });

  it("handles an empty evidence set", () => {
    const p = buildJudgePrompt({ thesis: { id: "t", statement: "s", about: [] }, evidence: [] });
    expect(p).toContain("no evidence found");
  });

  it("the system prompt mandates a bear case, the rubric, and the no-advice posture", () => {
    expect(JUDGE_SYSTEM).toMatch(/bear_case/);
    expect(JUDGE_SYSTEM).toMatch(/well-supported/);
    const lower = JUDGE_SYSTEM.toLowerCase();
    expect(lower).toContain("buy/sell");
    expect(lower).toContain("advisor");
  });
});
