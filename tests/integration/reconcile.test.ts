import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { applyCorrections } from "@/server/normalize/reconcile";
import { drainPending } from "@/server/normalize/drain";
import type { RawCorrection } from "@/server/normalize/extract-schema";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { Json } from "@/lib/database.types";

// Commit 5 — fact reconciliation against the real DB: high-confidence + verbatim-verified corrections
// apply through writeNodeData (revision snapshot); mid-confidence queue; unverified drop; a rename never
// overwrites `name`; a relation_expiry retires the stale insider_of edge.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const asJson = (v: unknown): Json => v as Json;
const embed = async (): Promise<number[]> => new Array(1536).fill(0);

async function seedNode(id: string, type: string, data: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type,
    title: String(data.name ?? id),
    status: "active",
    data: asJson(data),
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: "active",
  });
  if (error) throw new Error(`seedNode ${id}: ${error.message}`);
}

const correction = (over: Partial<RawCorrection>): RawCorrection => ({
  target: "[[nvidia]]",
  field: "description",
  old: "",
  new: "the accelerated computing company",
  evidence: "the accelerated computing company",
  confidence: 0.9,
  kind: "value",
  ...over,
});

const SOURCE = "NVIDIA now describes itself as the accelerated computing company after pivoting from gaming.";

async function dataOf(id: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("id", id).single();
  return (data!.data ?? {}) as Record<string, unknown>;
}

describe("fact reconciliation — applyCorrections", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("applies a high-confidence, verified value correction and snapshots a revision", async () => {
    await seedNode("nvidia", "company", { name: "NVIDIA", ticker: "NVDA", description: "a graphics chip company" });
    const res = await applyCorrections(admin, TEST_GRAPH_ID, [correction({})], SOURCE, null, embed);
    expect(res).toEqual({ applied: 1, queued: 0, skipped: 0 });
    expect((await dataOf("nvidia")).description).toBe("the accelerated computing company");
    const { data: revs } = await admin.from("node_revisions").select("reason").eq("node_id", "nvidia");
    expect(revs!.map((r) => r.reason)).toContain("fact-correction");
  });

  it("queues a mid-confidence correction and leaves the node unchanged", async () => {
    await seedNode("nvidia", "company", { name: "NVIDIA", description: "a graphics chip company" });
    const res = await applyCorrections(admin, TEST_GRAPH_ID, [correction({ confidence: 0.7 })], SOURCE, null, embed);
    expect(res).toEqual({ applied: 0, queued: 1, skipped: 0 });
    expect((await dataOf("nvidia")).description).toBe("a graphics chip company"); // untouched
    const { data: q } = await admin.from("correction_queue").select("status, node_id").eq("graph_id", TEST_GRAPH_ID);
    expect(q!.length).toBe(1);
    expect(q![0].status).toBe("pending");
  });

  it("drops an unverified (paraphrased) correction — no change, no queue", async () => {
    await seedNode("nvidia", "company", { name: "NVIDIA", description: "a graphics chip company" });
    const res = await applyCorrections(admin, TEST_GRAPH_ID, [correction({ evidence: "a paraphrase not in the text" })], SOURCE, null, embed);
    expect(res).toEqual({ applied: 0, queued: 0, skipped: 1 });
    expect((await dataOf("nvidia")).description).toBe("a graphics chip company");
    const { count } = await admin.from("correction_queue").select("id", { count: "exact", head: true }).eq("graph_id", TEST_GRAPH_ID);
    expect(count).toBe(0);
  });

  it("a rename appends former_name/aliases and NEVER overwrites name", async () => {
    await seedNode("meta", "company", { name: "Meta", ticker: "META" });
    const src = "Facebook rebranded to Meta in 2021.";
    const res = await applyCorrections(
      admin,
      TEST_GRAPH_ID,
      [{ target: "[[meta]]", field: "name", old: "Facebook", new: "Meta", evidence: "Facebook rebranded to Meta", confidence: 0.95, kind: "rename" }],
      src,
      null,
      embed,
    );
    expect(res.applied).toBe(1);
    const d = await dataOf("meta");
    expect(d.name).toBe("Meta"); // identity key untouched
    expect(d.former_name).toBe("Facebook");
    expect(d.aliases).toContain("Facebook");
  });

  it("a relation_expiry updates role and retires the stale insider_of edge", async () => {
    await seedNode("jensen", "person", { name: "Jensen", role: "CEO" });
    await seedNode("acme", "company", { name: "Acme" });
    await admin.rpc("upsert_edge", { p_graph_id: TEST_GRAPH_ID, p_src_id: "jensen", p_dst_id: "acme", p_type: "insider_of", p_relation_type: "insider_of", p_method: "test", p_confidence: 0.9 });

    const src = "Jensen is no longer CEO of Acme; he stepped down last quarter.";
    const res = await applyCorrections(
      admin,
      TEST_GRAPH_ID,
      [{ target: "[[jensen]]", field: "role", old: "CEO", new: "former CEO", evidence: "Jensen is no longer CEO", confidence: 0.9, kind: "relation_expiry" }],
      src,
      null,
      embed,
    );
    expect(res.applied).toBe(1);
    expect((await dataOf("jensen")).role).toBe("former CEO");
    const { data: edges } = await admin.from("edges").select("id").eq("graph_id", TEST_GRAPH_ID).eq("src_id", "jensen").eq("relation_type", "insider_of");
    expect((edges ?? []).length).toBe(0); // expired
  });

  it("relation_expiry below the bar queues and does NOT delete the edge", async () => {
    await seedNode("jensen", "person", { name: "Jensen", role: "CEO" });
    await seedNode("acme", "company", { name: "Acme" });
    await admin.rpc("upsert_edge", { p_graph_id: TEST_GRAPH_ID, p_src_id: "jensen", p_dst_id: "acme", p_type: "insider_of", p_relation_type: "insider_of", p_method: "test", p_confidence: 0.9 });

    const src = "Rumors suggest Jensen may no longer be CEO.";
    const res = await applyCorrections(
      admin,
      TEST_GRAPH_ID,
      [{ target: "[[jensen]]", field: "role", old: "CEO", new: "former CEO", evidence: "Jensen may no longer be CEO", confidence: 0.7, kind: "relation_expiry" }],
      src,
      null,
      embed,
    );
    expect(res.queued).toBe(1);
    const { data: edges } = await admin.from("edges").select("id").eq("graph_id", TEST_GRAPH_ID).eq("src_id", "jensen").eq("relation_type", "insider_of");
    expect((edges ?? []).length).toBe(1); // still present
  });

  it("skips a correction targeting a non-permanent type", async () => {
    await seedNode("some-news", "news", { headline: "a story", description: "x" });
    const res = await applyCorrections(admin, TEST_GRAPH_ID, [correction({ target: "[[some-news]]" })], SOURCE, null, embed);
    expect(res.skipped).toBe(1);
    expect(res.applied).toBe(0);
  });
});

describe("fact reconciliation — end to end through the worker", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("applies a correction carried in the extraction envelope", async () => {
    const contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
    await seedNode("nvidia", "company", { name: "NVIDIA", description: "a graphics chip company" });
    const rawText = "NVIDIA now describes itself as the accelerated computing company.";
    const { error } = await admin.from("raw_uploads").insert({ graph_id: TEST_GRAPH_ID, contributor, kind: "text", raw_text: rawText, status: "pending" });
    if (error) throw new Error(error.message);

    const envelope: ExtractEnvelope = {
      notes: [],
      ambiguous: [],
      docNote: { title: "nvidia update", summary: "", tags: [] },
      relations: [],
      corrections: [{ target: "[[nvidia]]", field: "description", old: "a graphics chip company", new: "the accelerated computing company", evidence: "the accelerated computing company", confidence: 0.9, kind: "value" }],
    };
    const worker: WorkerDeps = { extract: async () => ({ envelope }), embed: async (t) => t.map(() => new Array(1536).fill(0)) };
    await drainPending(admin, worker);

    expect((await dataOf("nvidia")).description).toBe("the accelerated computing company");
  });
});
