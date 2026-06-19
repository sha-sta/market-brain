import { describe, it, expect } from "vitest";
import { embedText, embedTextChanged } from "@/server/normalize/upsert";
import type { NodeRecord, NodeType } from "@/server/normalize/types";

const rec = (type: NodeType, title: string, data: Record<string, unknown>): NodeRecord => ({
  id: "x",
  type,
  title,
  status: "active",
  tags: [],
  relatesTo: [],
  source: "upload",
  data,
});

describe("embedText — only human-meaningful fields", () => {
  it("embeds a company's identity + prose, ignores structural fields", () => {
    const t = embedText(rec("company", "NVIDIA", { name: "NVIDIA", description: "GPU maker", cik: "0001045810" }));
    expect(t).toContain("NVIDIA");
    expect(t).toContain("GPU maker");
    expect(t).not.toContain("0001045810"); // cik is not embedded
  });

  it("embeds a note's title + summary only (not the full body)", () => {
    const t = embedText(rec("note", "Q2 notes", { summary: "earnings recap", body: "a very long body".repeat(50) }));
    expect(t).toBe("Q2 notes earnings recap");
  });
});

describe("embedTextChanged — re-embed only when embedded text changes", () => {
  it("false when only NON-embedded fields change (cik/exchange/website fill — the enrich case)", () => {
    const before = rec("company", "NVIDIA", { name: "NVIDIA", description: "GPU maker" });
    const after = rec("company", "NVIDIA", { name: "NVIDIA", description: "GPU maker", cik: "0001045810", exchange: "NASDAQ" });
    expect(embedTextChanged(before, after)).toBe(false);
  });

  it("true when an embedded field is superseded (description/summary swap)", () => {
    const before = rec("company", "NVIDIA", { name: "NVIDIA", description: "GPU maker" });
    const after = rec("company", "NVIDIA", { name: "NVIDIA", description: "AI accelerator leader" });
    expect(embedTextChanged(before, after)).toBe(true);
  });
});
