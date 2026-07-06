import { test, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { adminClient, cleanupAll, createUser, TEST_GRAPH_ID } from "../../tests/integration/_helpers";
import { drainPending, liveDeps } from "@/server/normalize/drain";
import type { WorkerDeps } from "@/server/normalize/worker";
import type { ExtractEnvelope } from "@/server/normalize/extract-schema";
import type { CorpusDoc, PerDocCapture, DbEdge, DbNode, RunArtifact } from "./types";

// LIVE grounding-eval pass. Runs the REAL extractor (AI Gateway) + REAL embeddings over the pinned corpus
// in the ISOLATED test DB, one doc at a time, teeing every LLM envelope to disk. The single run yields
// BOTH the raw proposed relations (the "strong-proposed" denominator, invisible in the post-gate DB) and
// the production edges (with the DB-computed `assertable` column) — so scoring can compute the gate catch
// rate offline AND cross-check it against what production actually persisted. Spends real credits.
//
//   npm run db:test:start && npm run db:test:reset   # isolated local DB, ports 5533x
//   npm run eval:fetch-corpus                         # once — pins scripts/eval/corpus/
//   npm run eval:grounding                            # this file

const OUT_DIR = join(process.cwd(), "scripts/eval/output");
const CORPUS_DIR = join(process.cwd(), "scripts/eval/corpus");

function assertLocalDb(): void {
  const url = process.env.SUPABASE_URL ?? "";
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    throw new Error(`refusing to run: SUPABASE_URL is not local (${url}). The eval must target the test DB.`);
  }
}

function tickerOf(data: unknown): string | null {
  if (data && typeof data === "object" && "ticker" in data) {
    const t = (data as Record<string, unknown>).ticker;
    return t ? String(t) : null;
  }
  return null;
}

test("grounding eval — extract pinned corpus, capture proposals + production edges", async () => {
  assertLocalDb();
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY missing (load .env.local)");

  const docs: CorpusDoc[] = JSON.parse(readFileSync(join(CORPUS_DIR, "docs.json"), "utf8"));
  const manifestRaw = readFileSync(join(CORPUS_DIR, "manifest.json"), "utf8");
  const manifestSha = createHash("sha256").update(manifestRaw).digest("hex").slice(0, 16);
  expect(docs.length).toBeGreaterThan(0);

  await cleanupAll();
  const admin = adminClient();
  const contributor = (await createUser("eval-owner", { status: "active", isAdmin: true })).id;

  // Tee the live extractor: capture every (chunk, envelope) into a buffer we reset per doc.
  let buffer: ExtractEnvelope[] = [];
  const base = liveDeps(admin);
  const deps: WorkerDeps = {
    ...base,
    extract: async (rawText, typeSpec, errors, existing) => {
      const res = await base.extract(rawText, typeSpec, errors, existing);
      buffer.push(res.envelope);
      return res;
    },
  };

  const perDoc: PerDocCapture[] = [];
  for (const doc of docs) {
    const ins = await admin
      .from("raw_uploads")
      .insert({
        graph_id: TEST_GRAPH_ID,
        contributor,
        kind: doc.kind === "news" ? "news" : "text",
        source_ref: doc.source_ref,
        raw_text: doc.raw_text,
        status: "pending",
      })
      .select("id")
      .single();
    if (ins.error) throw new Error(`insert ${doc.id}: ${ins.error.message}`);

    buffer = []; // scope captures to this doc
    await drainPending(admin, deps); // only this row is pending -> processes just this doc (real LLM)

    perDoc.push({
      docId: doc.id,
      kind: doc.kind,
      source_ref: doc.source_ref,
      ticker: doc.ticker,
      rawText: doc.raw_text,
      rowId: ins.data.id,
      notes: buffer.flatMap((e) => (e.notes ?? []).map((n) => ({ type: n.type, title: n.title, frontmatter: n.frontmatter }))),
      relations: buffer.flatMap((e) => (e.relations ?? []).map((r) => ({ subject: r.subject, relation: r.relation, object: r.object, evidence: r.evidence }))),
      corrections: buffer.flatMap((e) =>
        (e.corrections ?? []).map((c) => ({ target: c.target, field: c.field, new: c.new, evidence: c.evidence, confidence: c.confidence, kind: c.kind })),
      ),
    });
    const rels = perDoc[perDoc.length - 1].relations.length;
    console.log(`  ${doc.id}: ${rels} relations proposed`);
  }

  // Snapshot what production actually persisted (post-gate), incl. the DB-computed `assertable` column.
  const edgesRes = await admin
    .from("edges")
    .select("relation_type,confidence,evidence_quote,assertable,method,src_id,dst_id,source_upload_id")
    .eq("graph_id", TEST_GRAPH_ID);
  if (edgesRes.error) throw new Error(edgesRes.error.message);
  const nodesRes = await admin.from("nodes").select("id,type,title,data").eq("graph_id", TEST_GRAPH_ID);
  if (nodesRes.error) throw new Error(nodesRes.error.message);
  const mcRes = await admin.from("node_merge_candidates").select("id", { count: "exact", head: true }).eq("graph_id", TEST_GRAPH_ID);

  const edges: DbEdge[] = (edgesRes.data ?? []).map((e) => ({
    relation_type: e.relation_type,
    confidence: e.confidence,
    evidence_quote: e.evidence_quote,
    assertable: e.assertable,
    method: e.method,
    src_id: e.src_id,
    dst_id: e.dst_id,
    source_upload_id: e.source_upload_id,
  }));
  const nodes: DbNode[] = (nodesRes.data ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, ticker: tickerOf(n.data) }));

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifact: RunArtifact = {
    runId,
    generatedAt: new Date().toISOString(),
    manifestSha,
    extractor: "Vercel AI Gateway — Haiku-first, escalates to Sonnet on retry/long chunk (src/server/normalize/model.ts)",
    docs: perDoc,
    db: { edges, nodes, mergeCandidates: mcRes.count ?? 0 },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `run-${runId}.json`), JSON.stringify(artifact, null, 2));
  writeFileSync(join(OUT_DIR, "latest.txt"), `run-${runId}.json`);

  const totalRels = perDoc.reduce((a, d) => a + d.relations.length, 0);
  console.log(`\nRun ${runId}: ${perDoc.length} docs, ${totalRels} proposed relations, ${edges.length} edges, ${nodes.length} nodes.`);
  console.log(`Artifact -> scripts/eval/output/run-${runId}.json  (now: npm run eval:score)`);
  expect(totalRels).toBeGreaterThan(0);
});
