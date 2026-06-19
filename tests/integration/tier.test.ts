import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { drainPending } from "@/server/normalize/drain";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";

// Commit 2 — the permanence `_tier` the extractor emits must survive validateNoteData (zod strips
// unknown keys) and land in nodes.data so the decay engine (Commit 3) can read it. Real DB, stub extractor.

const admin = adminClient();

const envelopeWithTier: ExtractEnvelope = {
  notes: [
    {
      type: "news",
      id: "capco-blip",
      title: "CapCo dips on light volume",
      frontmatter: {
        headline: "CapCo dips 2% on light volume",
        tickers: ["CAPCO"],
        sentiment: "neutral",
        materiality: "low",
        _tier: "ephemeral",
        published_at: "2026-06-18",
      },
      body: "",
      tags: ["trading"],
    },
  ],
  ambiguous: [],
  docNote: { title: "CapCo blip", summary: "A minor single-day move.", tags: ["trading"] },
  relations: [],
};

const worker: WorkerDeps = {
  extract: async () => ({ envelope: envelopeWithTier }),
  embed: async (texts) => texts.map(() => new Array(1536).fill(0)),
};

describe("permanence tier — end to end through the worker", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("persists the extractor's _tier onto the news node's data", async () => {
    const contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
    const { error } = await admin.from("raw_uploads").insert({
      graph_id: TEST_GRAPH_ID,
      contributor,
      kind: "news",
      source_ref: "https://example.com/capco-blip",
      raw_text: "HEADLINE: CapCo dips 2% on light volume\nTICKERS: CAPCO",
      status: "pending",
    });
    if (error) throw new Error(error.message);

    await drainPending(admin, worker);

    const { data: news } = await admin
      .from("nodes")
      .select("data")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("type", "news")
      .limit(1)
      .single();
    expect((news!.data as Record<string, unknown>)._tier).toBe("ephemeral");
  });
});
