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

## Next session — Task B: deep research — what was UNIQUELY done?
Goal: figure out, honestly, what's genuinely novel vs careful-application-of-known-patterns, and position
the README/announcement against real prior art. Candidate differentiators to verify, and the closest
prior art to compare against:
- **No-advice + adversarial thesis critic** (deterministic `enforceFloor` anti-sycophancy) in a *market*
  tool — most AI-investing tools GIVE buy/sell calls. Verify against FinChat/Fintool, AlphaSense,
  Perplexity Finance, BloombergGPT, the "AI stock picker" SaaS crowd.
- **Temporal/living KG** — tiered decay + reference-guarded hard-delete + thesis-supersede + fact
  reconciliation. **Closest neighbor: Zep/Graphiti (temporal KG with edge invalidation)** and Microsoft
  **GraphRAG**, LlamaIndex KG, Cognee, txtai. Compare honestly — Graphiti overlaps the most.
- **Evidence-gated assertable edges** (verbatim-quote verification before a claim is assertable) +
  **build-failing sync invariants** (triple-sourced assertable; double-sourced decay windows) — an
  anti-hallucination + correctness-discipline angle.
- **Fact reconciliation that rides the extraction envelope at ZERO extra LLM cost**, and **lifecycle
  tuned for a free-tier embedded-vector DB** — cost-engineering angle.
Deliverable: a short "what's novel / what exists already / who this is for" section, with citations.

## Pending setup (likely already done — confirm)
- Appa approved at `/admin`; graph seeded (seed prompt: git `1c8bf38`). The user reports it works, so
  these are probably complete.
