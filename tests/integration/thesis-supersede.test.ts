import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { detectThesisSupersede, applyThesisSupersede } from "@/server/critic/thesis-supersede";
import { judgeTheses, type Judge } from "@/server/critic/thesis-judge";
import { uploadText } from "@/lib/dump";
import { drainPending } from "@/server/normalize/drain";
import { formatThesisDump } from "@/app/(app)/theses/thesis-input";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { Json } from "@/lib/database.types";

// Commit 4 — thesis replacement: detect a near-restatement (shared subject + high embedding similarity)
// and auto-supersede the old thesis via writeNodeData; the judge then ignores it. Plus the add-thesis
// pipeline reuse (uploadText -> drain -> a thesis node). Real DB.

const admin = adminClient();
const asJson = (v: unknown): Json => v as Json;

// A 1536-dim one-hot vector + its array form, so match_nodes' cosine similarity is deterministic.
const oneHot = (i: number): number[] => {
  const a = new Array(1536).fill(0);
  a[i] = 1;
  return a;
};
const vecLit = (i: number) => `[${oneHot(i).join(",")}]`;
const embedReturning = (i: number) => async (): Promise<number[]> => oneHot(i);

async function seedThesis(id: string, about: string[], embeddingIdx: number, lifecycle = "active"): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "thesis",
    title: id,
    status: "active",
    data: asJson({ statement: `thesis ${id}`, about }),
    tags: [],
    embedding: vecLit(embeddingIdx),
    lifecycle,
  });
  if (error) throw new Error(`seedThesis ${id}: ${error.message}`);
}

describe("thesis supersede — detect + apply", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("flags a near-restatement about the same subject", async () => {
    await seedThesis("thesis-a", ["[[nvidia]]"], 0); // stored embedding = oneHot(0)
    await seedThesis("thesis-b", ["[[nvidia]]"], 5);
    // B's statement re-embeds to oneHot(0) -> cosine 1.0 vs A -> near-restatement, shared subject.
    const cand = await detectThesisSupersede(admin, TEST_GRAPH_ID, { id: "thesis-b", data: { statement: "x", about: ["[[nvidia]]"] } }, embedReturning(0));
    expect(cand).not.toBeNull();
    expect(cand!.oldId).toBe("thesis-a");
    expect(cand!.newId).toBe("thesis-b");
    expect(cand!.similarity).toBeGreaterThanOrEqual(0.92);
  });

  it("does NOT supersede when the subject differs (even at high similarity)", async () => {
    await seedThesis("thesis-a", ["[[nvidia]]"], 0);
    await seedThesis("thesis-b", ["[[tsmc]]"], 5);
    const cand = await detectThesisSupersede(admin, TEST_GRAPH_ID, { id: "thesis-b", data: { statement: "x", about: ["[[tsmc]]"] } }, embedReturning(0));
    expect(cand).toBeNull();
  });

  it("does NOT supersede a dissimilar thesis on the same subject", async () => {
    await seedThesis("thesis-a", ["[[nvidia]]"], 0);
    await seedThesis("thesis-b", ["[[nvidia]]"], 5);
    // B re-embeds to an orthogonal vector -> cosine 0 -> below the 0.92 bar.
    const cand = await detectThesisSupersede(admin, TEST_GRAPH_ID, { id: "thesis-b", data: { statement: "x", about: ["[[nvidia]]"] } }, embedReturning(42));
    expect(cand).toBeNull();
  });

  it("applyThesisSupersede marks the old thesis superseded (via writeNodeData) and snapshots a revision", async () => {
    await seedThesis("thesis-a", ["[[nvidia]]"], 0);
    await seedThesis("thesis-b", ["[[nvidia]]"], 5);
    const ok = await applyThesisSupersede(admin, TEST_GRAPH_ID, { oldId: "thesis-a", newId: "thesis-b", similarity: 0.97 });
    expect(ok).toBe(true);

    const { data: old } = await admin.from("nodes").select("lifecycle, superseded_by").eq("graph_id", TEST_GRAPH_ID).eq("id", "thesis-a").single();
    expect(old!.lifecycle).toBe("superseded"); // satisfies the 0034 invariant (superseded_by => superseded)
    expect(old!.superseded_by).toBe("thesis-b");
    const { data: revs } = await admin.from("node_revisions").select("reason").eq("node_id", "thesis-a");
    expect(revs!.map((r) => r.reason)).toContain("thesis-supersede");
  });

  it("a superseded thesis is invisible to the judge", async () => {
    await seedThesis("thesis-a", ["[[nvidia]]"], 0);
    await seedThesis("thesis-b", ["[[nvidia]]"], 5);
    await applyThesisSupersede(admin, TEST_GRAPH_ID, { oldId: "thesis-a", newId: "thesis-b", similarity: 0.97 });

    const stub: Judge = async () => ({ strength: "weak", rationale: "", bear_case: "", disconfirming: [], confirming: [], thin_reasoning_flags: [], edges: [] });
    const judged = await judgeTheses(admin, TEST_GRAPH_ID, { judge: stub });
    expect(judged.length).toBe(1); // only the live successor is judged
    expect(judged[0].thesisId).toBe("thesis-b");
  });
});

describe("add-thesis pipeline — reuses uploadText -> drain", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("pipes thesis text through the dump pipeline into a thesis node", async () => {
    const contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
    const { id } = await uploadText(admin, contributor, TEST_GRAPH_ID, formatThesisDump("NVIDIA dominates AI compute", "[[nvidia]]"));

    // Before drain: a pending raw_uploads row exists; no thesis node yet.
    const { data: upload } = await admin.from("raw_uploads").select("status, kind").eq("id", id).single();
    expect(upload!.status).toBe("pending");
    const { count: before } = await admin.from("nodes").select("id", { count: "exact", head: true }).eq("graph_id", TEST_GRAPH_ID).eq("type", "thesis");
    expect(before).toBe(0);

    // Drain with a stub extractor that emits a thesis (the live extractor does this from the THESIS: text).
    const envelope: ExtractEnvelope = {
      notes: [{ type: "thesis", id: "nvda-thesis", title: "NVIDIA dominates AI compute", frontmatter: { statement: "NVIDIA dominates AI compute", about: ["[[nvidia]]"] }, body: "", tags: [] }],
      ambiguous: [],
      docNote: { title: "thesis", summary: "a thesis", tags: [] },
      relations: [],
    };
    const worker: WorkerDeps = { extract: async () => ({ envelope }), embed: async (t) => t.map(() => new Array(1536).fill(0)) };
    await drainPending(admin, worker);

    const { count: after } = await admin.from("nodes").select("id", { count: "exact", head: true }).eq("graph_id", TEST_GRAPH_ID).eq("type", "thesis");
    expect(after).toBe(1);
  });
});
