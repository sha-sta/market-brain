import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeRelation, isStrong, verifyEvidence } from "../../src/server/normalize/relations";
import {
  extractHardKeys,
  comparisonKey,
  fuzzyScore,
  classify,
  HIGH,
  LOW,
  type HardKeys,
  type Verdict,
  type DedupeCandidate,
} from "../../src/server/normalize/dedupe";
import { SYNTHETIC_DEDUP } from "./synthetic-dedup";
import type { RunArtifact } from "./types";

// DETERMINISTIC scorer. No LLM, no DB — reads a saved run artifact and recomputes every metric with the
// REAL exported guard functions (relations.ts / dedupe.ts), so the number is reproducible even though
// the underlying LLM extraction was stochastic. Run: `npm run eval:score [run-<id>.json]`.

const OUT_DIR = join(process.cwd(), "scripts/eval/output");

// --- Local mirrors of dedupe.ts's two private predicates (dedupe.ts:165-181), so the ablation can
//     toggle ONLY the conflict block while reusing every other exported primitive verbatim. ----------
function hardKeysMatch(a: HardKeys, b: HardKeys): boolean {
  return (
    (!!a.ticker && a.ticker === b.ticker) ||
    (!!a.cik && a.cik === b.cik) ||
    (!!a.url && a.url === b.url) ||
    (!!a.accession && a.accession === b.accession)
  );
}
function hardKeysConflict(a: HardKeys, b: HardKeys): boolean {
  return (
    (!!a.ticker && !!b.ticker && a.ticker !== b.ticker) ||
    (!!a.cik && !!b.cik && a.cik !== b.cik) ||
    (!!a.url && !!b.url && a.url !== b.url) ||
    (!!a.accession && !!b.accession && a.accession !== b.accession)
  );
}

/** findDuplicate (dedupe.ts:188) with the hard-key conflict block toggled by `guardOn`. guardOff = the
 *  fuzzy-only resolver an LLM without the guard would use. */
function resolve(existing: DedupeCandidate[], type: string, fields: Record<string, unknown>, guardOn: boolean): { verdict: Verdict; score: number } {
  const incoming = extractHardKeys(type, fields);
  for (const e of existing) {
    if (e.type !== type) continue;
    if (hardKeysMatch(incoming, extractHardKeys(e.type, e.fields))) return { verdict: "match", score: 100 };
  }
  const key = comparisonKey(type, fields);
  if (!key) return { verdict: "none", score: 0 };
  let best = 0;
  for (const e of existing) {
    if (e.type !== type) continue;
    if (guardOn && hardKeysConflict(incoming, extractHardKeys(e.type, e.fields))) continue;
    const s = fuzzyScore(key, comparisonKey(e.type, e.fields));
    if (s > best) best = s;
  }
  return { verdict: classify(best), score: best };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function loadRun(): RunArtifact {
  const arg = process.argv[2];
  let file = arg;
  if (!file) {
    const latest = join(OUT_DIR, "latest.txt");
    if (!existsSync(latest)) throw new Error("no run found — run `npm run eval:grounding` first (or pass a run-<id>.json path)");
    file = readFileSync(latest, "utf8").trim();
  }
  const path = file.includes("/") ? file : join(OUT_DIR, file);
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(): void {
  const run = loadRun();

  // ---- 1. Evidence gate: of all STRONG relations the LLM proposed, how many fail the verbatim check? ----
  let strong = 0;
  let ungroundedStrong = 0;
  let weak = 0;
  const byRel: Record<string, { total: number; ungrounded: number }> = {};
  for (const doc of run.docs) {
    for (const r of doc.relations) {
      const rel = normalizeRelation(r.relation);
      if (isStrong(rel)) {
        strong += 1;
        const grounded = verifyEvidence(r.evidence, doc.rawText); // verified against the FULL doc, as upsertRelations does
        if (!grounded) ungroundedStrong += 1;
        byRel[rel] ??= { total: 0, ungrounded: 0 };
        byRel[rel].total += 1;
        if (!grounded) byRel[rel].ungrounded += 1;
      } else {
        weak += 1;
      }
    }
  }
  const totalRelations = strong + weak;
  const assertedOn = strong - ungroundedStrong; // gate ON: only verbatim-grounded strong claims assert
  const assertedOff = strong; //                    gate OFF: every strong claim asserts, grounded or not

  // ---- 2. Cross-check against what production actually persisted (post-gate DB rows) ----
  const dbAssertable = run.db.edges.filter((e) => e.assertable === true).length;
  const dbDowngraded = run.db.edges.filter((e) => e.method === "llm_unverified").length;

  // ---- 3. Hard-key dedup guard — natural corpus (blocked merges the guard prevented) ----
  const stream: DedupeCandidate[] = [];
  for (const doc of run.docs) for (const n of doc.notes) stream.push({ type: n.type, fields: { name: n.title, ...n.frontmatter } });
  const existing: DedupeCandidate[] = [];
  let blockedNatural = 0;
  let ambiguousSuppressed = 0;
  for (const cand of stream) {
    const incoming = extractHardKeys(cand.type, cand.fields);
    const key = comparisonKey(cand.type, cand.fields);
    let wouldMerge = false;
    let wouldAmbiguous = false;
    if (key) {
      for (const e of existing) {
        if (e.type !== cand.type) continue;
        if (!hardKeysConflict(incoming, extractHardKeys(e.type, e.fields))) continue;
        const s = fuzzyScore(key, comparisonKey(e.type, e.fields));
        if (s >= HIGH) wouldMerge = true;
        else if (s >= LOW) wouldAmbiguous = true;
      }
    }
    if (wouldMerge) blockedNatural += 1;
    else if (wouldAmbiguous) ambiguousSuppressed += 1;
    existing.push(cand);
  }

  // ---- 4. Hard-key dedup guard — synthetic adversarial stress set ----
  let synthBlocked = 0;
  let synthMerged = 0;
  const synthFailures: string[] = [];
  for (const c of SYNTHETIC_DEDUP) {
    const ex: DedupeCandidate[] = [{ type: c.type, fields: c.existing }];
    const on = resolve(ex, c.type, c.incoming, true);
    const off = resolve(ex, c.type, c.incoming, false);
    if (c.expect === "blocked") {
      if (on.verdict === "none" && off.verdict === "match") synthBlocked += 1;
      else synthFailures.push(`${c.label}: expected blocked, got on=${on.verdict}/off=${off.verdict}`);
    } else {
      if (on.verdict === "match") synthMerged += 1;
      else synthFailures.push(`${c.label}: expected merged control, got on=${on.verdict}`);
    }
  }

  // ---- 5. Precision spot check (folded in if precision.eval.ts has run) ----
  const precPath = join(OUT_DIR, "precision-latest.json");
  let precLine = "_not yet run — `npm run eval:precision`_";
  if (existsSync(precPath)) {
    const p = JSON.parse(readFileSync(precPath, "utf8")) as { sampled: number; supported: number; human?: { supported: number; reviewed: number } };
    const llm = `LLM-judge ${p.supported}/${p.sampled} = ${pct(p.supported, p.sampled)}`;
    const human = p.human ? `; hand-reviewed ${p.human.supported}/${p.human.reviewed} = ${pct(p.human.supported, p.human.reviewed)}` : "; hand-review pending";
    precLine = llm + human;
  }

  // ---- Build the report ----
  const nNews = run.docs.filter((d) => d.kind === "news").length;
  const nFilings = run.docs.filter((d) => d.kind === "filing").length;
  const corpusDesc = [nNews ? `${nNews} large-cap news items` : "", nFilings ? `${nFilings} SEC filing excerpts (iXBRL stripped to prose)` : ""].filter(Boolean).join(" + ");

  const relRows = Object.entries(byRel)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([rel, v]) => `| \`${rel}\` | ${v.total} | ${v.ungrounded} | ${pct(v.ungrounded, v.total)} |`)
    .join("\n");

  const md = `# Grounding eval — results

- **Run:** \`${run.runId}\`  (generated ${run.generatedAt})
- **Corpus:** ${run.docs.length} pinned docs (manifest \`${run.manifestSha}\`), ${run.docs.filter((d) => d.kind === "news").length} news + ${run.docs.filter((d) => d.kind === "filing").length} filings
- **Extractor:** ${run.extractor}
- **Proposed relations:** ${totalRelations} (${strong} strong / ${weak} weak)

## 1. Evidence gate — core metric

Of every relation whose type the LLM proposed as **strong** (assertable-eligible), the share whose
\`evidence\` quote **fails** \`verifyEvidence\`'s verbatim-substring check and is therefore downgraded
(never allowed to assert a fact).

| Metric | Value |
|---|---|
| Strong relations proposed | **${strong}** |
| ...ungrounded (evidence not in source) | **${ungroundedStrong}** |
| **Evidence-gate catch rate** | **${pct(ungroundedStrong, strong)}** |
| Strong relations that ground → assertable | ${assertedOn} |

DB cross-check (production rows this run persisted): ${dbAssertable} assertable edges, ${dbDowngraded} \`llm_unverified\` downgrades.

### Strong relations by type
| relation | proposed | ungrounded | catch % |
|---|---|---|---|
${relRows || "| _(none)_ | 0 | 0 | n/a |"}

## 2. Ablation — guards ON vs OFF (same corpus)

| Guard | ON (production) | OFF (bypassed) | Δ asserted-but-ungrounded |
|---|---|---|---|
| Verbatim-evidence gate | ${assertedOn} asserted | ${assertedOff} asserted | **+${ungroundedStrong}** (${pct(ungroundedStrong, assertedOff)} of OFF) |

The **Δ = ${ungroundedStrong}** ungrounded facts are exactly what would be asserted as true with the gate
removed. With the gate on they are downgraded to non-assertable \`relates_to\`.

## 3. Hard-key entity-resolution guard

| Set | Blocked merges (fuzzy≥${HIGH}, hard-key conflict) | Ambiguous-suppressed (≥${LOW}) |
|---|---|---|
| Natural corpus | ${blockedNatural} | ${ambiguousSuppressed} |
| Synthetic adversarial | ${synthBlocked}/${SYNTHETIC_DEDUP.filter((c) => c.expect === "blocked").length} blocked; ${synthMerged}/${SYNTHETIC_DEDUP.filter((c) => c.expect === "merged").length} true-dup control merged | — |

${blockedNatural === 0 ? "_Natural-corpus blocks are ~0 by design — real large-cap news rarely proposes a same-named entity with a conflicting ticker. The synthetic set exercises the guard directly._" : ""}
${synthFailures.length ? `\n**Synthetic failures:** ${synthFailures.join("; ")}` : ""}

Merge candidates flagged for human review this run: ${run.db.mergeCandidates}.

## 4. Grounding precision (asserted facts semantically supported by the cited quote)

${precLine}

---
_Caveats: one pinned run (LLM extraction is stochastic; scoring over the saved artifact is deterministic).
Corpus is a convenience sample of ${corpusDesc}, not a random draw over all inputs. The DB \`llm_unverified\`
count is a lower bound on ungrounded-strong (a strong claim whose endpoints don't resolve is dropped, not
downgraded). verifyEvidence proves the quote is verbatim; precision measures the additional
semantic-support question the gate can't._
`;

  writeFileSync(join(OUT_DIR, `results-${run.runId}.md`), md);
  writeFileSync(
    join(OUT_DIR, `results-${run.runId}.json`),
    JSON.stringify(
      { runId: run.runId, strong, ungroundedStrong, catchRate: strong ? ungroundedStrong / strong : null, assertedOn, assertedOff, dbAssertable, dbDowngraded, blockedNatural, ambiguousSuppressed, synthBlocked, synthMerged, synthFailures },
      null,
      2,
    ),
  );
  console.log(md);
  console.log(`\nWritten -> scripts/eval/output/results-${run.runId}.md`);
}

main();
