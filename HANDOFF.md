# MarketBrain — handoff: graph-growth optimization + the 300s cron timeout

_Last updated: 2026-06-19. `main` is deployed to prod. Durable project invariants (deploy model,
Supabase, hard constraints, UI, email, how-to-run) now live in **`CLAUDE.md`** — read that first; this
doc is ONLY the next build task + current open issues. The full phase-by-phase refactor history is in
git (it's not repeated here)._

> **Feed this doc into a fresh session to produce a comprehensive implementation plan, then build it.**

---

## The task — make the daily run add LESS (and fix the timeout with the same change)

### Problem
The graph grows roughly unbounded and the daily cron is probably timing out:
- **Growth:** every daily run drains, per tracked company, **every** news article in the fetch window
  through an LLM into `news` nodes (+ entities), with **no per-company cap and no materiality gate at
  ingest**. On-demand **research** also drains web findings into nodes. Meanwhile **decay only HIDES
  news at 45 days** (`lifecycle='archived'`, never deleted) — so active-news volume climbs for ~45d and
  archived rows (with embeddings) accumulate in the DB forever.
- **Timeout (most likely cause of the missing digest email — see Open issues):** the cron is ONE ≤300s
  invocation that runs enrichment **then** the digest, sequentially. The LLM-heavy steps (drain every
  article + Sonnet thesis-judge over every thesis) can exhaust the 300s budget, and Vercel hard-kills
  the function **before** the digest step writes/sends → "no brief". (The old "`?stage=` route-callable
  engine" note was AspIRATIONAL — there is no stage split today; it's monolithic.)

### Hypothesis (two birds, one stone)
If the daily run generates **less**, the graph stays smaller **and** the run finishes inside 300s so the
digest reliably sends. So the growth fix likely IS the timeout fix.

### Proposed direction (user's intent — refine into a real design)
Make each daily run populate with only two things:
1. **Essential STRUCTURAL / conceptual nodes the graph is MISSING** — timeless "good to have" facts, not
   chronological: a tracked company's sector, founders, key products, top competitors, supply
   dependencies, the themes/risks/commodities it's exposed to. A **gap-fill pass**: look at what each
   tracked entity is missing and add only that. These are the durable value and they stop growing once
   filled.
2. **Only very recent news (past ~24h)** — once the brain has run daily for a while, only the last day's
   news is incrementally relevant, so old/low-signal news shouldn't keep pouring in.

### What's already true vs what needs to change (ground the plan here)
- **News fetch is ALREADY a ~24h window** — `enqueueNews` in `src/server/market/daily.ts` uses
  `from = ymd(now - 86_400_000)` (calendar yesterday) → `to = ymd(now)`. So "past 24h" is done for the
  FETCH. The growth levers that DON'T exist yet: a **per-company article cap**, a **materiality/quality
  gate at ingest** (only drain high/med-materiality articles), a **shorter archival window**, and
  **hard-deleting** (vs only hiding) long-archived news to reclaim DB + embedding cost.
- The "essential things missing" idea is NEW — there's no gap-fill pass today. Decide the heuristic:
  which fields/edges per node type count as "essential," and how to detect they're missing cheaply
  (ideally without an LLM call per node — query the graph, only LLM the gaps).
- **Research** (`src/server/research/run.ts`) drains web findings into nodes too, bounded by
  `maxSearches`/`maxFetches` + a per-day quota. Consider whether it needs the same volume discipline.

### The pipeline to modify — `src/server/market/daily.ts` → `runDailyForGraph`
Step order today (all sequential, one 300s invocation; the route is `src/app/api/cron/daily/route.ts`,
which calls `runDailyForGraph` THEN `sendDigestForGraph`):
1. `trackedCompanies` — active tracked companies only (candidate firewall).
2. `snapshotPrices` (Finnhub, pLimit 3).
3. `enqueueNews` (pLimit 2) — **no cap, no materiality gate** ← growth lever.
4. `drainPending` — **LLM extract + embed per pending upload** ← slowest, scales with #3.
5. `linkNewsMentions`.
6. `archiveStaleNews` — age-based hide at 45d/120d ← decay (too infrequent).
7. `prune_snapshots` RPC — time-series only.
8. `detectConnections` — auto-discovery candidates (+21d candidate decay).
9. `judgeTheses` (Sonnet, per thesis) ← second slowest.
…then `sendDigestForGraph` (gather → compose → send). **If 4/9 blow 300s, the send never happens.**

Timeout fix options to weigh in the plan: (a) bound the work (the optimization itself — caps/gates), and
/or (b) **reorder so the digest sends before the heavy judge**, and/or (c) **time-box the judge** (judge
only N theses or until a soft deadline), and/or (d) make the run resumable across days (cursor) so it
chips away. Note the **1-cron/day** Hobby limit constrains splitting into multiple scheduled crons.

### Decay audit (context for the growth/decay balance) — and the ONE bug to fix alongside
Four mechanisms; **none delete nodes**, only `news` auto-changes state:
| Mechanism | Touches | Effect |
| --- | --- | --- |
| News archival (`archiveStaleNews`) | only `type='news'` | age>45d (120d high-materiality) → `lifecycle='archived'` (hidden, edges kept, restorable) |
| Snapshot prune (`prune_snapshots`) | `price_snapshots`/`metric_snapshots` rows | downsample old time-series; never nodes |
| Candidate decay (`detectConnections`) | `tracked_entities` rows | auto candidates not re-surfaced in 21d → `dropped`; node untouched; manual/active protected |
| Field supersede (`decideSupersede`) | fields inside one node | newer source overwrites narrative fields only; identity never; old value → revision |

**Bug to fix in the same PR:** `archiveStaleNews` archives **purely on age with no "still referenced"
guard** (despite the `lifecycle.ts:69` comment claiming otherwise). A >45d article that is the evidence
for an **active thesis** (`confirms_thesis`/`challenges_thesis` edge) still archives, and the
thesis-judge (`subgraph.ts:57`) + RAG exclude archived nodes → a thesis silently loses its evidence.
Guard archival on "no incoming edge from an active thesis / tracked entity," or extend the window for
referenced news. (Minor: `lifecycle='stale'` and whole-node `superseded` are defined but never written.)

### Open design questions for the plan to resolve
- Gap-fill heuristic: which fields/edges are "essential" per node type, and how to detect-cheaply.
- Per-company news cap (e.g. top N by materiality?) and the ingest materiality threshold.
- Archival window (shorten from 45d?) and whether to HARD-DELETE long-archived news (reclaim embeddings).
- Reorder digest-before-judge vs time-box the judge — which best guarantees the email sends.
- Does research need the same caps?

### Verification
- Daily run is integration-tested with stubs: `tests/integration/` (search "daily"/"tracking"). Extend
  it to assert the new caps/gap-fill and that a slow judge can't starve the digest.
- The 300s timeout can't be unit-tested; bound the work and confirm by firing the cron (below) and
  reading `time_total` + `results[].digest.status`.

---

## Open issues / setup still pending (compact)

1. **Digest email not arriving (THIS task's payoff).** Prod has Gmail sender + `DIGEST_TO` (Resend
   removed); migrations confirmed pushed (schema gap ruled out); `/brief` shows **no row for today** →
   points to the **300s timeout** killing the run before the digest. Confirm + (after fixing) verify by
   firing the cron — `DIGEST_TO` is currently the user's OWN email (safe to test today):
   ```
   curl -sS -m 310 -w '\n— HTTP %{http_code} in %{time_total}s\n' \
     -H "Authorization: Bearer <CRON_SECRET>" https://dj-stocks.vercel.app/api/cron/daily
   ```
   `results[].digest.{status,reason}` = the literal outcome; HTTP 504 after ~300s = timeout confirmed.
   (`vercel env pull` returns EMPTY values for this project, so grab `CRON_SECRET` from the Vercel
   dashboard; can't read it via CLI.)
2. **Let dad ("Appa") in:** publish the Google OAuth consent screen (or add him as a test user), then
   approve him at `/admin` when he signs in.
3. **Seed the graph so he doesn't start empty:** a ready-made "paste into Claude.ai" seed prompt that
   produces a `seed.md` (dumped at `/dump`) is preserved in git — `HANDOFF.md` @ commit `1c8bf38`,
   "Seed the graph" appendix. Test in a separate graph (top-left graph selector), then wipe.
4. **Father's Day = Sun Jun 21, 2026.** Cron is weekday-only so it won't auto-send Sunday — send
   manually that morning after setting `DIGEST_TO` = his email. Until then keep `DIGEST_TO` = your own.
