# Architecture: the extraction pipeline and its anti-hallucination guards

MarketBrain is a knowledge graph on **Postgres + pgvector** (Supabase). Its correctness rests on a set of
**deterministic guards** that sit between the LLM and the graph: the model proposes, but code decides what
is allowed to become an asserted fact. This document explains those guards, how they compose into the
extract → validate → dedupe → reconcile → embed pipeline, and how the grounding eval measures them.

Everything below maps to code. File references are `path:line` and clickable.

## The graph

- **`nodes`** — 15 typed entities (company, person, sector, theme, news, filing, thesis, catalyst, risk,
  signal, macro_factor, product, commodity, organization, note). Each carries `type`, `title`, a `data`
  JSONB payload, a `lifecycle` (`active`/`stale`/`archived`/`superseded`), and a pgvector `embedding`.
- **`edges`** — typed relations with `relation_type`, `confidence`, `evidence_quote`, `method`, and a
  DB-computed **`assertable`** boolean (see below). A news article and a hand-written note are **both just
  `raw_uploads` rows** the worker turns into a node + edges.

Every node mutation routes through the single choke-point **`writeNodeData`** (`src/server/normalize/upsert.ts`),
which snapshots a reversible `node_revisions` row and re-embeds only when the embedded text changed.

## The pipeline

One `raw_uploads` row → **`processRawUpload`** (`src/server/normalize/worker.ts:182`), driven in batches by
**`drainPending`** (`src/server/normalize/drain.ts:45`). Stages:

1. **Extract (LLM).** `chunkText` → **`extractEntities`** (`src/server/normalize/extract.ts:26`) calls Claude
   via the Vercel AI Gateway (`generateText`, Haiku-first, escalating to Sonnet on retry/long chunk —
   `model.ts`). The extractor is **injected** (`WorkerDeps`, `worker.ts:61`), so the whole pipeline is
   testable with stubs and the eval can tee the real calls.
2. **Validate.** The envelope is Zod-parsed (`extract-schema.ts`); a malformed *item* is dropped rather than
   failing the whole document (`lenientArray`, `extract-schema.ts:57`). Per-note field validation
   (`validateNoteData`, `schemas.ts`) retries once, feeding the errors back to the model.
3. **Dedupe.** Each entity is resolved against existing nodes by **`findDuplicate`** (`dedupe.ts:188`) — the
   hard-key guard (below) — merging, inserting, or flagging for review.
4. **Reconcile.** Extractor-emitted `corrections` are applied through the confidence-tiered, verbatim-gated
   **`applyCorrections`** (`reconcile.ts:28`).
5. **Embed + write edges.** Structural (wikilink) and grounded edges are written; grounded relations pass
   through the **evidence gate** (below) before any can assert a fact.

## Guard 1 — the verbatim-evidence gate

The LLM proposes a relation as a raw claim `{ subject, relation, object, evidence }` (`extract-schema.ts:30`)
where `evidence` is a quote that supposedly states the relationship. There is **no** "assertable" flag in the
model output — assertability is *derived* by code.

**`verifyEvidence`** (`relations.ts:110`) is the deterministic check: the quote must appear as an exact
substring of the source, comparing both sides after Unicode-NFC normalization, lowercasing, and
whitespace-collapse (min 4 chars). **`resolveGroundedEdge`** (`relations.ts:137`) then decides:

- A **strong** relation (one of the 17 `STRONG_RELATIONS`, `relations.ts:9`) whose quote **verifies** →
  `confidence 0.9`, quote kept → **assertable**.
- A strong relation whose quote **does not verify** → **downgraded** to a weak `relates_to` at `confidence 0.3`
  with `evidence_quote: null` (`method: "llm_unverified"`) — kept for navigation, **never assertable**. The
  fabricated claim is caught, not minted.
- A **weak** relation is never assertable regardless.

An edge is `assertable` iff it is a strong relation, `confidence ≥ 0.8`, and has an `evidence_quote`
(`isAssertable`, `relations.ts:119`) — a mirror of the DB generated column.

**What the gate does NOT check:** that the quote *semantically supports* the claim, or that the relation
direction is right. Those are measured by the precision spot-check below, and are a known limitation.

## Guard 2 — hard-key entity resolution

The top merge-failure mode is an LLM-fabricated identifier collapsing two distinct entities. **`findDuplicate`**
(`dedupe.ts:188`) defends against it with **hard keys** — ticker/CIK (company), canonical URL (news),
accession/URL (filing):

- A hard-key **match** overrides name fuzz (merges "NVIDIA" and "NVIDIA Corp" on a shared ticker).
- A hard-key **conflict** (`hardKeysConflict`, `dedupe.ts:174`) **blocks** a merge however similar the names —
  two companies with different tickers, or two filings with different accessions, never merge.

Ambiguous matches (fuzzy 72–87) are not silently merged; they are flagged in `node_merge_candidates` for human
review. `normTicker` never *guesses* a ticker from a name (`dedupe.ts:45`).

## Guard 3 — confidence-tiered fact reconciliation

When a source states a fact on a *permanent* node changed (a CEO leaves, a rename), the extractor emits a
`corrections` entry on the **same** extraction call (no extra LLM pass). **`planCorrection`**
(`reconcile-rules.ts:16`) gates it on the same `verifyEvidence` plus confidence tiers:

- `verified` **and** `confidence ≥ 0.85` → **auto-apply** (`AUTO_APPLY_CONFIDENCE`, reversible via `writeNodeData`).
- `verified` **and** `0.6 ≤ confidence < 0.85` → **queue** for review (`correction_queue`).
- otherwise → **skip**. An unverified/paraphrased correction is never applied.

Identity fields are protected: a rename appends `former_name`/`aliases` and never overwrites the dedupe hard-key
`name`; a role change retires the now-false `insider_of` edge.

## Guard 4 — cross-layer, build-failing invariants

The guards are duplicated across layers on purpose, and a drift fails the build:

- **`assertable` is triple-sourced** — the SQL generated column (`supabase/migrations/0032_finance_assertable_v2.sql`),
  the `STRONG_RELATIONS` TS constant, and `isAssertable()`. `tests/unit/relations.test.ts` parses the raw
  migration text and fails if the SQL set ≠ `STRONG_RELATIONS`.
- **The decay windows are double-sourced** — `decayWindow()` (`lifecycle.ts`) and the `prune_archived_nodes`
  SQL (`0043`); a sync-guard unit test fails on drift.

## The grounding eval

`scripts/eval/` runs the **real** extractor over a **pinned corpus** of real source docs and measures the
guards. It runs against the isolated test DB (never prod) with a teed extractor, capturing both the LLM's raw
proposals (the strong-relation denominator) and the production edges (with the DB `assertable` column), then
scores deterministically offline. See `scripts/eval/README.md` for the design and commands:

```bash
npm run db:test:start && npm run db:test:reset
npm run eval:fetch-corpus      # pins scripts/eval/corpus/ (committed — the reproducibility record)
npm run eval:grounding         # real extractor over the corpus (spends AI credits)
npm run eval:precision         # per-fact judge + hand-review checklist
npm run eval:score             # results table -> scripts/eval/output/results-<id>.md
```

### Results

<!-- RESULTS:START -->
Run `2026-07-06T07-41-31-056Z` — 40 pinned SEC filings (32 × 8-K, 8 × 10-Q, iXBRL stripped to prose),
manifest `8a9dc98846f7fe95`. 255 relations proposed (189 strong / 66 weak). Full artifact +
per-fact checklist under `scripts/eval/output/`.

**Evidence gate (core).** Of the 189 strong (assertable-eligible) relations the model proposed, **22 (11.6%)**
had an `evidence` quote that is **not** a verbatim substring of the source and were downgraded — never
allowed to assert. DB cross-check: the run persisted 145 assertable edges and 19 `llm_unverified` downgrades
(a lower bound on the 22 — a strong claim whose endpoints don't resolve is dropped, not downgraded). The
most-hallucinated strong relations were `produces` (62.5%), `affects` (40%), `catalyst_for` (33%); `filed`,
`in_sector`, `threatens` were 0%.

**Ablation — gate ON vs OFF.** With the gate ON, 167 grounded facts assert; with it bypassed, all 189 assert
— so the gate prevents **+22 asserted-but-ungrounded facts** (11.6% of the OFF set) from entering the graph.

**Hard-key dedup guard.** On the natural corpus the guard blocked **13** merges — all genuinely-distinct
same-company 8-Ks with different accession/URL, correctly kept separate — and flagged 6 ambiguous pairs for
review. On a labeled synthetic adversarial set (`scripts/eval/synthetic-dedup.ts`) it **blocked 5/5**
fabricated-ticker/CIK/accession merges and still **merged the 1/1 true-duplicate control**.

**Grounding precision (LLM-judged + hand-reviewed).** On a 50-fact sample of *asserted* edges, **28/50 (56%)**
have a quote that semantically supports the specific claim. The 22 misses are the gate's known blind spots:
**5 wrong-direction edges** (e.g. document→company `filed`) and 17 weak/wrong-endpoint quotes (e.g.
`Amazon listed_on SEC`, an `insider_of` cited from a proxy vote tally). `verifyEvidence` guarantees the quote
is real; it does not guarantee the quote *supports* the claim — this number is the honest measure of that gap
on this corpus.

| Guard | Metric | Result |
|---|---|---|
| Verbatim-evidence gate | strong claims caught as ungrounded | **22 / 189 = 11.6%** |
| Evidence gate ablation | asserted-but-ungrounded facts prevented (ON vs OFF) | **+22** |
| Hard-key dedup | fabricated-key merges blocked (natural / synthetic) | **13 / 5-of-5** |
| Grounding precision | asserted facts whose quote supports the claim | **28 / 50 = 56%** |
<!-- RESULTS:END -->

### Honesty caveats

- One pinned run (LLM extraction is stochastic; scoring over the saved artifact is deterministic and reproduces).
- The corpus is a convenience sample of large-cap SEC filings, not a random draw over all inputs. In production
  the filing path ingests filing *metadata*; the eval constructs readable filing-text docs (iXBRL stripped to
  prose) to exercise the extractor.
- `verifyEvidence` proves a quote is **verbatim**; grounding **precision** measures the additional
  semantic-support question the substring gate cannot — and the eval reports it honestly, including
  wrong-direction edges the gate does not catch.
- Natural-corpus dedup blocks are dominated by genuinely-distinct filings kept separate; the synthetic
  adversarial set exercises the fabricated-key guard directly and is reported separately, never blended into
  the grounding %.
