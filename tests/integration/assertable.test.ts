import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";

// The DB's generated `assertable` column must agree with STRONG_RELATIONS after the 0032 vocab
// expansion: every new STRONG relation can assert (with evidence + confidence), and the new WEAK
// relations (acts_on, supersedes) never can. This is the runtime half of the sync-guard — it catches
// a typo inside the SQL literal (e.g. a stray space) that the pure regex test cannot.

const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const admin = adminClient();

async function seedNode(id: string, type: string, title: string): Promise<void> {
  const { error } = await admin
    .from("nodes")
    .insert({ id, graph_id: TEST_GRAPH_ID, type, title, status: "active", data: {}, tags: [], embedding: ZERO_VEC });
  if (error) throw new Error(`seedNode ${id}: ${error.message}`);
}

async function assertableFor(relation: string, confidence: number, evidence: string | null): Promise<boolean> {
  const { error } = await admin.rpc("upsert_edge", {
    p_graph_id: TEST_GRAPH_ID,
    p_src_id: "rates",
    p_dst_id: "nvidia",
    p_type: relation,
    p_relation_type: relation,
    p_method: "test",
    p_confidence: confidence,
    p_evidence_quote: evidence ?? undefined,
    p_source_upload_id: undefined,
  });
  if (error) throw new Error(`upsert_edge ${relation}: ${error.message}`);
  const { data, error: readErr } = await admin
    .from("edges")
    .select("assertable")
    .eq("graph_id", TEST_GRAPH_ID)
    .eq("src_id", "rates")
    .eq("dst_id", "nvidia")
    .eq("type", relation)
    .single();
  if (readErr) throw new Error(`read ${relation}: ${readErr.message}`);
  return data.assertable ?? false;
}

describe("edges.assertable generated column (0032 expanded vocab)", () => {
  beforeAll(async () => {
    await cleanupAll();
    await seedNode("rates", "macro_factor", "Fed funds rate");
    await seedNode("nvidia", "company", "NVIDIA");
  });
  afterAll(cleanupAll);

  it("new STRONG relations assert with evidence + confidence>=0.8", async () => {
    expect(await assertableFor("affects", 0.9, "rates compress NVIDIA's multiple")).toBe(true);
    expect(await assertableFor("depends_on", 0.9, "depends on HBM supply")).toBe(true);
    expect(await assertableFor("catalyst_for", 0.9, "earnings on Aug 20")).toBe(true);
  });

  it("new WEAK relations never assert, even with evidence + high confidence", async () => {
    expect(await assertableFor("acts_on", 0.95, "the SEC acted on the filing")).toBe(false);
    expect(await assertableFor("supersedes", 0.95, "this reading supersedes the prior one")).toBe(false);
  });

  it("a STRONG relation without an evidence quote is not assertable", async () => {
    expect(await assertableFor("threatens", 0.9, null)).toBe(false);
  });

  it("a STRONG relation below the confidence floor is not assertable", async () => {
    expect(await assertableFor("regulates", 0.5, "the FDA regulates the drug")).toBe(false);
  });
});
