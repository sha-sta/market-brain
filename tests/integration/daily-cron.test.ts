import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { runDailyForGraph } from "@/server/market/daily";
import { sendDigestForGraph } from "@/server/digest/send-digest";
import type { MarketDeps } from "@/server/market/types";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";

// The protected core, end-to-end against the real test DB with STUBBED market + worker: prices →
// snapshots, news → raw_uploads → drain → `news` node → ticker→holding `mentions` edge; plus brief
// idempotency. No live API.

const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;

const market: MarketDeps = {
  quote: async (t) => (t === "NVDA" ? { ticker: "NVDA", price: 1200, changePct: 3.2, marketCap: 3e12 } : null),
  news: async (t) =>
    t === "NVDA"
      ? [
          {
            headline: "NVIDIA beats earnings",
            url: "https://www.reuters.com/nvda?utm_source=x",
            source: "Reuters",
            summary: "NVIDIA beat estimates.",
            publishedAt: "2026-06-17T12:00:00Z",
            tickers: ["NVDA"],
          },
        ]
      : [],
  profile: async () => null,
};

const envelope: ExtractEnvelope = {
  notes: [
    {
      type: "news",
      id: "nvidia-beats",
      title: "NVIDIA beats earnings",
      frontmatter: {
        headline: "NVIDIA beats earnings",
        url: "https://www.reuters.com/nvda",
        tickers: ["NVDA"],
        sentiment: "bullish",
        materiality: "high",
        published_at: "2026-06-17",
      },
      body: "",
      tags: ["earnings"],
    },
  ],
  ambiguous: [],
  docNote: { title: "NVIDIA earnings", summary: "NVIDIA beat earnings.", tags: ["earnings"] },
  relations: [],
};

const worker: WorkerDeps = {
  extract: async () => ({ envelope }),
  embed: async (texts) => texts.map(() => new Array(1536).fill(0)),
};

describe("daily cron — fetch → graph → brief", () => {
  let contributorId: string;

  beforeAll(async () => {
    await cleanupAll();
    const admin = adminClient();
    const owner = await createUser("owner", { status: "active", isAdmin: true });
    contributorId = owner.id;
    await admin.from("nodes").upsert({
      id: "nvidia",
      graph_id: TEST_GRAPH_ID,
      type: "company",
      title: "NVIDIA",
      status: "owned",
      data: { name: "NVIDIA", ticker: "NVDA", is_public: true },
      tags: [],
      embedding: ZERO_VEC,
    });
    await admin.from("tracked_entities").upsert({ graph_id: TEST_GRAPH_ID, node_id: "nvidia", kind: "owned" });
  });

  afterAll(async () => {
    await cleanupAll();
  });

  it("snapshots prices, turns news into a node, and links it to the holding by ticker", async () => {
    const admin = adminClient();
    const nowMs = Date.now();
    const summary = await runDailyForGraph(admin, TEST_GRAPH_ID, { market, worker, contributorId, nowMs });

    expect(summary.snapshots).toBe(1);
    expect(summary.newsEnqueued).toBe(1);
    expect(summary.drained).toBeGreaterThanOrEqual(1);

    const { data: snaps } = await admin.from("price_snapshots").select("price").eq("graph_id", TEST_GRAPH_ID).eq("node_id", "nvidia");
    expect(snaps?.length).toBe(1);
    expect(Number(snaps![0].price)).toBe(1200);

    const { data: news } = await admin.from("nodes").select("id").eq("graph_id", TEST_GRAPH_ID).eq("type", "news");
    expect((news ?? []).length).toBeGreaterThanOrEqual(1);
    const newsId = news![0].id;

    const { data: edges } = await admin
      .from("edges")
      .select("relation_type")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("type", "mentions")
      .eq("src_id", newsId)
      .eq("dst_id", "nvidia");
    expect(edges?.length).toBe(1); // deterministic ticker→holding mentions edge
  });

  it("idempotent re-run does not re-enqueue the same article URL", async () => {
    const admin = adminClient();
    const summary = await runDailyForGraph(admin, TEST_GRAPH_ID, { market, worker, contributorId, nowMs: Date.now() });
    expect(summary.newsEnqueued).toBe(0); // already enqueued in the first run (source_ref dedup)
    expect(summary.newsSkipped).toBeGreaterThanOrEqual(1);
  });

  it("archives the brief when there is no recipient (status 'archived' persists)", async () => {
    const admin = adminClient();
    const { data: g } = await admin.from("graphs").insert({ name: "no-recipient" }).select("id").single();
    const r = await sendDigestForGraph(admin, g!.id, { sendBrief: async () => ({ ok: true }), nowMs: Date.now() });
    expect(r.status).toBe("archived"); // no `to` → composed + archived (not emailed)
    const { data: log } = await admin.from("digest_log").select("status").eq("graph_id", g!.id).maybeSingle();
    expect(log?.status).toBe("archived"); // the CHECK constraint accepts 'archived' (regression guard)
  });

  it("the brief sends once per ET day (idempotent)", async () => {
    const admin = adminClient();
    const nowMs = Date.now();
    const sent: string[] = [];
    const sendBrief = async (o: { to: string; subject: string; html: string }) => {
      sent.push(o.subject);
      return { ok: true, id: "fake-1" };
    };
    const r1 = await sendDigestForGraph(admin, TEST_GRAPH_ID, { sendBrief, to: "dad@local.test", nowMs });
    expect(r1.status).toBe("sent");
    const r2 = await sendDigestForGraph(admin, TEST_GRAPH_ID, { sendBrief, to: "dad@local.test", nowMs });
    expect(r2.status).toBe("skipped");
    expect(sent.length).toBe(1);
  });
});
