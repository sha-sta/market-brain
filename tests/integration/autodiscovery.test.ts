import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { detectConnections } from "@/server/market/daily";

// Auto-discovery (the cost firewall): an entity linked to >= 2 ACTIVE tracked names becomes a tracked
// CANDIDATE (source=auto, never fetched), so the watch-list grows without the user curating it. Stale
// candidates decay to 'dropped'. Manual/active rows are never touched.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;

async function node(id: string, type: string): Promise<void> {
  const { error } = await admin
    .from("nodes")
    .insert({ id, graph_id: TEST_GRAPH_ID, type, title: id.toUpperCase(), status: "active", data: {}, tags: [], embedding: ZERO_VEC, lifecycle: "active" });
  if (error) throw new Error(`node ${id}: ${error.message}`);
}
async function edge(src: string, dst: string): Promise<void> {
  const { error } = await admin.rpc("upsert_edge", {
    p_graph_id: TEST_GRAPH_ID,
    p_src_id: src,
    p_dst_id: dst,
    p_type: "supplies_to",
    p_relation_type: "supplies_to",
    p_method: "test",
    p_confidence: 0.9,
  });
  if (error) throw new Error(`edge ${src}->${dst}: ${error.message}`);
}

describe("auto-discovery — detectConnections", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("promotes an entity linked to >=2 active holdings to a candidate (never active, never fetched)", async () => {
    await node("nvidia", "company");
    await node("amd", "company");
    await node("tsmc", "company"); // the shared supplier — untracked
    await admin.from("tracked_entities").insert([
      { graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned", source: "manual", candidate_status: "active" },
      { graph_id: TEST_GRAPH_ID, node_id: "amd", kind: "watchlist", source: "manual", candidate_status: "active" },
    ]);
    await edge("tsmc", "nvidia");
    await edge("tsmc", "amd");

    const res = await detectConnections(admin, TEST_GRAPH_ID, Date.now());
    expect(res.discovered).toBe(1);

    const { data: t } = await admin.from("tracked_entities").select("candidate_status, source, score").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "tsmc").single();
    expect(t!.candidate_status).toBe("candidate"); // NOT active — the cost firewall
    expect(t!.source).toBe("auto");
    expect(Number(t!.score)).toBe(2);

    // manual/active rows are untouched
    const { data: nv } = await admin.from("tracked_entities").select("source, candidate_status").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "nvidia").single();
    expect(nv!.source).toBe("manual");
    expect(nv!.candidate_status).toBe("active");
  });

  it("does not promote an entity linked to only ONE holding", async () => {
    await node("nvidia", "company");
    await node("amd", "company");
    await node("solo", "company");
    await admin.from("tracked_entities").insert([
      { graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned", source: "manual", candidate_status: "active" },
      { graph_id: TEST_GRAPH_ID, node_id: "amd", kind: "owned", source: "manual", candidate_status: "active" },
    ]);
    await edge("solo", "nvidia"); // only one tracked endpoint
    const res = await detectConnections(admin, TEST_GRAPH_ID, Date.now());
    expect(res.discovered).toBe(0);
  });

  it("decays a stale auto candidate to 'dropped'", async () => {
    await node("nvidia", "company");
    await node("old-cand", "company");
    // NB: set last_surfaced_at on BOTH rows — a multi-row insert writes NULL for a key one row omits,
    // which would violate the column's NOT NULL and fail the whole insert.
    await admin.from("tracked_entities").insert([
      { graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned", source: "manual", candidate_status: "active", last_surfaced_at: new Date().toISOString() },
      {
        graph_id: TEST_GRAPH_ID,
        node_id: "old-cand",
        kind: "discovered",
        source: "auto",
        candidate_status: "candidate",
        last_surfaced_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), // > 21d ago
      },
    ]);
    const res = await detectConnections(admin, TEST_GRAPH_ID, Date.now());
    expect(res.dropped).toBe(1);
    const { data: c } = await admin.from("tracked_entities").select("candidate_status").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "old-cand").single();
    expect(c!.candidate_status).toBe("dropped");
  });
});
