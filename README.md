# MarketBrain

A private **stock-market research knowledge graph** — a Father's Day gift for a casual-but-serious
investor who researches by reading the news and forming his own view. It is **not** a stock tracker:
it's a graph that grows organically around the names, themes, and theses he cares about, with a
**morning email brief** ("what changed on your names + what to look out for") as the flagship.

**Posture:** MarketBrain only **aggregates and surfaces** information and holds *his* notes/theses. It
**never** recommends buy/sell — there is no advice vocabulary anywhere in the model, prompts, or UI.

Ported from the `brain` knowledge-graph infra (Next.js 16 + Supabase + Vercel): the graph
(nodes/edges/pgvector/dedupe/embed/worker), the upload→normalize pipeline, the cron/drain queue,
auth/RLS, the force-graph viz, and the Ask/RAG module all carry over. What's domain-specific: the
node/edge **types**, schemas, the extraction prompt, the market data adapters, the daily cron, and the
brief.

## Architecture at a glance

- **Graph** — `nodes` (company, person, sector, theme, news, filing, thesis, note) + `edges` with an
  evidence-gated `assertable` column. A news article and a hand-written note are **both just
  `raw_uploads` rows** the worker turns into a node + edges. The daily cron *manufactures* news rows.
- **Dedupe** — ticker / CIK / canonical-URL / accession hard keys. A ticker match overrides name fuzz;
  a ticker *conflict* blocks a merge however similar the names (the fabricated-ticker guard).
- **Market adapters** (`src/server/market/*`) — Finnhub (quotes + news, primary), FMP (profile /
  earnings / ratings), Alpha Vantage (news fallback, 25/day), SEC EDGAR (filings, keyless + UA). Every
  call degrades to `[]`/`null`; a key being unset just makes that source dormant. Private companies
  (Anthropic, SpaceX) have no quote API, so callers guard on `is_public`.
- **Daily cron** (`/api/cron/daily`) — one job (Vercel Hobby allows 1/day) does fetch **and** brief:
  prices → `price_snapshots`, news → `raw_uploads` → drain → `news` nodes → ticker→holding `mentions`
  edges → compose + send the brief.
- **Brief** (`src/server/digest/*`) — graph deltas (movers, ranked news, filings, alerts, and the
  cross-holding connection-surfacing trick) → a pure `composeBrief` (LLM intro injected; template-only
  fallback) → Resend → archived in `digest_log` (which also powers the in-app `/brief`).

## Local development

Prereqs: Node 20+, Docker (for local Supabase), the Supabase CLI (bundled as a dev dep).

```bash
npm install
cp .env.example .env.local        # fill in keys as you get them (all market/AI keys are optional)
npm run db:start                  # starts the ISOLATED local stack (project "marketbrain", ports 5532x)
npm run db:reset                  # applies all migrations
npm run seed                      # seeds dad's graph (themes, companies, tracked entities, examples)
npm run dev                       # http://localhost:3000
```

> **Isolation:** MarketBrain's Supabase is fully separate from any other project. Local `project_id`
> is `marketbrain` on ports **5532x** (test stack `marketbrain_test` on **5533x**). Never point an env
> or client at another project's instance.

Useful scripts: `npm test` (unit), `npm run test:integration` (needs `npm run db:test:start` first),
`npm run e2e`, `npm run typecheck`, `npm run db:types` (regenerate `src/lib/database.types.ts`).

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | worker + cron (server only) |
| `AI_GATEWAY_API_KEY` | yes* | Claude extraction/brief + OpenAI embeddings (**needs PAID credits** — the free tier blocks the latest Claude) |
| `CRON_SECRET` | yes | Bearer token the daily cron requires (fail-closed) |
| `RESEND_API_KEY` / `RESEND_FROM` / `DIGEST_TO` | for the brief | sends the morning email (free tier only delivers to your own account email until a domain is verified) |
| `FINNHUB_API_KEY` | recommended | primary quotes + news |
| `FMP_API_KEY` | optional | profiles / earnings / ratings |
| `ALPHAVANTAGE_API_KEY` | optional | news fallback (25/day) |
| `SEC_EDGAR_UA` | optional | filings — must be `"Name email@example.com"` or SEC 403s |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | local auth | local Google sign-in (prod sets Google in the Supabase dashboard) |
| `BOOTSTRAP_ADMIN_EMAIL` | yes | promoted to active+admin by the seed |

\* Without `AI_GATEWAY_API_KEY` the app still runs, but extraction, Ask, and the LLM brief intro are
dormant (the brief falls back to template-only).

## Deploy

1. **Supabase cloud** — create a NEW project. `supabase link` it, then `supabase db push` (all
   migrations). Set Google as an auth provider (Auth → Providers) and add the prod redirect URIs in the
   Google Cloud console.
2. **Seed** — run `npm run seed` against the cloud project (service-role key + cloud URL in env), then
   confirm dad + you are `active` (you `is_admin`). Profiles only exist after each person signs in once,
   so re-run the seed (or a one-line `UPDATE`) after first login.
3. **Vercel** — import the repo, set every env var above. `vercel.json` registers the daily cron
   (`0 11 * * 1-5` UTC ≈ 7am ET pre-market, weekdays). Default Node runtime / Fluid Compute.
4. **Resend** — verify a sending domain (or confirm a real send to dad's address) before trusting the
   brief; the free tier otherwise only delivers to your own account email.
5. **Verify before relying on the schedule** — hit the cron once manually with the secret and confirm a
   real brief lands:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/daily
   ```

## Tests

- **Unit** (`tests/unit/`) — schemas, dedupe (ticker hard-key + conflict, URL canonicalization),
  relations (evidence/assertable), rank, P&L/allocation, compose (section selection/empty-state), tags,
  prompt guardrails. Pure, fast, every push.
- **Integration** (`tests/integration/`) — the daily cron against the isolated test Supabase with
  stubbed market/extractor/embedder + a fake Resend.
- **E2e** (`tests/e2e/`) — auth gate; `/api/cron/daily` with a bad secret → 401.
