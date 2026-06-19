import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, TEST_GRAPH_ID } from "./_helpers";
import { detectStructuralGaps, gapFillStructure } from "@/server/market/gap-fill";
import { makeFinanceEnricher } from "@/server/market/enrich";
import { drainPending } from "@/server/normalize/drain";
import type { EntityEnricher } from "@/server/normalize/worker";
import type { MarketDeps } from "@/server/market/types";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { Json } from "@/lib/database.types";

// Commit 6 — the gap-fill pass grounds essential identity facts on tracked companies (no LLM), bounded +
// throttled + deadline-guarded so it never grows the graph with noise. Plus a Q8 regression: research-
// sourced content inherits the tier pipeline for free.

const admin = adminClient();
const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const asJson = (v: unknown): Json => v as Json;
const NOW = Date.UTC(2026, 5, 21);
const DAY = 86_400_000;

async function seedCompany(id: string, data: Record<string, unknown>, tracked = true): Promise<void> {
  const { error } = await admin.from("nodes").insert({
    id,
    graph_id: TEST_GRAPH_ID,
    type: "company",
    title: String(data.name ?? id),
    status: "active",
    data: asJson(data),
    tags: [],
    embedding: ZERO_VEC,
    lifecycle: "active",
  });
  if (error) throw new Error(`seedCompany ${id}: ${error.message}`);
  if (tracked) await admin.from("tracked_entities").upsert({ graph_id: TEST_GRAPH_ID, node_id: id, kind: "owned", candidate_status: "active" });
}

async function setLastGapFill(iso: string | null): Promise<void> {
  await admin.from("graphs").update({ last_gap_fill_at: iso }).eq("id", TEST_GRAPH_ID);
}

describe("gap-fill — detection", () => {
  beforeEach(async () => {
    await cleanupAll();
    await setLastGapFill(null);
  });
  afterAll(cleanupAll);

  it("finds tracked public companies with a ticker but no grounding; excludes private/grounded/untracked", async () => {
    await seedCompany("pub-gap", { name: "PubGap", ticker: "GAP", is_public: true });
    await seedCompany("private-co", { name: "PrivCo", ticker: "X", is_public: false });
    await seedCompany("grounded", { name: "Grounded", ticker: "GR", market_provenance: { source: "market" } });
    await seedCompany("no-ticker", { name: "NoTicker", is_public: true });
    await seedCompany("untracked", { name: "Untracked", ticker: "UT", is_public: true }, false);

    const gaps = await detectStructuralGaps(admin, TEST_GRAPH_ID);
    expect(gaps).toEqual(["pub-gap"]);
  });
});

describe("gap-fill — throttle, cap, deadline", () => {
  beforeEach(async () => {
    await cleanupAll();
    await setLastGapFill(null);
  });
  afterAll(cleanupAll);

  it("does nothing (and never calls the enricher) when not due", async () => {
    await setLastGapFill(new Date(NOW - 1 * DAY).toISOString());
    let calls = 0;
    const enrich: EntityEnricher = async (nodeId) => {
      calls += 1;
      return { nodeId, enriched: true, fieldsFilled: ["cik"], skipped: null };
    };
    const r = await gapFillStructure(admin, TEST_GRAPH_ID, { nowMs: NOW, enrich });
    expect(r.due).toBe(false);
    expect(calls).toBe(0);
  });

  it("when due, grounds up to maxPerRun gaps and resets the weekly clock", async () => {
    for (let i = 0; i < 5; i++) await seedCompany(`co-${i}`, { name: `Co${i}`, ticker: `T${i}`, is_public: true });
    let calls = 0;
    const enrich: EntityEnricher = async (nodeId) => {
      calls += 1;
      return { nodeId, enriched: true, fieldsFilled: ["cik"], skipped: null };
    };
    const r = await gapFillStructure(admin, TEST_GRAPH_ID, { nowMs: NOW, enrich, maxPerRun: 3 });
    expect(r.due).toBe(true);
    expect(r.attempted).toBe(3); // capped
    expect(calls).toBe(3);
    const { data: g } = await admin.from("graphs").select("last_gap_fill_at").eq("id", TEST_GRAPH_ID).single();
    expect(g!.last_gap_fill_at).not.toBeNull(); // clock reset so it won't re-run tomorrow
  });

  it("respects the deadline (attempts nothing once past it, but still advances the clock)", async () => {
    await seedCompany("co", { name: "Co", ticker: "T", is_public: true });
    let calls = 0;
    const enrich: EntityEnricher = async (nodeId) => {
      calls += 1;
      return { nodeId, enriched: true, fieldsFilled: [], skipped: null };
    };
    const r = await gapFillStructure(admin, TEST_GRAPH_ID, { nowMs: NOW, enrich, deadlineMs: Date.now() - 1000 });
    expect(r.due).toBe(true);
    expect(r.attempted).toBe(0);
    expect(calls).toBe(0);
  });

  it("grounds a real gap company through the finance enricher (cik/exchange filled)", async () => {
    await seedCompany("nvidia", { name: "NVIDIA", ticker: "NVDA", is_public: true });
    const market: MarketDeps = {
      quote: async () => null,
      news: async () => [],
      profile: async (t) => (t === "NVDA" ? { ticker: "NVDA", name: "NVIDIA", exchange: "NASDAQ", sector: "Technology", cik: "0001045810", marketCap: null, website: "https://nvidia.com" } : null),
    };
    const r = await gapFillStructure(admin, TEST_GRAPH_ID, { nowMs: NOW, enrich: makeFinanceEnricher(admin, market) });
    expect(r.filled).toBe(1);
    const { data: node } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("id", "nvidia").single();
    const d = node!.data as Record<string, unknown>;
    expect(d.cik).toBe("0001045810");
    expect(d.market_provenance).toBeTruthy(); // now grounded -> won't be a gap next week
  });
});

describe("research inheritance (Q8) — research-sourced content rides the same tier pipeline", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("a research/cron-sourced news upload drains into a node carrying its _tier", async () => {
    const { error } = await admin.from("raw_uploads").insert({
      graph_id: TEST_GRAPH_ID,
      contributor: (await admin.auth.admin.createUser({ email: `gap-${Date.now()}@local.test`, password: "test-password-123", email_confirm: true })).data.user!.id,
      kind: "news", // how research + the cron manufacture uploads
      source_ref: "https://example.com/research-finding",
      raw_text: "HEADLINE: A routine sector update",
      status: "pending",
    });
    if (error) throw new Error(error.message);

    const envelope: ExtractEnvelope = {
      notes: [{ type: "news", id: "sector-update", title: "A routine sector update", frontmatter: { headline: "A routine sector update", _tier: "routine" }, body: "", tags: [] }],
      ambiguous: [],
      docNote: { title: "update", summary: "", tags: [] },
      relations: [],
    };
    const worker: WorkerDeps = { extract: async () => ({ envelope }), embed: async (t) => t.map(() => new Array(1536).fill(0)) };
    await drainPending(admin, worker);

    const { data: news } = await admin.from("nodes").select("data").eq("graph_id", TEST_GRAPH_ID).eq("type", "news").limit(1).single();
    expect((news!.data as Record<string, unknown>)._tier).toBe("routine"); // inherits Commit 2 (and thus Commit 3 decay) for free
  });
});
