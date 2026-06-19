import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { judgeThesis, type Judge } from "@/server/critic/thesis-judge";
import type { Json } from "@/lib/database.types";

// The strict thesis-judge end-to-end (real DB, STUB judge): only edges that cite a real evidence id AND
// quote it verbatim are asserted; a hallucinated id and a paraphrase are dropped; the inflated verdict
// is demoted by enforceFloor to what the VERIFIED evidence supports.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const asJson = (v: unknown): Json => v as Json;

async function seedNode(id: string, type: string, title: string, data: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type,
    title,
    status: type === "thesis" ? "active" : "active",
    data: asJson(data),
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: "active",
  });
  if (error) throw new Error(`seedNode ${id}: ${error.message}`);
}

async function mentions(src: string, dst: string): Promise<void> {
  const { error } = await admin.rpc("upsert_edge", {
    p_graph_id: TEST_GRAPH_ID,
    p_src_id: src,
    p_dst_id: dst,
    p_type: "mentions",
    p_relation_type: "mentions",
    p_method: "test",
    p_confidence: 0.6,
  });
  if (error) throw new Error(`mentions ${src}->${dst}: ${error.message}`);
}

describe("thesis-judge — grounding + enforceFloor", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("asserts only verified edges, drops fabrications, and demotes an inflated verdict", async () => {
    await seedNode("nvidia", "company", "NVIDIA", { name: "NVIDIA", ticker: "NVDA" });
    await seedNode("nvda-thesis", "thesis", "NVDA dominates AI", { statement: "NVIDIA dominates AI compute", about: ["[[nvidia]]"] });
    await seedNode("good-news", "news", "NVIDIA crushes earnings", {
      headline: "NVIDIA crushes earnings",
      summary: "NVIDIA beat estimates and raised guidance",
    });
    await seedNode("bad-news", "news", "NVIDIA hit by export ban", {
      headline: "NVIDIA hit by export ban",
      summary: "new export restrictions cut China revenue sharply",
    });
    await mentions("good-news", "nvidia");
    await mentions("bad-news", "nvidia");

    // Stub judge: inflated to "well-supported", with one valid confirm, one valid challenge, plus a
    // hallucinated id and a paraphrase that must both be discarded.
    const judge: Judge = async () => ({
      strength: "well-supported",
      rationale: "Strong demand.",
      bear_case: "Export controls could cap the China TAM.",
      disconfirming: [],
      confirming: [],
      thin_reasoning_flags: [],
      edges: [
        { evidence_id: "good-news", relation: "confirms_thesis", quote: "NVIDIA beat estimates", confidence: 0.9 },
        { evidence_id: "bad-news", relation: "challenges_thesis", quote: "export restrictions cut China revenue", confidence: 0.85 },
        { evidence_id: "ghost-node", relation: "confirms_thesis", quote: "anything", confidence: 0.95 }, // hallucinated id
        { evidence_id: "good-news", relation: "confirms_thesis", quote: "a paraphrase not present verbatim", confidence: 0.9 }, // unverified
      ],
    });

    const res = await judgeThesis(admin, TEST_GRAPH_ID, { id: "nvda-thesis", data: { statement: "NVIDIA dominates AI compute", about: ["[[nvidia]]"] } }, { judge, nowMs: Date.UTC(2026, 5, 1) });

    expect(res.edgesWritten).toBe(2);
    expect(res.confirming).toBe(1);
    expect(res.challenging).toBe(1);
    expect(res.strength).toBe("contested"); // enforceFloor: 1 confirm vs 1 challenge -> never "well-supported"

    // Only the two verified edges exist (hallucinated + paraphrase dropped).
    const { data: edges } = await admin
      .from("edges")
      .select("src_id, relation_type, assertable")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("dst_id", "nvda-thesis");
    expect(edges!.length).toBe(2);
    expect(edges!.every((e) => e.assertable === false)).toBe(true); // thesis edges are WEAK, never assertable
    const byRel = new Map(edges!.map((e) => [e.relation_type, e.src_id]));
    expect(byRel.get("confirms_thesis")).toBe("good-news");
    expect(byRel.get("challenges_thesis")).toBe("bad-news");

    // The verdict is persisted onto the thesis node with a non-empty bear case + judged_at.
    const { data: node } = await admin.from("nodes").select("data, status, last_judged_at").eq("graph_id", TEST_GRAPH_ID).eq("id", "nvda-thesis").single();
    const judgeBlock = (node!.data as Record<string, unknown>).judge as Record<string, unknown>;
    expect(judgeBlock.strength).toBe("contested");
    expect(String(judgeBlock.bear_case).length).toBeGreaterThan(0);
    expect(node!.status).toBe("challenged");
    expect(node!.last_judged_at).not.toBeNull();
  });

  it("supplies a bear case when the model leaves it empty, and stays unsupported with no evidence", async () => {
    await seedNode("lonely-thesis", "thesis", "Untested idea", { statement: "Nobody has written about this", about: [] });
    const judge: Judge = async () => ({
      strength: "well-supported", // inflated with zero evidence
      rationale: "",
      bear_case: "   ", // blank
      disconfirming: [],
      confirming: [],
      thin_reasoning_flags: [],
      edges: [],
    });
    const res = await judgeThesis(admin, TEST_GRAPH_ID, { id: "lonely-thesis", data: { statement: "Nobody has written about this", about: [] } }, { judge });
    expect(res.strength).toBe("unsupported");
    const { data: node } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("id", "lonely-thesis").single();
    const judgeBlock = (node!.data as Record<string, unknown>).judge as Record<string, unknown>;
    expect(String(judgeBlock.bear_case).length).toBeGreaterThan(0); // synthesized fallback
  });
});
