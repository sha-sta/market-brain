# MarketBrain

A private **stock-market research knowledge graph**, originally built as a Father's Day gift for my dad,
a casual-but-serious investor who researches by reading the news and forming his own view. It is **not**
a stock tracker: it's a graph that grows organically around the names, themes, and theses you care about,
with a **morning email brief** ("what changed on your names + what to look out for") as the flagship.

**Posture:** MarketBrain only **aggregates and surfaces** information and holds *your* notes/theses. It
**never** recommends buy/sell as there is no advice vocabulary anywhere in the model, prompts, or UI.

Built on Next.js 16 + Supabase + Vercel. The generic knowledge-graph core
(nodes/edges/pgvector/dedupe/embed/worker), the upload→normalize pipeline, the cron/drain queue,
auth/RLS, the force-graph viz, and the Ask/RAG module are domain-agnostic. What's market-specific: the
node/edge **types**, schemas, the extraction prompt, the market data adapters, the daily cron, and the
brief.

## Who it's for

A single investor who tracks a watchlist of names and industries and wants research that maintains itself: the graph grows from a daily feed, drops what no longer matters, corrects facts when sources change, and emails a short brief each weekday morning. Typical uses:

- Keep a living map of the companies, people, sectors, and themes you follow, and how they connect.
- Get a daily brief of what changed on those names (price moves, news, filings, thesis checks).
- Write down a thesis and have it tested against the evidence in the graph, with no buy/sell advice.
- Ask the graph a question, or queue a deeper research run on a topic.

For how MarketBrain compares to similar tools (Graphiti, GraphRAG, Perplexity Finance), see [RESEARCH.md](./RESEARCH.md).

## Architecture at a glance

- **Graph**: 15 typed `nodes` (company, person, sector, theme, news, filing, thesis, catalyst, risk,
  signal, macro_factor, product, commodity, organization, note) + `edges` with an evidence-gated
  `assertable` column. Each node carries a `lifecycle` (`active`/`stale`/`archived`/`superseded`). A
  news article and a hand-written note are **both just `raw_uploads` rows** the worker turns into a node + edges. The daily cron *manufactures* news rows.
- **Dedupe**: ticker / CIK / canonical-URL / accession hard keys. A ticker match overrides name fuzz;
  a ticker *conflict* blocks a merge however similar the names (the fabricated-ticker guard).
- **Market adapters** (`src/server/market/*`): Finnhub (quotes + news, primary), FMP (profile /
  earnings / ratings), Alpha Vantage (news fallback, 25/day), SEC EDGAR (filings, keyless + UA). Every
  call degrades to `[]`/`null`; a key being unset just makes that source dormant. Private companies
  (Anthropic, SpaceX) have no quote API, so callers guard on `is_public`.
- **Daily cron** (`/api/cron/daily`): one job (Vercel Hobby allows 1/day) does fetch **and** brief:
  prices → `price_snapshots`, news (capped per company) → `raw_uploads` → drain → `news` nodes →
  ticker→holding `mentions` edges → living-graph upkeep (decay/delete, auto-discovery, gap-fill,
  thesis-judge, thesis-supersede) → compose + send the brief. The LLM-heavy steps are **time-boxed**
  against a soft deadline that reserves the tail of the 300s budget for the send, so the email never
  gets starved.
- **Brief** (`src/server/digest/*`): graph deltas (movers, ranked news, filings, alerts, thesis checks,
  and the cross-holding connection-surfacing trick) → a pure `composeBrief` (LLM intro injected;
  template-only fallback) → Gmail SMTP (preferred) or Resend → archived in `digest_log` (which also
  powers the in-app `/brief`).

## Living graph (self-updating, lean)

The graph keeps itself **current and small** without manual gardening. Every mutation routes through the
single `writeNodeData` choke-point, so each one snapshots a reversible `node_revisions` row and re-embeds
only when the embedded text actually changed.

- **Tiered decay + reference-guarded hard delete.** The extractor assigns each chronological node
  (news / catalyst / signal) a permanence `_tier`, with timelines `ephemeral` (days) → `routine` (weeks) → `notable`
  (months) → `landmark` (never) that is biased to keep longer when unsure. `decayWindow(type, tier)`
  (`server/normalize/lifecycle.ts`) maps that to an **archive** window (soft-hide, recoverable) and a
  later **delete** window. A SQL function (`prune_archived_nodes`) then *actually deletes* long-archived
  nodes to reclaim the row + its pgvector embedding on the free-tier DB, but it is **reference-aware**:
  it never deletes a node that is evidence for a live thesis or is linked to an active tracked entity.
  Landmark events and filings (the primary record) never delete; theses, notes, and structural nodes
  (company/person/sector/…) never decay at all. The SQL delete windows are kept byte-honest with the TS
  map by a sync-guard unit test. Archived nodes are browsable + restorable at `/archived`.
- **Thesis lifecycle.** Theses are standing *opinions*, so they're **replaced, never aged out**. When a
  freshly-added thesis near-restates an existing one about the same subject (embedding similarity ≥ 0.92),
  the old one is auto-marked `superseded` (pointing at the new via `superseded_by`) and the strict critic
  stops re-judging it. `/theses` lists each thesis with its verdict and an add-thesis box that pipes text
  through the **same** dump → extract pipeline as everything else (no bespoke insert path).
- **Fact reconciliation.** When the source text explicitly states a fact changed on a *permanent* node
  (a CEO leaves, a company renames, guidance is revised), the extractor emits a `corrections` entry with
  **no extra LLM call**, and instead rides the extraction already running. High-confidence + verbatim-verified
  changes auto-apply; mid-confidence ones queue for review (`correction_queue`). A rename appends
  `former_name`/`aliases` and **never** overwrites the dedupe hard-key `name`; a role change retires the
  now-false `insider_of` edge.
- **Structural gap-fill.** Once a week, a bounded, deadline-guarded pass grounds essential identity facts
  (cik / exchange / website) on tracked companies via the market adapters (no LLM), which adds the durable
  facts the graph is *missing* rather than piling on more news.

## Local development

Prereqs: Node 20+, Docker (for local Supabase), the Supabase CLI (bundled as a dev dep).

```bash
npm install
cp .env.example .env.local        # fill in keys as you get them (all market/AI keys are optional)
npm run db:start                  # starts the ISOLATED local stack (project "marketbrain", ports 5532x)
npm run db:reset                  # applies all migrations
npm run seed                      # seeds an example graph (themes, companies, tracked entities, examples)
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
| `AI_GATEWAY_API_KEY` | yes* | Claude extraction/brief + OpenAI embeddings (**needs PAID credits** as the free tier blocks the latest Claude) |
| `CRON_SECRET` | yes | Bearer token the daily cron requires (fail-closed) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `DIGEST_TO` | for the brief | **preferred** and sends the morning email from a Gmail account via an App Password (no domain needed, reaches any inbox). `DIGEST_TO` defaults to `GMAIL_USER`. |
| `RESEND_API_KEY` / `RESEND_FROM` | alt sender | only used if `GMAIL_APP_PASSWORD` is unset; needs a verified domain to reach arbitrary recipients |
| `FINNHUB_API_KEY` | recommended | primary quotes + news |
| `FMP_API_KEY` | optional | profiles / earnings / ratings |
| `ALPHAVANTAGE_API_KEY` | optional | news fallback (25/day) |
| `SEC_EDGAR_UA` | optional | filings; must be `"Name email@example.com"` or SEC 403s |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | local auth | local Google sign-in (prod sets Google in the Supabase dashboard) |
| `BOOTSTRAP_ADMIN_EMAIL` | yes | promoted to active+admin by the seed |

\* Without `AI_GATEWAY_API_KEY` the app still runs, but extraction, Ask, and the LLM brief intro are
dormant (the brief falls back to template-only).

## Deploy

1. **Supabase cloud**: create a NEW project. `supabase link` it, then `supabase db push` (all
   migrations). Set Google as an auth provider (Auth → Providers) and add the prod redirect URIs in the
   Google Cloud console.
2. **Seed**: run `npm run seed` against the cloud project (service-role key + cloud URL in env), then
   confirm your users are `active` (your account `is_admin`). Profiles only exist after each person signs in once,
   so re-run the seed (or a one-line `UPDATE`) after first login.
3. **Vercel**: import the repo, set every env var above. `vercel.json` registers the daily cron
   (`0 11 * * 1-5` UTC ≈ 7am ET pre-market, weekdays). Default Node runtime / Fluid Compute.
4. **Email**: preferred (no domain): enable 2-Step Verification on a Gmail account, generate an App
   Password (Google Account → Security → App passwords), and set `GMAIL_USER` + `GMAIL_APP_PASSWORD`
   (+ `DIGEST_TO` = the recipient's email). Delivers to any inbox. (Alternative: set `RESEND_API_KEY` +
   `RESEND_FROM` instead, but Resend needs a verified sending domain to reach arbitrary recipients.)
5. **Verify before relying on the schedule**: hit the cron once manually with the secret and confirm a
   real brief lands:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/daily
   ```

- **Unit** (`tests/unit/`, ~144): schemas, dedupe (ticker hard-key + conflict, URL canonicalization),
  relations (evidence/assertable), critic calibration, rank, compose (section selection/empty-state),
  tags, prompt guardrails, **tiered-decay windows + the SQL↔TS sync-guard**, the **time-box deadline**,
  **thesis-supersede rules**, **fact-reconciliation gating**, and the **gap-fill throttle**. Pure, fast.
- **Integration** (`tests/integration/`, ~56): against the isolated test Supabase with stubbed
  market/extractor/embedder/judge: the daily cron, **tiered decay + reference-guarded hard delete**
  (incl. every protection guard), **thesis supersede + the judge ignoring superseded theses**, **fact
  reconciliation** (apply/queue/drop, rename, edge-expiry), **gap-fill**, and the headline guarantee
  that **a slow judge can't starve the digest send**.
- **E2e** (`tests/e2e/`, 6): the auth gate (gated routes redirect to sign-in); cron routes fail closed
  (a bad `CRON_SECRET` → 401 JSON, not an auth redirect).

The local ship gate is `npm run build` + `npm test` green; integration + e2e are run before any
lifecycle-touching change.
