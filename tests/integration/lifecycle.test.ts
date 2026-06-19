import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { upsertNode } from "@/server/normalize/upsert";
import { archiveStaleNews } from "@/server/market/daily";
import { searchNodes } from "@/lib/graph";
import type { NodeRecord } from "@/server/normalize/types";
import type { Json } from "@/lib/database.types";

// The living graph, end-to-end against the real test DB: a newer source SUPERSEDES a stale narrative
// field (with a revision + freshness bump), stale news ARCHIVES (and drops out of search), and old
// price snapshots PRUNE down to weekly.

const admin = adminClient();
const ZERO_VEC = new Array(1536).fill(0) as number[];
const vecLiteral = (v: number[]) => `[${v.join(",")}]`;
const stubEmbed = async (): Promise<number[]> => ZERO_VEC;
const asObj = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;
const asJson = (v: unknown): Json => v as Json;
const DAY = 86_400_000;

async function seedCompany(id: string, data: Record<string, unknown>, dataAsOf: string): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "company",
    title: String(data.name ?? id),
    status: "mentioned",
    data: asJson(data),
    tags: [],
    embedding: vecLiteral(ZERO_VEC),
    lifecycle: "active",
    data_as_of: dataAsOf,
  });
  if (error) throw new Error(`seedCompany: ${error.message}`);
}

async function seedNews(id: string, headline: string, data: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "news",
    title: headline,
    status: "active",
    data: asJson(data),
    tags: [],
    embedding: vecLiteral(ZERO_VEC),
    lifecycle: "active",
  });
  if (error) throw new Error(`seedNews: ${error.message}`);
}

async function seedSnap(nodeId: string, capturedAtMs: number): Promise<void> {
  const { error } = await admin.from("price_snapshots").insert({
    graph_id: TEST_GRAPH_ID,
    node_id: nodeId,
    ticker: "NVDA",
    price: 1000,
    change_pct: 1,
    captured_at: new Date(capturedAtMs).toISOString(),
  });
  if (error) throw new Error(`seedSnap: ${error.message}`);
}

describe("living graph — supersede on re-ingest", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("a NEWER source overwrites a stale narrative field, writes a revision, bumps data_as_of", async () => {
    const old = new Date(Date.UTC(2026, 0, 1)).toISOString();
    await seedCompany("nvidia", { name: "NVIDIA", ticker: "NVDA", description: "old view" }, old);

    const incoming: NodeRecord = {
      id: "nvidia",
      type: "company",
      title: "NVIDIA",
      status: "mentioned",
      tags: [],
      relatesTo: [],
      source: "upload",
      data: { name: "NVIDIA", ticker: "NVDA", description: "new AI accelerator view" },
    };
    const nowMs = Date.UTC(2026, 5, 1);
    const res = await upsertNode(admin, incoming, [], null, TEST_GRAPH_ID, { supersede: true, nowMs, embed: stubEmbed });
    expect(res.action).toBe("merged");

    const { data: node } = await admin
      .from("nodes")
      .select("data, data_as_of")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("id", "nvidia")
      .single();
    expect(asObj(node!.data).description).toBe("new AI accelerator view");
    expect(Date.parse(node!.data_as_of!)).toBe(nowMs);

    const { data: revs } = await admin
      .from("node_revisions")
      .select("reason, prior_data")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("node_id", "nvidia");
    expect(revs!.length).toBe(1);
    expect(revs![0].reason).toBe("supersede");
    expect(asObj(revs![0].prior_data).description).toBe("old view");
  });

  it("an OLDER source never clobbers a fresh fact (no overwrite, no revision)", async () => {
    const recent = new Date(Date.UTC(2026, 5, 1)).toISOString();
    await seedCompany("amd", { name: "AMD", ticker: "AMD", description: "current view" }, recent);

    const incoming: NodeRecord = {
      id: "amd",
      type: "company",
      title: "AMD",
      status: "mentioned",
      tags: [],
      relatesTo: [],
      source: "upload",
      data: { name: "AMD", ticker: "AMD", description: "stale backfill" },
    };
    await upsertNode(admin, incoming, [], null, TEST_GRAPH_ID, { supersede: true, nowMs: Date.UTC(2026, 0, 1), embed: stubEmbed });

    const { data: node } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("id", "amd").single();
    expect(asObj(node!.data).description).toBe("current view");
    const { data: revs } = await admin.from("node_revisions").select("id").eq("node_id", "amd");
    expect(revs!.length).toBe(0);
  });
});

describe("living graph — news archival", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("archives stale news (hidden from search) and keeps fresh news", async () => {
    const nowMs = Date.UTC(2026, 5, 1);
    await seedNews("old-news", "Old NVDA story", {
      headline: "Old NVDA story",
      published_at: new Date(nowMs - 200 * DAY).toISOString(),
      materiality: "low",
    });
    await seedNews("fresh-news", "Fresh NVDA story", {
      headline: "Fresh NVDA story",
      published_at: new Date(nowMs - 2 * DAY).toISOString(),
      materiality: "low",
    });

    const archived = await archiveStaleNews(admin, TEST_GRAPH_ID, nowMs);
    expect(archived).toBe(1);

    const { data: oldNode } = await admin.from("nodes").select("lifecycle").eq("graph_id", TEST_GRAPH_ID).eq("id", "old-news").single();
    expect(oldNode!.lifecycle).toBe("archived");
    const { data: freshNode } = await admin.from("nodes").select("lifecycle").eq("graph_id", TEST_GRAPH_ID).eq("id", "fresh-news").single();
    expect(freshNode!.lifecycle).toBe("active");

    const results = await searchNodes(admin, "NVDA story", TEST_GRAPH_ID);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("fresh-news");
    expect(ids).not.toContain("old-news");

    const { data: revs } = await admin.from("node_revisions").select("reason").eq("node_id", "old-news");
    expect(revs!.map((r) => r.reason)).toContain("archive");
  });
});

describe("living graph — snapshot prune", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("downsamples >90d price snapshots to one per week, keeps recent dailies", async () => {
    await seedCompany("nvidia", { name: "NVIDIA", ticker: "NVDA" }, new Date().toISOString());
    const now = Date.now();
    const old = now - 120 * DAY; // same day (hours apart) => same ISO week => collapses to 1
    await seedSnap("nvidia", old);
    await seedSnap("nvidia", old + 3_600_000);
    await seedSnap("nvidia", old + 7_200_000);
    await seedSnap("nvidia", now - 5 * DAY); // recent (<90d) => kept

    const { error } = await admin.rpc("prune_snapshots", { p_graph_id: TEST_GRAPH_ID });
    expect(error).toBeNull();

    const { data: snaps } = await admin.from("price_snapshots").select("captured_at").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "nvidia");
    expect(snaps!.length).toBe(2); // 1 weekly survivor (old) + 1 recent daily
  });
});
