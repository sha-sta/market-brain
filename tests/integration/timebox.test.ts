import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "./_helpers";
import { drainPending } from "@/server/normalize/drain";
import { judgeTheses, type Judge } from "@/server/critic/thesis-judge";
import { runDailyForGraph } from "@/server/market/daily";
import { sendDigestForGraph } from "@/server/digest/send-digest";
import type { MarketDeps } from "@/server/market/types";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { JudgeOutput } from "@/server/critic/thesis-prompt";

// Commit 1 — time-box the daily run's two LLM-heavy steps (drain + thesis-judge) against a soft
// deadline so the single 300s cron always reserves budget for the digest, and cap news per company at
// ingest. Real test DB, STUBBED extract/embed/judge/market. The headline guarantee: a judge that would
// blow the budget can no longer starve the digest.

const ZERO_VEC = `[${new Array(1536).fill(0).join(",")}]`;
const admin = adminClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const minimalEnvelope: ExtractEnvelope = {
  notes: [],
  ambiguous: [],
  docNote: { title: "doc", summary: "a short summary", tags: [] },
  relations: [],
};

function worker(extractMs = 0): WorkerDeps {
  return {
    extract: async () => {
      if (extractMs > 0) await sleep(extractMs);
      return { envelope: minimalEnvelope };
    },
    embed: async (texts) => texts.map(() => new Array(1536).fill(0)),
  };
}

const slowJudge = (ms: number): Judge => async (): Promise<JudgeOutput> => {
  await sleep(ms);
  return { strength: "weak", rationale: "", bear_case: "", disconfirming: [], confirming: [], thin_reasoning_flags: [], edges: [] };
};

async function seedPendingUploads(contributor: string, n: number): Promise<void> {
  const rows = Array.from({ length: n }, (_, i) => ({
    graph_id: TEST_GRAPH_ID,
    contributor,
    kind: "text" as const,
    raw_text: `pending upload ${i}`,
    status: "pending" as const,
  }));
  const { error } = await admin.from("raw_uploads").insert(rows);
  if (error) throw new Error(`seedPendingUploads: ${error.message}`);
}

async function countUploads(status: string): Promise<number> {
  const { count } = await admin
    .from("raw_uploads")
    .select("id", { count: "exact", head: true })
    .eq("graph_id", TEST_GRAPH_ID)
    .eq("status", status);
  return count ?? 0;
}

async function seedTheses(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const { error } = await admin.from("nodes").insert({
      id: `thesis-${i}`,
      graph_id: TEST_GRAPH_ID,
      type: "thesis",
      title: `Thesis ${i}`,
      status: "active",
      data: { statement: `standalone thesis number ${i}`, about: [] },
      tags: [],
      embedding: ZERO_VEC,
      lifecycle: "active",
    });
    if (error) throw new Error(`seedTheses ${i}: ${error.message}`);
  }
}

async function countJudged(): Promise<number> {
  const { count } = await admin
    .from("nodes")
    .select("id", { count: "exact", head: true })
    .eq("graph_id", TEST_GRAPH_ID)
    .eq("type", "thesis")
    .not("last_judged_at", "is", null);
  return count ?? 0;
}

describe("time-box: drainPending soft deadline", () => {
  let contributor: string;
  beforeEach(async () => {
    await cleanupAll();
    contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
  });
  afterAll(cleanupAll);

  it("stops claiming once past the deadline (rows stay pending, never processing)", async () => {
    await seedPendingUploads(contributor, 12);
    const summary = await drainPending(admin, worker(), 5, { deadlineMs: Date.now() - 1_000 });
    expect(summary.processed).toBe(0);
    expect(await countUploads("pending")).toBe(12);
    expect(await countUploads("processing")).toBe(0); // no orphans
  });

  it("drains everything when the deadline is in the future", async () => {
    await seedPendingUploads(contributor, 12);
    const summary = await drainPending(admin, worker(), 5, { deadlineMs: Date.now() + 60_000 });
    expect(summary.processed).toBe(12);
    expect(await countUploads("pending")).toBe(0);
  });

  it("breaking mid-run between batches leaves no 'processing' orphans", async () => {
    await seedPendingUploads(contributor, 12);
    // Slow extract so the first batch (5) overruns the tight deadline; the loop breaks BEFORE the next
    // claim, so every claimed row finished (done/failed) and nothing is stranded as 'processing'.
    const summary = await drainPending(admin, worker(60), 5, { deadlineMs: Date.now() + 200 });
    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.processed).toBeLessThan(12); // partial
    expect(await countUploads("processing")).toBe(0);
    expect(await countUploads("pending")).toBeGreaterThanOrEqual(1);
  });
});

describe("time-box: judgeTheses soft deadline", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("stops at the deadline, leaving the rest unjudged", async () => {
    await seedTheses(5);
    const judged = await judgeTheses(admin, TEST_GRAPH_ID, { judge: slowJudge(120) }, { deadlineMs: Date.now() + 300 });
    expect(judged.length).toBeGreaterThanOrEqual(1);
    expect(judged.length).toBeLessThan(5); // time-boxed
    expect(await countJudged()).toBe(judged.length); // only the judged ones carry last_judged_at
  });

  it("resumes on a later run, picking the still-unjudged first (oldest-judged-first)", async () => {
    await seedTheses(5);
    const first = await judgeTheses(admin, TEST_GRAPH_ID, { judge: slowJudge(120) }, { deadlineMs: Date.now() + 300 });
    expect(first.length).toBeLessThan(5);

    // The theses left unjudged carry a NULL last_judged_at; nullsFirst ordering means the next run
    // judges exactly those first. Bound the next run's max to that count to prove the resume order.
    const { data: unjudged } = await admin
      .from("nodes")
      .select("id")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("type", "thesis")
      .is("last_judged_at", null);
    const remaining = (unjudged ?? []).length;
    expect(remaining).toBe(5 - first.length);

    const second = await judgeTheses(admin, TEST_GRAPH_ID, { judge: slowJudge(0) }, { max: remaining, deadlineMs: Date.now() + 60_000 });
    expect(second.length).toBe(remaining); // resumed exactly the still-unjudged ones first
    expect(await countJudged()).toBe(5); // all judged across the two runs
  });
});

describe("time-box: digest still sends when the judge is slow (headline)", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  it("a budget-blowing judge is time-boxed and the digest still sends", async () => {
    const contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
    await seedTheses(5);
    const noNews: MarketDeps = { quote: async () => null, news: async () => [], profile: async () => null };
    const nowMs = Date.now();

    const summary = await runDailyForGraph(admin, TEST_GRAPH_ID, {
      market: noNews,
      worker: worker(),
      contributorId: contributor,
      nowMs,
      judge: slowJudge(200), // 5 × 200ms = 1s, would blow a tight budget if unbounded
      deadlineMs: nowMs + 300, // forces the judge to yield partway
    });
    expect(summary.thesesJudged).toBeLessThan(5); // proves the judge was time-boxed

    const sent: string[] = [];
    const digest = await sendDigestForGraph(admin, TEST_GRAPH_ID, {
      sendBrief: async (o) => {
        sent.push(o.subject);
        return { ok: true, id: "fake" };
      },
      to: "user@local.test",
      nowMs,
    });
    expect(digest.status).toBe("sent"); // the digest is never starved by a slow judge
    expect(sent.length).toBe(1);
    const { data: log } = await admin.from("digest_log").select("status").eq("graph_id", TEST_GRAPH_ID).maybeSingle();
    expect(log?.status).toBe("sent");
  });
});

describe("ingest cap: per-company news limit", () => {
  let contributor: string;
  beforeEach(async () => {
    await cleanupAll();
    contributor = (await createUser("owner", { status: "active", isAdmin: true })).id;
    const { error } = await admin.from("nodes").insert({
      id: "capco",
      graph_id: TEST_GRAPH_ID,
      type: "company",
      title: "CapCo",
      status: "owned",
      data: { name: "CapCo", ticker: "CAPCO", is_public: true },
      tags: [],
      embedding: ZERO_VEC,
      lifecycle: "active",
    });
    if (error) throw new Error(error.message);
    await admin.from("tracked_entities").upsert({ graph_id: TEST_GRAPH_ID, node_id: "capco", kind: "owned" });
  });
  afterAll(cleanupAll);

  it("enqueues only the 8 newest articles per company", async () => {
    // 20 articles, publishedAt 2026-06-01 .. 2026-06-20. The 8 newest are days 13..20 (article-n13..n20).
    const articles = Array.from({ length: 20 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return {
        headline: `CapCo update ${i + 1}`,
        url: `https://example.com/article-n${i + 1}`,
        source: "Wire",
        summary: `body ${i + 1}`,
        publishedAt: `2026-06-${day}T12:00:00Z`,
        tickers: ["CAPCO"],
      };
    });
    const market: MarketDeps = {
      quote: async () => null,
      news: async (t) => (t === "CAPCO" ? articles : []),
      profile: async () => null,
    };

    const summary = await runDailyForGraph(admin, TEST_GRAPH_ID, {
      market,
      worker: worker(),
      contributorId: contributor,
      nowMs: Date.UTC(2026, 5, 21),
    });

    expect(summary.newsEnqueued).toBe(8);
    expect(summary.newsSkipped).toBeGreaterThanOrEqual(12);

    const { data: rows } = await admin
      .from("raw_uploads")
      .select("source_ref")
      .eq("graph_id", TEST_GRAPH_ID)
      .eq("kind", "news");
    const kept = (rows ?? []).map((r) => Number(/n(\d+)$/.exec(r.source_ref ?? "")?.[1]));
    expect(kept.length).toBe(8);
    expect(kept.sort((a, b) => a - b)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]); // the newest 8
  });
});
