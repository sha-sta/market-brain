# Grounding / anti-hallucination eval harness

Measures, on a **pinned corpus of real source docs**, how well MarketBrain's deterministic guards keep
fabricated facts out of the graph. Produces a reproducible, citable number for the verbatim-evidence gate,
a guards **ON vs OFF** ablation, and a human-verified grounding-precision spot check.

It runs the **real** extractor (Vercel AI Gateway) and **real** embeddings against the **isolated test
Supabase** (ports 5533x) — never prod data. Scoring is a separate deterministic pass over the saved run,
so the number reproduces even though LLM extraction is stochastic.

## What it measures

1. **Evidence-gate catch rate (core).** Of every relation whose type the LLM proposed as *strong*
   (assertable-eligible), the share whose `evidence` quote **fails** `verifyEvidence`'s verbatim
   substring check (`src/server/normalize/relations.ts`) and is therefore downgraded — never allowed to
   assert a fact.
2. **Ablation, guards ON vs OFF.** Same corpus, evidence gate bypassed: the delta is the number of
   asserted-but-ungrounded facts the gate prevents. Plus a hard-key dedup ablation (natural corpus +
   a labeled synthetic adversarial set) counting fabricated-ticker/CIK/accession merges the guard blocks.
3. **Grounding precision.** A ~50-fact sample of *asserted* edges, judged (and hand-reviewed) for whether
   the verbatim quote actually **supports** the claimed relationship — the semantic question the substring
   gate can't answer.

## Files

| File | Role |
|---|---|
| `fetch-corpus.ts` | One-time fetcher: pins real source docs to `corpus/` + `manifest.json`. SEC EDGAR is keyless (needs only a UA); Finnhub news needs `FINNHUB_API_KEY` and is skipped when absent. |
| `corpus/` | The pinned corpus (`docs.json`) + `manifest.json` (records every doc + sha256) — the reproducibility record. Committed. |
| `grounding.eval.ts` | LIVE pass: seeds the corpus, drains it through the real pipeline with a teed extractor, writes a run artifact to `output/`. Spends AI credits. |
| `precision.eval.ts` | LIVE: samples asserted edges, LLM-judges support, writes a hand-review checklist. |
| `score.ts` | DETERMINISTIC: recomputes every metric from a saved run with the real guard functions; writes `output/results-<id>.md`. No LLM, no DB. |
| `synthetic-dedup.ts` | Labeled adversarial entity pairs that stress the hard-key merge guard. |

## Run it

```bash
npm run db:test:start && npm run db:test:reset   # isolated local test DB (ports 5533x)
npm run eval:fetch-corpus                         # once — pins scripts/eval/corpus/ (commit the result)
npm run eval:grounding                            # real extractor over the corpus (spends AI credits)
npm run eval:precision                            # per-fact judge + hand-review checklist
npm run eval:score                                # prints the results table -> output/results-<id>.md
```

Requires `AI_GATEWAY_API_KEY` (in `.env.local`) and the test DB creds (`.env.test.local`). The eval config
loads the test-DB creds first, then adds feature keys from `.env.local` with `override:false`, so a prod URL
can never clobber the local one; `cleanupAll()` also hard-refuses any non-localhost DB.

The `eval:*` scripts are **not** part of `npm test` / `npm run test:integration` (separate config + globs),
so CI never runs them and never needs the gateway.

## Honesty caveats

- One pinned run (LLM extraction is stochastic; the saved artifact makes scoring deterministic).
- The corpus is a convenience sample, not a random draw over all inputs.
- `verifyEvidence` proves a quote is verbatim; precision measures the additional semantic-support question.
- Natural-corpus dedup blocks are ~0 by design (real filings rarely propose conflicting hard keys); the
  synthetic set exercises that guard directly and is reported separately, never blended into the grounding %.
