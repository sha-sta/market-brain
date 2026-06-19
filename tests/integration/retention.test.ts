import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { decayStaleNodes } from "@/server/market/daily";
import type { Json } from "@/lib/database.types";

// Commit 3 — reference-guarded HARD delete: a long-archived chronological node is deleted (reclaiming
// the row + embedding, cascading its children) UNLESS it is still evidence for an active thesis or
// linked to an active tracked entity. Real test DB.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const asJson = (v: unknown): Json => v as Json;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);

async function seedNode(
  id: string,
  type: string,
  data: Record<string, unknown>,
  opts: { lifecycle?: string; status?: string } = {},
): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type,
    title: id,
    status: opts.status ?? "active",
    data: asJson(data),
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: opts.lifecycle ?? "active",
  });
  if (error) throw new Error(`seedNode ${id}: ${error.message}`);
}

async function edge(src: string, dst: string, relation: string): Promise<void> {
  const { error } = await admin.rpc("upsert_edge", {
    p_graph_id: TEST_GRAPH_ID,
    p_src_id: src,
    p_dst_id: dst,
    p_type: relation,
    p_relation_type: relation,
    p_method: "test",
    p_confidence: 0.9,
  });
  if (error) throw new Error(`edge ${src}->${dst}: ${error.message}`);
}

/** An archived news node old enough to be past its delete window (notable default = 270d). */
async function seedLongArchivedNews(id: string): Promise<void> {
  await seedNode(id, "news", { headline: id, published_at: new Date(NOW - 300 * DAY).toISOString() }, { lifecycle: "archived" });
}

async function nodeExists(id: string): Promise<boolean> {
  const { data } = await admin.from("nodes").select("id").eq("graph_id", TEST_GRAPH_ID).eq("id", id).maybeSingle();
  return Boolean(data);
}

describe("retention — reference-guarded hard delete", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("hard-deletes a long-archived node and cascades its edges", async () => {
    await seedNode("nvidia", "company", { name: "NVIDIA", ticker: "NVDA" });
    await seedLongArchivedNews("old-archived");
    await edge("old-archived", "nvidia", "mentions");

    const { deleted } = await decayStaleNodes(admin, TEST_GRAPH_ID, NOW);
    expect(deleted).toBe(1);
    expect(await nodeExists("old-archived")).toBe(false);

    const { data: edges } = await admin.from("edges").select("id").eq("graph_id", TEST_GRAPH_ID).eq("src_id", "old-archived");
    expect((edges ?? []).length).toBe(0); // cascaded away with the node
  });

  it("does NOT delete a node that is evidence for an ACTIVE thesis", async () => {
    await seedNode("nvda-thesis", "thesis", { statement: "NVIDIA dominates AI", about: [] }, { lifecycle: "active" });
    await seedLongArchivedNews("evidence-news");
    await edge("evidence-news", "nvda-thesis", "confirms_thesis");

    const { deleted } = await decayStaleNodes(admin, TEST_GRAPH_ID, NOW);
    expect(deleted).toBe(0);
    expect(await nodeExists("evidence-news")).toBe(true);
  });

  it("DOES delete evidence once its thesis is superseded (no longer protective)", async () => {
    await seedNode("old-thesis", "thesis", { statement: "stale view", about: [] }, { lifecycle: "superseded" });
    await seedLongArchivedNews("evidence-news");
    await edge("evidence-news", "old-thesis", "confirms_thesis");

    const { deleted } = await decayStaleNodes(admin, TEST_GRAPH_ID, NOW);
    expect(deleted).toBe(1);
    expect(await nodeExists("evidence-news")).toBe(false);
  });

  it("does NOT delete a node still linked to an ACTIVE tracked entity", async () => {
    await seedLongArchivedNews("tracked-news");
    const { error } = await admin
      .from("tracked_entities")
      .insert({ graph_id: TEST_GRAPH_ID, node_id: "tracked-news", kind: "owned", candidate_status: "active" });
    if (error) throw new Error(error.message);

    const { deleted } = await decayStaleNodes(admin, TEST_GRAPH_ID, NOW);
    expect(deleted).toBe(0);
    expect(await nodeExists("tracked-news")).toBe(true);
  });

  it("keeps a recently-archived node within its grace window (archived but not yet deleted)", async () => {
    // 100d old, notable default: past the 90d archive window (already archived) but < the 270d delete window.
    await seedNode("recent-archived", "news", { headline: "recent", published_at: new Date(NOW - 100 * DAY).toISOString() }, { lifecycle: "archived" });
    const { deleted } = await decayStaleNodes(admin, TEST_GRAPH_ID, NOW);
    expect(deleted).toBe(0);
    expect(await nodeExists("recent-archived")).toBe(true);
  });
});
