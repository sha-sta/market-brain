import { describe, it, expect } from "vitest";
import {
  STRONG_RELATIONS,
  WEAK_RELATIONS,
  isAssertable,
  isStrong,
  normalizeRelation,
  resolveGroundedEdge,
  verifyEvidence,
} from "@/server/normalize/relations";

describe("relation vocab", () => {
  it("classifies STRONG vs WEAK", () => {
    expect(isStrong("supplies_to")).toBe(true);
    expect(isStrong("in_sector")).toBe(true);
    expect(isStrong("mentions")).toBe(false);
    expect(isStrong("relevant_to")).toBe(false);
  });

  it("contains NO buy/sell/recommend relation — the model cannot express advice", () => {
    const all = [...STRONG_RELATIONS, ...WEAK_RELATIONS];
    for (const banned of ["buy", "sell", "hold", "recommends", "recommend", "target"]) {
      expect(all).not.toContain(banned);
    }
  });

  it("normalizes to the controlled vocab; unknown -> relates_to", () => {
    expect(normalizeRelation("Supplies To")).toBe("supplies_to");
    expect(normalizeRelation("IN-THEME")).toBe("in_theme");
    expect(normalizeRelation("buy")).toBe("relates_to"); // advice can't sneak in as a relation
  });
});

describe("verifyEvidence — verbatim substring guard", () => {
  const src = "TSMC's CoWoS capacity constrains H200 shipments.";
  it("passes a verbatim quote (case/space-insensitive)", () => {
    expect(verifyEvidence("CoWoS capacity constrains H200", src)).toBe(true);
  });
  it("fails a paraphrase or too-short/empty quote", () => {
    expect(verifyEvidence("TSMC limits NVIDIA chip supply", src)).toBe(false);
    expect(verifyEvidence("at", src)).toBe(false);
    expect(verifyEvidence("", src)).toBe(false);
  });
});

describe("resolveGroundedEdge", () => {
  const src = "Anthropic was founded by Dario and Daniela Amodei.";
  it("grounds a STRONG claim whose evidence verifies (assertable)", () => {
    const e = resolveGroundedEdge("founded_by", "founded by Dario and Daniela Amodei", src);
    expect(e.relation_type).toBe("founded_by");
    expect(e.confidence).toBe(0.9);
    expect(isAssertable(e)).toBe(true);
  });
  it("downgrades an unverified STRONG claim to a non-assertable association", () => {
    const e = resolveGroundedEdge("founded_by", "the company was started by the Amodeis", src);
    expect(e.relation_type).toBe("relates_to");
    expect(e.evidence_quote).toBeNull();
    expect(isAssertable(e)).toBe(false);
  });
  it("keeps a weak relation weak (never assertable)", () => {
    const e = resolveGroundedEdge("mentions", "Anthropic", src);
    expect(e.relation_type).toBe("mentions");
    expect(isAssertable(e)).toBe(false);
  });
});

describe("isAssertable mirrors the DB generated column", () => {
  it("requires STRONG + confidence>=0.8 + evidence", () => {
    expect(isAssertable({ relation_type: "supplies_to", confidence: 0.9, evidence_quote: "q" })).toBe(true);
    expect(isAssertable({ relation_type: "supplies_to", confidence: 0.9, evidence_quote: null })).toBe(false);
    expect(isAssertable({ relation_type: "supplies_to", confidence: 0.5, evidence_quote: "q" })).toBe(false);
    expect(isAssertable({ relation_type: "mentions", confidence: 0.9, evidence_quote: "q" })).toBe(false);
  });
});
