# MarketBrain — handoff

_Last updated: 2026-06-17. Repo: `github.com/sha-sta/market-brain` (private). Branch `main`, head `5e697bf`._

A private **stock-market research knowledge graph** — a Father's Day gift. Not a stock tracker: a graph
that grows organically around the names/themes/theses the user cares about, with a **morning email
brief** as the flagship. **Posture: aggregate & surface only — never any buy/sell/recommend vocabulary.**
Ported from the `brain` knowledge-graph app (`~/Desktop/Projects/brain`); the graph/pipeline/auth/RLS
carried over, the domain types/prompt/adapters/cron/brief are finance-specific.

---

## Status at a glance

| Area | State |
| --- | --- |
| Code | ✅ Complete + on GitHub (8 commits). 94 TS/TSX files, 20 migrations, 12 test files. |
| Tests | ✅ 57 unit + 4 integration (real test DB) + 6 e2e. Production `next build` green. Typecheck clean. |
| Adversarial review | ✅ Ran; 7 confirmed findings all fixed (XSS, cron isolation, brief correctness, …). |
| Supabase cloud | ✅ Project `nrzyfqhfbseihxzwcvns`; all migrations pushed (13 tables live). Google auth working. |
| Vercel | ✅ Deployed; site loads; you're signed in as **admin**. |
| Seed | ⚠️ **Verify** — run `npm run seed` against cloud if the graph looks empty (see Outstanding). |
| Email (brief) | ⛔ **Pending** — Gmail App Password blocked by a Google security cooldown (you reset your password). Set 3 env vars when it clears. The brief already renders in-app at `/brief` without email. |
| EDGAR filings, alerts, thesis-judge | ⏸️ Deferred stretch (see Outstanding). |

---

## What's implemented

**Graph + pipeline (ported, finance-retyped)** — `src/server/normalize/*`
- Node types: `company, person, sector, theme, news, filing, thesis, note`.
- Edge vocab: STRONG `owns, in_sector, in_theme, founded_by, subsidiary_of, supplies_to, competes_with,
  listed_on, filed, insider_of`; WEAK `mentions, relevant_to, covers, confirms_thesis, challenges_thesis,
  co_occurs, relates_to`. The `assertable` generated column (migration `0025`) lists the STRONG set and
  **must stay in sync** with `relations.ts`.
- Dedupe hard keys (`dedupe.ts`): ticker / CIK / canonical-URL / accession. A hard-key match overrides
  name fuzz; a **conflict blocks** a merge (the fabricated-ticker guard).
- Extraction prompt (`prompt.ts`) forbids ticker fabrication + any advice. Extraction is `generateText`
  + `JSON.parse` (NOT `generateObject` — open frontmatter would return `{}`). Model = sonnet-4.6.
- Worker (`worker.ts`) reuses brain's orchestration; the scholarly author-enrichment seam is replaced by
  `enrichEntities` (`market/enrich.ts`) which grounds a company's cik/exchange/website in real data.

**Market adapters** — `src/server/market/*`
- `finnhub.ts` (quotes + news, **primary**), `fmp.ts` (profile/earnings/ratings), `alphavantage.ts`
  (news fallback, 25/day), `edgar.ts` (filings, keyless + UA-gated). All degrade to `[]`/`null` (never
  crash the cron); missing key ⇒ that source is dormant. `index.ts` assembles `liveMarketDeps()`.
- `rank.ts` — pure relevance+recency+materiality scoring (caps items before the LLM).
- `daily.ts` — `runDailyForGraph`: prices→`price_snapshots` (private cos skipped via `is_public`),
  news→`raw_uploads`→drain→`news` nodes→ticker→holding `mentions` edges. Injected deps ⇒ integration-tested.

**Morning brief** — `src/server/digest/*`
- `gather.ts` — movers, ranked news (+ the holdings each names), filings, alerts, and the cross-holding
  **connection-surfacing** ("TSMC appears across 3 of your holdings").
- `compose.ts` — **pure** `composeBrief` (LLM intro injected; template-only fallback; no-advice footer;
  http(s)-only hrefs).
- `gmail.ts` (preferred sender, no domain) / `resend.ts` (alt sender) / `summarize.ts` (sonnet intro) /
  `send-digest.ts` (ET-date idempotency; archives to `digest_log`).

**App** — `src/app/*`, `src/components/*`, `src/lib/*`
- Google sign-in + approved-users allowlist (pending → admin-approve → active). `/admin` approval queue
  (admin-only nav link). `(app)` route group: home graph + Happy Father's Day hero, `/portfolio`
  (live P&L, concentration), `/brief` (archived html), `/dump`, `/ask` (RAG; ASK_SYSTEM de-advised),
  `/node/[id]`, graph viz recolored for finance. Cron at `/api/cron/daily` (CRON_SECRET fail-closed,
  `maxDuration=300`, one job does fetch + brief).
- Portfolio math (`lib/portfolio.ts`) is pure + tested: public = price×shares vs cost; private = manual_value.

**Database** — `supabase/migrations/0001–0031`
- Graph core (`0001–0010,0016,0017`) + adapted `0023` (composite-PK graph isolation, outreach/author
  bits stripped) + finance `0025–0031` (assertable revocab, tracked_entities, positions, price_snapshots,
  alert_rules/events, digest_log, raw_uploads `news` kind + `source_ref`). 13 tables. Every new table has
  RLS **and** explicit GRANTs (RLS alone 403s); cron-written tables grant `service_role`.

---

## Repo layout

```
src/server/normalize/   graph pipeline (types/schemas/prompt/dedupe/relations/worker/upsert/…)
src/server/market/      adapters (finnhub/fmp/alphavantage/edgar), index, enrich, rank, daily (cron logic)
src/server/digest/      gather/compose/summarize, gmail/resend senders, send-digest
src/server/ask/         RAG prompt + retrieve
src/lib/                auth, env, graphs, supabase clients, portfolio, graph-style, observability
src/app/(app)/          authed pages: home, portfolio, brief, dump, ask, admin, node/[id]
src/app/api/cron/daily/ the daily cron route
supabase/migrations/    0001–0031
scripts/seed.ts         seeds dad's graph (run after db push)
tests/{unit,integration,e2e}/
```

## Run locally

```bash
npm install
# .env.local already has the local isolated stack pointed at ports 5532x (see below)
npm run db:start && npm run db:reset && npm run seed
npm run dev            # http://localhost:3000
npm test               # unit
npm run db:test:start && npm run db:test:reset && npm run test:integration
npm run e2e
```

**Supabase isolation (important):** MarketBrain's local stack is fully separate from `brain`.
`project_id "marketbrain"`, ports **5532x** (main) / **5533x** (test). `.env.local` → `127.0.0.1:55321`,
`.env.test.local` → `127.0.0.1:55331`. Local demo JWT keys (non-secret). Two local stacks may currently
be running — `npm run db:stop` / `npm run db:test:stop` to stop.

---

## Deploy state (cloud)

- **Supabase**: project ref `nrzyfqhfbseihxzwcvns` (`https://nrzyfqhfbseihxzwcvns.supabase.co`). All
  migrations pushed (verified via schema dump — 13 tables + all RPCs). Google provider enabled.
  Google OAuth client has the redirect URI `https://nrzyfqhfbseihxzwcvns.supabase.co/auth/v1/callback`.
  Site URL + redirect URLs set to the Vercel domain.
- **Vercel**: deployed; `vercel.json` registers the daily cron `0 11 * * 1-5` UTC (~7am ET weekdays).
  Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` to scheduled runs.
- **You** are promoted to active+admin (out-of-band SQL — the first admin always is).

### Env vars (where each lives)
Required in **Vercel**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY` (paid credits), `CRON_SECRET`. Recommended:
`FINNHUB_API_KEY`. Optional: `FMP_API_KEY`, `SEC_EDGAR_UA` (inert until filings wired), `DIGEST_TZ`.
Email (pending): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `DIGEST_TO`. **Do NOT** put `GOOGLE_OAUTH_*` in
Vercel (local-dev only; prod Google is in the Supabase dashboard). `BOOTSTRAP_ADMIN_EMAIL` is only read
by `scripts/seed.ts`.

---

## Outstanding / next steps

1. **Verify the cloud graph is seeded.** In Supabase SQL Editor: `select count(*) from public.nodes;`
   (expect 20) and `select id,name from public.graphs;` (expect the renamed "Dad's Market"). If empty,
   run the seed against cloud:
   ```bash
   NEXT_PUBLIC_SUPABASE_URL="https://nrzyfqhfbseihxzwcvns.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \
   AI_GATEWAY_API_KEY="<ai gateway key>" \
   BOOTSTRAP_ADMIN_EMAIL="yoonchristian2025@gmail.com" \
   DIGEST_TO="<dad's email>" \
   npm run seed
   ```
   (Embeddings need the AI key; without it nodes seed with null embeddings and Ask/news-linking are weaker.)
2. **Email the brief.** When the Google security cooldown clears: enable 2-Step Verification on a Gmail
   (any account — a fresh one works), generate an **App Password** (Google Account → Security → App
   passwords), and set `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `DIGEST_TO` in Vercel. No code change/redeploy
   — the cron picks it up next run. Until then the brief composes + archives to `/brief` (status `archived`).
3. **Let dad in.** Publish the Google **OAuth consent screen** to "In production" (safe — only basic
   email/profile scopes, no verification needed) OR add dad's email as a **test user**. When he signs in,
   approve him at **`/admin`**.
4. **Verify the cron end-to-end** before trusting the schedule:
   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-app>.vercel.app/api/cron/daily
   ```
   Expect a JSON summary; check `/brief`. (First run is quietest — no prior snapshots to diff.)

### Deferred stretch (not built — the plan's designated slip order)
- **EDGAR filings step in the cron.** The `edgar` adapter + `MarketDeps.filings` exist and `gather.ts`
  already reads `filing` nodes, but `daily.ts` does **not** call `market.filings` yet, so no filing nodes
  are created. ~30 min to wire (`SEC_EDGAR_UA` is inert until then).
- **Alerts** (`alert_rules`/`alert_events` tables exist; no evaluator/UI) and **thesis-judge**
  (`confirms_thesis`/`challenges_thesis` edges). Both pure-logic additions.

---

## Key decisions & gotchas (don't relearn these the hard way)

- **GRANTs ≠ RLS.** Every new table needs explicit `grant` (+ `service_role` for cron-written tables) or
  it 403s. pgvector RPCs need `set search_path = public, pg_catalog`.
- **`edges.assertable` is a hardcoded literal list** (migration `0025`) — keep it identical to
  `STRONG_RELATIONS` in `relations.ts` or no edge is ever assertable.
- **Extraction stays `generateText` + `JSON.parse`.** `generateObject` returns `{}` for open frontmatter.
- **Private companies (Anthropic, SpaceX) have no quote API** — every market call is guarded on `is_public`.
- **One Vercel-Hobby cron/day** — the single `/api/cron/daily` does fetch + brief together; never split.
- **Resend** (and every email provider) needs a verified domain to email arbitrary inboxes → we use
  **Gmail SMTP + App Password** instead (no domain).
- **AI Gateway needs PAID credits** (free tier blocks the latest Claude).
- The cron isolates each graph + each ticker in try/catch (one failure can't abort the run). The brief
  only renders http(s) URLs (XSS guard). `num()` returns null (not 0) for blank strings (no fabricated figures).

## Verify the deploy is healthy (read-only)
The migration history + schema were confirmed via `npx supabase db dump` (the Supabase Table-editor UI
glitched during an outage and falsely showed "no tables" — the tables were always there). To re-check
remote tables any time: Supabase SQL Editor → `select table_name from information_schema.tables where
table_schema='public' order by 1;`.
