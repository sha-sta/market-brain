import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { runDailyForGraph } from "@/server/market/daily";
import type { MarketDeps } from "@/server/market/types";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;

const EMPTY_ENVELOPE: ExtractEnvelope = {
  notes: [],
  ambiguous: [],
  docNote: { title: "", summary: "", tags: [] },
  relations: [],
};
const worker: WorkerDeps = {
  extract: async () => ({ envelope: EMPTY_ENVELOPE }),
  embed: async (texts) => texts.map(() => new Array(1536).fill(0)),
};

async function seedCompany(id: string, ticker: string): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "company",
    title: id.toUpperCase(),
    status: "mentioned",
    data: { name: id.toUpperCase(), ticker, is_public: true },
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: "active",
  });
  if (error) throw new Error(`seedCompany: ${error.message}`);
}

describe("tracking CRUD — RLS + defaults", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("an active user follows (defaults manual/active); a denied user is blocked; unfollow works", async () => {
    await seedCompany("nvidia", "NVDA");
    const active = await createUser("active-follower", { status: "active" });
    const denied = await createUser("denied-follower", { status: "denied" });

    const ins = await active.client.from("tracked_entities").insert({ graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned" });
    expect(ins.error).toBeNull();

    const { data: row } = await admin
      .from("tracked_entities")
      .select("source, candidate_status")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("node_id", "nvidia")
      .single();
    expect(row!.source).toBe("manual");
    expect(row!.candidate_status).toBe("active");

    const insDenied = await denied.client.from("tracked_entities").insert({ graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "watchlist" });
    expect(insDenied.error).not.toBeNull(); // RLS with-check is_active() blocks a non-active user

    const del = await active.client.from("tracked_entities").delete().eq("graph_id", TEST_GRAPH_ID).eq("node_id", "nvidia");
    expect(del.error).toBeNull();
    const { data: after } = await admin.from("tracked_entities").select("node_id").eq("graph_id", TEST_GRAPH_ID);
    expect(after!.length).toBe(0);
  });
});

describe("auto-discovery cost firewall", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("the daily fetch snapshots ACTIVE tracked companies but never candidates", async () => {
    const owner = await createUser("firewall-owner", { status: "active", isAdmin: true });
    await seedCompany("nvidia", "NVDA");
    await seedCompany("amd", "AMD");
    // NB: a multi-row insert with differing keys writes explicit NULL for an omitted key (PostgREST
    // unions the columns), so set source on BOTH rows — the real one-row followEntity gets the default.
    const trk = await admin.from("tracked_entities").insert([
      { graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned", source: "manual", candidate_status: "active" },
      { graph_id: TEST_GRAPH_ID, node_id: "amd", kind: "discovered", source: "auto", candidate_status: "candidate" },
    ]);
    expect(trk.error).toBeNull();
    const { data: activeRows } = await admin
      .from("tracked_entities")
      .select("node_id")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("candidate_status", "active");
    expect(activeRows!.map((r) => r.node_id)).toEqual(["nvidia"]);

    const market: MarketDeps = {
      quote: async (t) => ({ ticker: t, price: 100, changePct: 1, marketCap: 1e9 }),
      news: async () => [],
      profile: async () => null,
    };

    const summary = await runDailyForGraph(admin, TEST_GRAPH_ID, { market, worker, contributorId: owner.id, nowMs: Date.now() });
    expect(summary.snapshots).toBe(1); // only the ACTIVE company was fetched
    const { data: snaps } = await admin.from("price_snapshots").select("ticker").eq("graph_id", TEST_GRAPH_ID);
    expect(snaps!.map((s) => s.ticker)).toEqual(["NVDA"]);
  });
});
