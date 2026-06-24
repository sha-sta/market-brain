# MarketBrain — handoff: SHIPPED + VERIFIED; next session = go public + assess uniqueness

_Last updated: 2026-06-24. Durable invariants live in **`CLAUDE.md`**; the self-updating "living graph"
is summarized in **`README.md`**. The graph-lifecycle overhaul is **merged to `main`, deployed, and
verified working in prod** (digest sends, UI, extractor — confirmed). `DIGEST_TO` = dad's email (live).
**No code work remains.** This file is now the brief for the next session (and is itself an internal log —
delete it before the repo goes public)._

## What shipped (on `main`, deployed; see README "Living graph")
- **Time-box + digest reserve + news cap** — soft `deadlineMs` through `drainPending`/`judgeTheses`;
  cron reserves ~45s for the digest (the missing-digest fix); 8-newest/company ingest cap.
- **Tiered decay + reference-guarded hard delete** — extractor `_tier` → `decayWindow(type,tier)`;
  `prune_archived_nodes` (SQL `0043`) deletes long-archived chronological nodes, never live-thesis
  evidence / active-tracked. `/archived` browse+restore.
- **Thesis lifecycle** — auto-supersede near-restatements (≥0.92) via `superseded_by`; `/theses` tab.
- **Fact reconciliation** — extractor `corrections` (`0044 correction_queue`); ≥0.85 auto-apply.
- **Weekly gap-fill** — grounds tracked companies via market adapters, no LLM (`0045`).
- Tests: 144 unit · 56 integration · 6 e2e, build green. Migrations `0001–0045` pushed to cloud.

## Next session — Task A: make the repo PUBLIC
**Secrets audit (done 2026-06-24): CLEAN.** Only `.env.example` is tracked; `.gitignore` excludes
`.env*`; no keys/tokens/JWTs in tracked files; no `.env` ever in git history; `.env.example` is
placeholders only. Safe to publish from a secrets standpoint.

**Non-secret but personal/identifying — decide what to genericize vs keep (it's a gift, so keeping the
story is legitimate):**
- Personal framing: `README.md:3`, `CLAUDE.md:3` ("Father's Day gift for my Dad").
- User-facing "Appa" strings: `src/components/father-day-hero.tsx:42` ("Happy Father's Day, Appa."),
  `src/app/(app)/admin/page.tsx:36`. Plus the `FatherDayHero` component + its wiring in `app/(app)/page.tsx`.
- Infra identifiers (not secret, but reveal the deployment): Supabase ref `nrzyfqhfbseihxzwcvns`, prod
  URL `dj-stocks.vercel.app`, repo slug `github.com/sha-sta/market-brain` — `CLAUDE.md:10-18`.
- **Delete this `HANDOFF.md`** (internal log) before going public.
- Consider the `ecc:opensource-pipeline` skill (forker → sanitizer → packager) to automate sanitize +
  generate LICENSE / CONTRIBUTING / setup.

## Next session — Task B: DEEP RESEARCH — what was uniquely done? (self-contained brief)

> This section is written so a fresh session can plan the research straight from this doc. Run it with
> the `deep-research` skill (fan-out web search → fetch sources → **adversarially verify** each novelty
> claim → cited synthesis). House rule: this is a NON-SYCOPHANCY project — do not overclaim. For every
> "we do X," the burden is to find the closest existing thing that already does X and rate it
> **novel / partial-overlap / already-exists**, with citations. "Novel synthesis" is an honest verdict;
> "first of its kind" must be earned.

### Objective
Produce an honest, cited assessment of (a) what in MarketBrain is genuinely novel vs careful application
of known patterns, (b) what already exists and how close it is, and (c) who this is actually for. Output
feeds a README "Prior art & what's different" section (+ comparison table) and any launch/announcement.

### Research questions
1. Does an **auto-updating personal knowledge graph over market/news data** already exist as an OSS
   project or product? How close?
2. Does anything pair a KG/brief with an **explicitly non-advisory, adversarial thesis critic** (attacks
   the user's own thesis, refuses buy/sell)? Most finance LLMs do the opposite — verify.
3. How does the **living-graph lifecycle** (tiered decay → reference-guarded HARD-delete, whole-node
   supersede, cross-node fact reconciliation) compare to temporal-KG frameworks that already invalidate/
   expire edges (esp. Zep/Graphiti)?
4. Is **evidence-gated assertability** (a claim becomes assertable only if its quote verifies verbatim
   against source) a recognized pattern, or unusual rigor?
5. Are the **build-failing cross-layer invariants** (triple-sourced assertable vocab; double-sourced
   decay windows) a known practice for LLM-app correctness, or a distinctive discipline?
6. Honest bar: as a **software-engineering portfolio piece**, is this above/at/below the typical
   "impressive OSS LLM app"? What would a skeptical senior engineer say is merely table-stakes here?

### Candidate differentiators = hypotheses to test (grounded in the code so the planner can verify each)
- **Non-advisory + adversarial critic.** `server/critic/*` — `enforceFloor` (`calibration.ts`)
  deterministically demotes a verdict to what verified evidence supports; the no-buy/sell vocab is a hard
  invariant (`CLAUDE.md`). Closest prior art to beat: FinChat/Fintool, AlphaSense, Perplexity Finance,
  BloombergGPT, the "AI stock-picker" SaaS crowd, and LLM-as-judge/eval frameworks (do any *self-demote*?).
- **Temporal/living KG.** `server/normalize/lifecycle.ts` (`decayWindow`), `market/daily.ts`
  (`decayStaleNodes`), migration `0043 prune_archived_nodes` (reference-guarded), `critic/thesis-supersede.ts`,
  `normalize/reconcile.ts`. **Closest neighbor: Zep / Graphiti (temporal KG with edge invalidation)** —
  compare in depth. Also Microsoft GraphRAG, LlamaIndex KG, Cognee, txtai, Mem0. Key question: do any do
  *reference-aware hard DELETE* (reclaim storage) vs only soft-invalidate?
- **Evidence-gated assertable edges + verbatim grounding.** `normalize/relations.ts` (`isAssertable`,
  `verifyEvidence`), the thesis-judge edge grounding. Compare to GraphRAG/claim-extraction + citation/
  attribution and hallucination-guard literature.
- **Zero-extra-cost fact reconciliation.** `normalize/reconcile.ts` rides the SAME extraction envelope
  (no extra LLM call) to correct permanent nodes. Compare to entity-resolution / KG-update pipelines.
- **Free-tier-tuned lifecycle + cost engineering.** Tiered hard-delete sized to a ~500MB Supabase free
  tier + ~6KB embeddings; one Hobby cron; time-boxed run reserving digest budget. Angle: doing a
  living KG within hard free-tier limits.
- **Cross-layer build-failing invariants.** `tests/unit/relations.test.ts` (assertable triple-source),
  `tests/unit/lifecycle.test.ts` (decay-window SQL↔TS sync-guard). Angle: correctness discipline.

### Prior art to investigate (build a comparison matrix; for each: what it does, overlap, gaps vs us)
- **Temporal/agentic KG frameworks:** Zep/Graphiti, Microsoft GraphRAG, LlamaIndex Knowledge Graph,
  Cognee, txtai, Mem0, Letta/MemGPT (memory).
- **AI investing/research tools:** FinChat/Fintool, AlphaSense, Perplexity Finance, BloombergGPT,
  Kavout/Danelfin/"AI stock picker" SaaS, openbb (OSS).
- **Personal-knowledge / "second brain":** Obsidian, Logseq, Roam, Mem, Reflect — manual vs auto-growing.
- **LLM-judge / anti-sycophancy:** eval frameworks + any self-calibrating/floor-enforcing critics.

### Method
Use `deep-research`. Fan out one search thread per prior-art cluster above; deep-read the 2–3 closest
matches (esp. Graphiti + one finance LLM); for EACH candidate differentiator, find the nearest existing
implementation and rate novel/partial/exists with a one-line justification + citation. Then a synthesis
pass: the honest novelty verdict, the "who it's for," and the skeptic's rebuttal.

### Deliverable
1. A `RESEARCH.md` (or a section) — "What's novel · what already exists · who this is for," with a
   comparison table (MarketBrain vs Graphiti vs GraphRAG vs a finance LLM) and citations.
2. A tightened README "Prior art & what's different" paragraph (honest framing, links).
3. A one-line verdict on the portfolio-strength question (#6), with the strongest counterargument noted.

## Pending setup (likely already done — confirm)
- Appa approved at `/admin`; graph seeded (seed prompt: git `1c8bf38`). The user reports it works, so
  these are probably complete.
