import { describe, it, expect } from "vitest";
import { planCorrection, isCorrectableField, AUTO_APPLY_CONFIDENCE } from "@/server/normalize/reconcile-rules";
import { extractEnvelopeSchema } from "@/server/normalize/extract-schema";
import { buildStaticPrefix, buildTypeSpec, buildDynamicTail, CORRECTIONS_GUIDANCE } from "@/server/normalize/prompt";

// Commit 5 — fact reconciliation: pure gating rules + the extractor envelope + the prompt guidance.

describe("planCorrection — confidence + verify gate", () => {
  it("auto-applies only verified changes at/above the 0.85 bar", () => {
    expect(AUTO_APPLY_CONFIDENCE).toBe(0.85);
    expect(planCorrection(0.9, true)).toBe("apply");
    expect(planCorrection(0.85, true)).toBe("apply");
  });

  it("queues verified mid-confidence (0.6–0.85) for review", () => {
    expect(planCorrection(0.84, true)).toBe("queue");
    expect(planCorrection(0.7, true)).toBe("queue");
  });

  it("drops low-confidence and ALWAYS drops unverified (a paraphrase is never acted on)", () => {
    expect(planCorrection(0.5, true)).toBe("skip");
    expect(planCorrection(0.99, false)).toBe("skip");
  });
});

describe("isCorrectableField — narrative only, never identity", () => {
  it("allows narrative fields, rejects identity + unknown fields", () => {
    expect(isCorrectableField("description")).toBe(true);
    expect(isCorrectableField("role")).toBe(true);
    expect(isCorrectableField("ticker")).toBe(false);
    expect(isCorrectableField("name")).toBe(false);
    expect(isCorrectableField("website")).toBe(false); // not a narrative field
  });
});

describe("corrections envelope — lenient + back-compat", () => {
  it("drops a malformed correction item without rejecting the envelope", () => {
    const env = extractEnvelopeSchema.parse({
      notes: [],
      corrections: [
        { target: "[[nvidia]]", field: "description", old: "a", new: "b", evidence: "q", confidence: 0.9, kind: "value" },
        { target: "broken" }, // missing required `new` -> dropped
      ],
    });
    expect(env.corrections?.length).toBe(1);
    expect(env.corrections![0].target).toBe("[[nvidia]]");
  });

  it("treats an omitted corrections array as undefined (old envelopes still parse)", () => {
    const env = extractEnvelopeSchema.parse({ notes: [], ambiguous: [] });
    expect(env.corrections).toBeUndefined();
  });
});

describe("CORRECTIONS prompt guidance", () => {
  const prefix = buildStaticPrefix(buildTypeSpec());

  it("is present in the cached prefix with the rename/relation_expiry kinds + the verbatim rule", () => {
    expect(prefix).toContain(CORRECTIONS_GUIDANCE);
    expect(CORRECTIONS_GUIDANCE).toMatch(/rename/);
    expect(CORRECTIONS_GUIDANCE).toMatch(/relation_expiry/);
    expect(CORRECTIONS_GUIDANCE).toMatch(/verbatim/);
  });

  it("is NOT in the per-chunk tail (cache stability)", () => {
    expect(buildDynamicTail("raw", {})).not.toContain("CORRECTIONS");
  });
});
