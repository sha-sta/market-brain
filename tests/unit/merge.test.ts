import { describe, it, expect } from "vitest";
import { mergeNode } from "@/server/normalize/merge";
import type { NodeRecord, NodeType } from "@/server/normalize/types";

const rec = (data: Record<string, unknown>): NodeRecord => ({
  id: "nvidia",
  type: "company" as NodeType,
  title: "NVIDIA",
  status: "active",
  tags: [],
  relatesTo: [],
  source: "upload",
  data,
});

const T_OLD = Date.UTC(2026, 0, 1);
const T_NEW = Date.UTC(2026, 5, 1);

describe("mergeNode — fill-only (no supersede context, original behavior)", () => {
  it("fills empty scalars and unions lists, never clobbers an existing value", () => {
    const existing = rec({ description: "GPU maker", themes: ["[[ai]]"] });
    const incoming = rec({ description: "AI accelerator leader", cik: "0001045810", themes: ["[[datacenter]]"] });
    const { merged, changed, superseded } = mergeNode(existing, incoming);
    expect(merged.data.description).toBe("GPU maker"); // existing kept (no supersede ctx)
    expect(merged.data.cik).toBe("0001045810"); // blank filled
    expect(merged.data.themes).toEqual(["[[ai]]", "[[datacenter]]"]);
    expect(changed).toBe(true);
    expect(superseded).toEqual([]);
  });
});

describe("mergeNode — supersede mode (swap old for new)", () => {
  it("overwrites a narrative field when the incoming source is newer", () => {
    const { merged, superseded } = mergeNode(rec({ description: "GPU maker" }), rec({ description: "AI accelerator leader" }), {
      existingAsOfMs: T_OLD,
      incomingAsOfMs: T_NEW,
    });
    expect(merged.data.description).toBe("AI accelerator leader");
    expect(superseded).toEqual(["description"]);
  });

  it("keeps the existing value when the incoming source is older (no backfill clobber)", () => {
    const { merged, superseded } = mergeNode(rec({ description: "current view" }), rec({ description: "stale backfill" }), {
      existingAsOfMs: T_NEW,
      incomingAsOfMs: T_OLD,
    });
    expect(merged.data.description).toBe("current view");
    expect(superseded).toEqual([]);
  });

  it("never supersedes an identity field even when the incoming source is newer", () => {
    const { merged, superseded } = mergeNode(rec({ ticker: "NVDA", description: "x" }), rec({ ticker: "NVDQ", description: "x" }), {
      existingAsOfMs: T_OLD,
      incomingAsOfMs: T_NEW,
    });
    expect(merged.data.ticker).toBe("NVDA");
    expect(superseded).toEqual([]);
  });
});
