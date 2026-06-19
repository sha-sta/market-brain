# MarketBrain — handoff

_Last updated: 2026-06-18. Repo: `github.com/sha-sta/market-brain` (private)._
_Active branch: **`living-brain-refactor`** (head `6566c91`). `main` (head `1987d93`) and the cloud
deploy are UNTOUCHED by the refactor — nothing below is live until you push migrations + merge (see Deploy)._

A private **stock-market research knowledge graph** — a Father's Day gift. Originally a manual portfolio
tracker; the `living-brain-refactor` branch turns it into a **self-updating research brain**: dad tracks
names/industries he cares about, the graph refreshes and amends itself (swaps stale facts, archives dead
news, re-judges theses), discovers cross-connections, researches topics from the open web on request, and
produces **strict, non-sycophantic** theses. **Posture: aggregate & surface only — never any buy/sell/recommend vocabulary.**

---

## Status at a glance

| Area | State |
| --- | --- |
| Refactor code | ✅ Complete on `living-brain-refactor` (6 phases, commits `0383eb3`→`6566c91`). NOT merged to `main`. |
| Tests | ✅ 110 unit + 23 integration (real test DB) + 6 e2e. Production `next build` green. Typecheck clean. |
| Reviews | ✅ Every phase passed DB / TypeScript / security review agents; all findings fixed (SSRF, XSS, quota, field-injection, assertable sync). |
| Cloud (Supabase + Vercel) | ⚠️ Still on the PRE-refactor schema. Migrations `0032–0042` are NOT pushed; branch is NOT deployed. |
| Let dad in (OAuth) | ⛔ **Still pending** — publish the Google consent screen or add him as a test user, then approve at `/admin`. |
| Email (brief) | ⛔ **Still pending** — Gmail App Password (`GMAIL_USER`/`GMAIL_APP_PASSWORD`/`DIGEST_TO`). Brief renders in-app at `/brief` without it. |

---

## What the refactor shipped (by phase, all on `living-brain-refactor`)

- **P0 — foundations** (`0383eb3`): Haiku/Sonnet model tiering (`model.ts` — grunt→Haiku, judgment→Sonnet, escalate-on-retry); `CostMeter` + per-run/day/job ceilings (`normalize/budget.ts`); `writeNodeData` re-embed choke-point (`upsert.ts` — re-embeds only when embedded text changes; also fixed enrichment never re-embedding); the **assertable TS↔SQL sync-guard test** (`tests/unit/relations.test.ts`) over a previously-unguarded triple-sourced invariant.
- **P1 — richer graph** (`0383eb3`): 7 new node types — `catalyst, macro_factor, risk, product, commodity, organization, signal` — plus 7 STRONG + 2 WEAK edge relations. Migrations `0032` (assertable_v2), `0033` (search tsvector v2).
- **P2 — living graph** (`0383eb3`): fact lifecycle. Supersede-on-newer-source merge (`merge.ts`/`lifecycle.ts`, identity fields protected) with `node_revisions` history; news archival; price/metric snapshot pruning; per-node freshness provenance; re-embed on change. Migrations `0034`–`0039` (lifecycle col, node_revisions, provenance, metric_snapshots, prune fn, match_nodes excludes archived).
- **P3 — drop portfolio, add tracking** (`5734998`): **dropped the `positions` table** + all P&L code; new `/follow` CRUD + lightweight `owned` flag; `tracked_entities` gained `source/candidate_status/score/last_surfaced_at` + kind `discovered`. Migrations `0040` (drop positions — destructive), `0041` (candidate cols). The daily readers filter `candidate_status='active'` (the cost firewall).
- **P4 — strict critic** (`62f9b4a`): the thesis-judge (`server/critic/`) — gathers a thesis's evidence subgraph, grounds the model's claims (drops unverified quotes + hallucinated ids), and applies **`enforceFloor`**, a deterministic backstop that demotes any rating the verified evidence can't support (the model cannot inflate). Writes WEAK `confirms_thesis`/`challenges_thesis` edges + a verdict (strength + mandatory bear case). De-sycophantized Ask + brief-intro prompts; brief gained a "Thesis check-ins" section; thesis-verdict UI on `/node/[id]`.
- **P5 — web research + auto-discovery** (`dfdd42e`): Exa web-search adapter (`server/market/websearch.ts`, SSRF-hardened) + the gated `research_jobs` queue (`/research` page, `/api/research/run`, `server/research/`) — search → populate graph → strict sourced synthesis with a bear case. Auto-discovery (`detectConnections` in `daily.ts`) promotes cross-holding entities to tracked **candidates** (never fetched until promoted) and decays stale ones. Migration `0042` (research_jobs + claim RPC + a DB rate-limit backstop).
- **P6 — manual control** (`6566c91`): edit / archive / restore a node from its page (`node/[id]/actions.ts`, `components/node-editor.tsx`) — every edit snapshots a revision + re-embeds via the P0 choke-point; a server-side allowlist blocks editing identity/internal fields.

New code lives under `src/server/critic/`, `src/server/research/`, `src/app/(app)/{follow,research}/`, plus `server/market/websearch.ts` and `server/normalize/{budget,lifecycle}.ts`. Migrations now run `0001–0042` (gaps `0011–0015,0018–0022,0024` are intentional brain-lineage holes).

---

## Deploy the refactor (do these in order)

1. **Push the new migrations to cloud** (`0032–0042`): from the repo with the cloud project linked, `npx supabase db push`. ⚠️ **`0040` DROPS the `positions` table** — verify it's empty first (`select count(*) from positions;`); it's pre-use so this should be safe, but it deletes data.
2. **Regenerate types if developing further:** `npm run db:types` (the script was hardened to run from `/tmp` to dodge a Supabase CLI 2.106 config-parse bug — don't "simplify" it back).
3. **Set the new Vercel env vars** (both optional — features stay dormant without them):
   - `EXA_API_KEY` — open-web research (dashboard.exa.ai → API Keys). Without it, `/research` re-reads the existing graph only.
   - `RESEARCH_DAILY_QUOTA` — interactive research jobs per user per 24h (default 5).
   - The thesis-judge + research synth reuse the existing **`AI_GATEWAY_API_KEY`** (no new key).
4. **Merge** `living-brain-refactor` → `main` (open a PR for review, or fast-forward). Cadence stays **1×/day** on the existing Vercel cron (`0 11 * * 1-5` UTC) — the engine is built route-callable (`?stage=`) so multi-run can be added later with no rework.

---

## Cloud deploy state (unchanged from pre-refactor)

- **Supabase**: project ref `nrzyfqhfbseihxzwcvns` (`https://nrzyfqhfbseihxzwcvns.supabase.co`). Google provider enabled; redirect URI `…/auth/v1/callback` registered. Christian is active+admin. **Schema is still pre-refactor — see Deploy step 1.**
- **Vercel**: deployed off `main`; `vercel.json` cron `0 11 * * 1-5` UTC (~7am ET weekdays); auto-attaches `Authorization: Bearer $CRON_SECRET`.
- **Local stacks** (isolated from `brain`): `project_id "marketbrain"`, ports **5532x** main / **5533x** test. `npm run db:start` / `db:test:start`. See [[marketbrain-supabase-isolation]].

### Env var placement
Required in **Vercel**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY` (paid credits), `CRON_SECRET`. Recommended: `FINNHUB_API_KEY`. Optional: `FMP_API_KEY`, `SEC_EDGAR_UA`, `EXA_API_KEY`, `RESEARCH_DAILY_QUOTA`, `DIGEST_TZ`. Email (pending): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DIGEST_TO`. **Do NOT** put `GOOGLE_OAUTH_*` in Vercel (prod Google lives in the Supabase dashboard). `BOOTSTRAP_ADMIN_EMAIL` is read only by `scripts/seed.ts`.

---

## Outstanding / next steps

1. **Deploy the refactor** — the 4 steps above. This is the big one; nothing the branch built is live yet.
2. **Let dad in.** Publish the Google **OAuth consent screen** ("In production" — basic email/profile scopes, no verification needed) OR add his email as a **test user**. When he signs in, approve him at **`/admin`**.
3. **Email the brief.** Enable 2-Step Verification on a Gmail, generate an **App Password**, set `GMAIL_USER`/`GMAIL_APP_PASSWORD`/`DIGEST_TO` in Vercel. No code change — the cron picks it up. Until then the brief composes + archives to `/brief`.
4. **Verify the cloud graph is seeded** after migrating (`select count(*) from public.nodes;`). Re-run `npm run seed` against cloud if empty (needs `AI_GATEWAY_API_KEY` for embeddings).
5. **Smoke the cron end-to-end:** `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/daily` → JSON summary; check `/brief`. First run is quietest (no prior snapshots to diff).

### ⚠️ Father's Day send plan (don't spoil the surprise)
The brief emails whoever `DIGEST_TO` is — there is NO account/approval check on the recipient
(`send-digest.ts` sends unconditionally when `to` is set). So once the Gmail vars are live, dad gets a
morning email **regardless of having an account**. Two timing traps:
- The cron is `0 11 * * 1-5` (Mon–Fri, ~7am ET) → it would email dad on a **weekday before** Father's
  Day, AND it does **not run on Sunday** (Father's Day = Sun Jun 21, 2026), so it won't auto-send on the day.
- **Until the day:** set `DIGEST_TO` to YOUR OWN email (or unset `GMAIL_APP_PASSWORD`) + redeploy — any
  run goes to you, and you verify delivery works.
- **Father's Day morning:** set `DIGEST_TO` = dad's email, redeploy, then fire it manually (the schedule
  skips Sunday): `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/daily`.
  For ongoing daily delivery afterward, change the schedule to `0 11 * * *`.

### Deferred (additive — node types + brief sections already exist; these just auto-populate them)
- **FMP earnings/ratings → `catalyst` nodes** and **EDGAR filings → `filing` nodes**: the adapters exist and `liveMarketDeps` wires `earnings`/`ratings`/`filings`, but `runDailyForGraph` doesn't call them yet.
- **LLM connection-finder** (+ a `graph_insights` table) to surface non-obvious multi-hop connections in the brief — the brief's "New connections" today is the simpler ≥2-holdings traversal.
- **Full staged/resumable engine** (`engine_runs` cursor, time-budgeted stages) — current daily run is the single `runDailyForGraph` with per-step try/catch isolation, which is fine at 1×/day.

---

## Key decisions & gotchas (don't relearn these the hard way)

- **`edges.assertable` is triple-sourced** — the SQL generated-column literal (latest `0032`), `STRONG_RELATIONS` (`relations.ts`), and `isAssertable()`. A drift silently fabricates or kills facts; the `relations.test.ts` sync-guard now fails the build on drift. Keep them byte-identical.
- **`enforceFloor` is the anti-sycophancy guarantee** (`critic/calibration.ts`) — it's code, not prompt: a thesis can't be rated above what its *verified* evidence supports regardless of what the model says. Thesis edges stay WEAK so a verdict never looks like a tradeable fact.
- **`tracked_entities.candidate_status` is the cost firewall** — discovered candidates are NOT price/news-fetched. Every reader of `tracked_entities` in the daily path must filter `candidate_status='active'` or candidates silently cost API calls.
- **`writeNodeData` is the single node-mutation choke-point** — routes revision-snapshot + re-embed (only when embedded text changes). Use it for any node data/lifecycle write.
- **Web research is SSRF-sensitive** — `isPublicHttpUrl` blocks raw IPv6 + private ranges and `getText` uses `redirect:"error"`. Don't loosen these; web content is untrusted.
- **GRANTs ≠ RLS** — every new table needs explicit `grant` (+ `service_role` for cron/route-written) or it 403s.
- **Generated-column migrations (`0032`/`0033`) rewrite the table** — cheap now, run early. **One Vercel-Hobby cron/day.** **AI Gateway needs PAID credits.** Private companies have no quote API (guard on `is_public`).
- **`npm run db:types`** runs from `/tmp` on purpose (CLI 2.106 chokes on `config.toml`'s `env(OPENAI_API_KEY)`).

## Run / verify locally
```bash
npm install
npm run db:start && npm run db:reset && npm run seed
npm run dev            # http://localhost:3000
npm test               # 110 unit
npm run db:test:start && npm run db:test:reset && npm run test:integration   # 23, real test DB
npm run e2e            # 6 (auth-gate + cron-routes; authenticated flows are manual-verify)
```
