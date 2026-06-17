import { describe, it, expect } from "vitest";
import { assemble, defaultStatus, slugify, uniqueId, type ExtractedNote } from "@/server/normalize/assemble";

describe("defaultStatus", () => {
  it("company -> mentioned, thesis -> active, everything else -> active", () => {
    expect(defaultStatus("company")).toBe("mentioned");
    expect(defaultStatus("thesis")).toBe("active");
    expect(defaultStatus("news")).toBe("active");
    expect(defaultStatus("person")).toBe("active");
  });
});

describe("slugify + uniqueId", () => {
  it("slugifies a title", () => {
    expect(slugify("NVIDIA Corp.")).toBe("nvidia-corp");
    expect(slugify("")).toBe("node");
  });
  it("bumps on collision", () => {
    expect(uniqueId("nvidia", new Set(["nvidia"]))).toBe("nvidia-2");
    expect(uniqueId("nvidia", new Set())).toBe("nvidia");
  });
});

describe("assemble", () => {
  it("lifts status, strips managed fields, normalizes tags, stashes body", () => {
    const note: ExtractedNote = {
      type: "company",
      id: "nvidia",
      title: "NVIDIA",
      data: { name: "NVIDIA", ticker: "NVDA", status: "owned", type: "leaked", tags: undefined },
      body: "  prose here  ",
      tags: ["Semis", "AI"],
    };
    const rec = assemble(note, new Set());
    expect(rec.id).toBe("nvidia");
    expect(rec.status).toBe("owned"); // lifted from data.status
    expect(rec.data.status).toBeUndefined(); // removed from data
    expect(rec.data.type).toBeUndefined(); // managed field stripped
    expect(rec.data.body).toBe("prose here");
    expect(rec.tags).toEqual(["semiconductor", "artificial-intelligence"]);
  });

  it("falls back to the per-type default status when none is given", () => {
    const rec = assemble({ type: "company", title: "TSMC", data: { name: "TSMC" } }, new Set());
    expect(rec.status).toBe("mentioned");
    expect(rec.id).toBe("tsmc");
  });
});
