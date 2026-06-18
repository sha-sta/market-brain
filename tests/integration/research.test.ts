import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { runResearchJob } from "@/server/research/run";
import type { WebSearchClient } from "@/server/market/websearch";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";

// The gated research loop end-to-end (real DB, STUB web + worker + synth): web findings -> manufactured
// raw_uploads -> drained into grounded nodes -> RAG read -> synthesis -> surfaced names promoted to
// tracked CANDIDATES (never active — the cost firewall).

const admin = adminClient();
const ZERO = new Array(1536).fill(0) as number[];

const newsEnvelope: ExtractEnvelope = {
  notes: [
    {
      type: "news",
      id: "hbm-supply-risk",
      title: "HBM supply risk rising",
      frontmatter: { headline: "HBM supply risk rising", summary: "HBM memory supply is tightening for AI accelerators." },
      body: "",
      tags: ["semiconductors"],
    },
  ],
  ambiguous: [],
  docNote: { title: "HBM research", summary: "HBM supply note", tags: [] },
  relations: [],
};

const worker: WorkerDeps = {
  extract: async () => ({ envelope: newsEnvelope }),
  embed: async (texts) => texts.map(() => ZERO),
};

const web: WebSearchClient = {
  search: async () => [
    {
      title: "HBM shortage deepens",
      url: "https://example.com/hbm-shortage",
      publishedAt: "2026-06-01",
      snippet: "HBM tight",
      text: "HBM memory supply is tightening across vendors as AI demand surges.",
    },
  ],
  fetchArticle: async () => null,
};

describe("research loop", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("web finding -> graph node -> synthesis -> candidate tracked entity", async () => {
    const owner = await createUser("research-owner", { status: "active", isAdmin: true });

    const result = await runResearchJob(
      admin,
      { id: "job-1", graph_id: TEST_GRAPH_ID, requester: owner.id, prompt: "HBM supply risk for AI accelerators" },
      {
        web,
        worker,
        synthesize: async (input) => ({
          summary: `Found ${input.findings.length} source(s) on HBM supply. Bear case: a demand air-pocket could ease tightness.`,
          trackNodeIds: input.findings.map((f) => f.id),
        }),
        nowMs: Date.now(),
      },
    );

    expect(result.enqueued).toBe(1); // one finding manufactured into a raw_upload
    expect(result.nodesCreated).toBeGreaterThanOrEqual(1); // drained into the graph
    expect(result.summary).toContain("HBM");

    // A grounded news node now exists.
    const { data: news } = await admin.from("nodes").select("id").eq("graph_id", TEST_GRAPH_ID).eq("type", "news");
    expect((news ?? []).length).toBeGreaterThanOrEqual(1);

    // The surfaced finding was promoted to a tracked CANDIDATE (source=auto), never active.
    const { data: cands } = await admin
      .from("tracked_entities")
      .select("candidate_status, source")
      .eq("graph_id", TEST_GRAPH_ID);
    expect((cands ?? []).some((c) => c.candidate_status === "candidate" && c.source === "auto")).toBe(true);
    expect((cands ?? []).every((c) => c.candidate_status !== "active")).toBe(true); // never auto-activated
  });

  it("is idempotent: re-running the same finding doesn't re-manufacture the upload", async () => {
    const owner = await createUser("research-owner2", { status: "active" });
    const job = { id: "job-2", graph_id: TEST_GRAPH_ID, requester: owner.id, prompt: "HBM supply risk" };
    const deps = { web, worker, synthesize: async () => ({ summary: "ok" }), nowMs: Date.now() };
    await runResearchJob(admin, job, deps);
    const second = await runResearchJob(admin, job, deps);
    expect(second.enqueued).toBe(0); // source_ref dedupe across runs
  });
});
