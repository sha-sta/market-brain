import { test, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import type { RunArtifact } from "./types";

// Grounding-PRECISION spot check. verifyEvidence already guarantees an asserted edge's quote is a verbatim
// substring of the source; this measures the harder question it CAN'T: does that quote actually SUPPORT
// the claimed (subject, relation, object)? Samples up to 50 assertable edges, has an LLM judge (Sonnet)
// rule on each, and emits a full hand-review checklist. The CITED precision is the human review — the
// judge only triages. Run after eval:grounding: `npm run eval:precision`.

const OUT_DIR = join(process.cwd(), "scripts/eval/output");
const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const SAMPLE_CAP = 50;

interface JudgeItem {
  edgeIdx: number;
  docId: string;
  subject: string;
  relation: string;
  object: string;
  quote: string;
  supported: boolean;
  reason: string;
}

function parseJson(text: string): { supported: boolean; reason: string } {
  let t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1].trim();
  // The judge occasionally appends prose after the JSON object — extract the first {...} block so a
  // trailing sentence doesn't turn a valid verdict into a parse error (counted as unsupported).
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) t = obj[0];
  const parsed = JSON.parse(t) as { supported?: unknown; reason?: unknown };
  return { supported: parsed.supported === true, reason: String(parsed.reason ?? "") };
}

test("grounding precision — LLM-judge + hand-review checklist for asserted facts", async () => {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY missing (load .env.local)");
  const latest = join(OUT_DIR, "latest.txt");
  if (!existsSync(latest)) throw new Error("no run — run `npm run eval:grounding` first");
  const run: RunArtifact = JSON.parse(readFileSync(join(OUT_DIR, readFileSync(latest, "utf8").trim()), "utf8"));

  const nodeById = new Map(run.db.nodes.map((n) => [n.id, n]));
  const docByRow = new Map(run.docs.filter((d) => d.rowId).map((d) => [d.rowId as string, d]));

  // Sample: assertable edges that came from the extractor, with a resolvable source + endpoints. Stable
  // order (by src/dst/relation) so the sample is reproducible across re-runs of the judge.
  const candidates = run.db.edges
    .filter((e) => e.assertable === true && e.method === "llm_extract" && e.evidence_quote && e.source_upload_id)
    .filter((e) => nodeById.has(e.src_id) && nodeById.has(e.dst_id) && docByRow.has(e.source_upload_id as string))
    .sort((a, b) => (a.src_id + a.relation_type + a.dst_id).localeCompare(b.src_id + b.relation_type + b.dst_id));
  const sample = candidates.slice(0, SAMPLE_CAP);
  console.log(`Assertable edges: ${candidates.length}; judging ${sample.length}.`);

  const items: JudgeItem[] = [];
  for (let i = 0; i < sample.length; i += 1) {
    const e = sample[i];
    const subject = nodeById.get(e.src_id)!.title;
    const object = nodeById.get(e.dst_id)!.title;
    const doc = docByRow.get(e.source_upload_id as string)!;
    const source = doc.rawText.slice(0, 4000);
    const prompt = [
      "You are auditing a knowledge-graph fact for grounding. Given a SOURCE document, a claimed",
      "RELATIONSHIP, and the EVIDENCE quote the extractor cited, decide whether the quote — read in the",
      "context of the source — actually SUPPORTS the claimed relationship. Be strict: a quote that merely",
      "mentions both entities without stating the relationship is NOT support. A relationship in the wrong",
      "direction is NOT support.",
      "",
      `CLAIM: "${subject}" --[${e.relation_type}]--> "${object}"`,
      `EVIDENCE QUOTE: "${e.evidence_quote}"`,
      "",
      "SOURCE (excerpt):",
      source,
      "",
      'Reply with STRICT JSON only: {"supported": true|false, "reason": "<one sentence>"}',
    ].join("\n");

    let verdict = { supported: false, reason: "judge error" };
    try {
      const res = await generateText({ model: JUDGE_MODEL, prompt });
      verdict = parseJson(res.text);
    } catch (err) {
      verdict = { supported: false, reason: `judge error: ${(err as Error).message}` };
    }
    items.push({ edgeIdx: i, docId: doc.docId, subject, relation: e.relation_type, object, quote: e.evidence_quote ?? "", supported: verdict.supported, reason: verdict.reason });
    console.log(`  ${i + 1}/${sample.length} ${verdict.supported ? "OK " : "NO "} ${subject} -[${e.relation_type}]-> ${object}`);
  }

  const supported = items.filter((it) => it.supported).length;

  // Hand-review checklist: the user confirms/overrides each row; the CITED precision is this review.
  const rows = items
    .map(
      (it, i) =>
        `| ${i + 1} | ${it.docId} | ${it.subject} | \`${it.relation}\` | ${it.object} | ${it.quote.replace(/\|/g, "\\|").slice(0, 120)} | ${it.supported ? "✅" : "❌"} | ${it.reason.replace(/\|/g, "\\|")} | ☐ |`,
    )
    .join("\n");
  const md = `# Grounding precision — hand-review checklist (run ${run.runId})

Sample of ${items.length} **assertable** facts (the gate let these assert). \`verifyEvidence\` already
guarantees each quote is verbatim in the source; this checks it **semantically supports** the relation.
The LLM verdict is triage — set the **Human** box (✅/❌) yourself; the cited precision is your review.

LLM-judge: **${supported}/${items.length} supported (${items.length ? ((100 * supported) / items.length).toFixed(1) : "n/a"}%)**.

| # | doc | subject | relation | object | evidence quote | LLM | reason | Human |
|---|---|---|---|---|---|---|---|---|
${rows || "| _(no assertable edges to sample)_ |"}
`;

  writeFileSync(join(OUT_DIR, `precision-${run.runId}.md`), md);
  writeFileSync(join(OUT_DIR, "precision-latest.json"), JSON.stringify({ runId: run.runId, sampled: items.length, supported, items }, null, 2));
  console.log(`\nLLM-judge precision: ${supported}/${items.length}. Checklist -> scripts/eval/output/precision-${run.runId}.md`);
  expect(items.length).toBeGreaterThanOrEqual(0);
});
