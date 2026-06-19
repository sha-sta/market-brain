# MarketBrain — handoff

_Last updated: 2026-06-19. Repo: `github.com/sha-sta/market-brain` (private)._
_Active branch: **`main`** (head `885e733`). The whole living-brain refactor AND the dark-mode UI are
merged to `main` and **deployed to Vercel prod** (build green on each push). `living-brain-refactor`
still exists but is now **stale** (3 commits behind `main`) — treat `main` as the source of truth; you
can delete the old branch._

A private **stock-market research knowledge graph** — a Father's Day gift for the user's dad ("Appa").
A self-updating research brain: he tracks names/industries he cares about, the graph refreshes and
amends itself (swaps stale facts, archives dead news, re-judges theses), discovers cross-connections,
researches topics from the open web on request, and produces **strict, non-sycophantic** theses.
**Posture: aggregate & surface only — never any buy/sell/recommend vocabulary.**

---

## ⚠️ Read first — the three things that can be broken right now

1. **Cloud DB schema is UNVERIFIED.** The code on prod (`main`) expects migrations **`0032–0042`**
   (research_jobs, node_revisions, dropped `positions`, lifecycle cols, etc.). A Vercel code deploy
   does **NOT** run migrations. If `npx supabase db push` was never run against the cloud project,
   prod will **500 at runtime** on `/research`, node edit, thesis verdicts, etc. **Verify before
   demoing:** in the cloud SQL editor run `select count(*) from research_jobs;` and
   `select count(*) from node_revisions;` — if either errors with "relation does not exist", push the
   migrations (Deploy step 1). The app building green does NOT prove the DB is migrated.
2. **Father's Day send trap (surprise-critical).** The brief emails whoever `DIGEST_TO` is, with NO
   account/approval check (`send-digest.ts` sends whenever `to` is set). The Vercel cron is
   `0 11 * * 1-5` (Mon–Fri ~7am ET). **If `DIGEST_TO` is already set to Appa's email and a sender is
   configured, he gets a brief on a weekday before Father's Day (Sun Jun 21, 2026).** Keep `DIGEST_TO`
   = your own email until the day. See "Father's Day send plan" below.
3. **Daily digest email is NOT arriving (open issue, 2026-06-19).** Enrichment ran but no email was
   sent. Confirmed via `vercel env ls`: prod HAS `GMAIL_USER` + `GMAIL_APP_PASSWORD` + `DIGEST_TO`
   (sender = Gmail SMTP, since `GMAIL_APP_PASSWORD` is set → `route.ts:58`); **Resend is gone**
   (`RESEND_*` absent — intentional). So it's not "env unset." The mail adapters **degrade silently**
   (`gmail.ts`/`resend.ts` catch + `reportError`, never throw), so a failure leaves the brief
   `archived`/`failed` with no user-visible error. **Zero-risk discriminator — check `/brief`:**
   - If `/brief` shows **today's** date → compose+archive ran, so the failure is at SEND: almost
     certainly the **Gmail App Password is invalid** (history: it was blocked after a password reset;
     also a 16-char Google app password pasted WITH its spaces fails SMTP auth). Fix: regenerate the
     App Password (Google Account → Security → App passwords), set it in Vercel **with no spaces**,
     redeploy.
   - If `/brief` has **no today entry** → the cron likely **timed out** (`maxDuration = 300s`):
     `route.ts` runs `runDailyForGraph` (incl. the Sonnet thesis-judge over ALL theses) and THEN
     `sendDigestForGraph`, sequentially per graph — slow enrichment can eat the budget before the
     digest runs. Fix options: split fetch from send, or speed/cap the judge.
   Authoritative confirmation either way: re-fire the cron and read the returned JSON
   `results[].digest.{status,reason}` — but ONLY after confirming `DIGEST_TO` = your own email (it
   sends). Idempotent: if today's row is already `sent`, re-firing returns `skipped` and sends nothing
   (so if it "sent" but you saw nothing, check spam).

---

## Status at a glance

| Area | State |
| --- | --- |
| Refactor code (6 phases) | ✅ Merged to `main` (PR #1 `d495825`), deployed to prod. |
| Dark-mode UI + "Appa" message + dark email | ✅ Merged to `main` (`45a5c65`, `885e733`), deployed to prod. |
| Tests | ✅ 110 unit + 23 integration (real test DB) + 6 e2e. `next build` green. Typecheck clean. |
| Vercel prod | ✅ Auto-deploys `main`. Last 3 deploys succeeded (UI, merge, dark email). |
| **Cloud Supabase schema** | ⚠️ **UNVERIFIED** — see "Read first" #1. Code expects `0032–0042`. |
| Let Appa in (OAuth) | ⛔ **Pending** — publish the Google consent screen or add him as a test user, then approve at `/admin`. |
| Email (brief) | ⛔ **Pending** — Gmail App Password OR Resend (`GMAIL_USER`/`GMAIL_APP_PASSWORD` or `RESEND_API_KEY`/`RESEND_FROM`, plus `DIGEST_TO`). Brief also renders in-app at `/brief`. |

---

## What shipped most recently (the UI session, 2026-06-19)

Dark "financial-terminal" restyle + copy changes. **Visual/copy only — no logic, schema, or new deps
beyond the IBM Plex Mono webfont.**

- **Theme** (`src/app/globals.css`): single fixed **dark charcoal** theme driven by CSS vars —
  `--background #0f1113`, `--surface #16191c`, `--foreground #ececed`, `--muted #8d939b`,
  `--border #262a2f`, plus `--ok/--warn/--danger` and a `--font-mono` slot. `html { font-size: 17px }`
  is the **one lever** for Appa's eyesight (uniform ~+6%; bump it there if he wants larger).
- **Typography** (`src/app/layout.tsx`): Newsreader serif still carries prose/headings; **IBM Plex
  Mono** added for data only (counts, tickers, field keys, type labels, legend) — the terminal feel.
- **De-hardcoded colors**: graph node tints + canvas links (`lib/graph-style.ts`,
  `components/graph-canvas.tsx`), thesis-strength badges (`components/thesis-verdict.tsx`), and every
  stray `gray/blue/red` default class → theme tokens (monochrome underlined links, `text-danger`,
  `hover:bg-foreground/[0.06]`). Surface elevation on dropdowns/tooltips/hero.
- **Message** (`components/father-day-hero.tsx`): "Happy Father's Day, **Appa**." → concise plain
  copy → "Love, Christian". Admin helper line `dad` → `Appa`.
- **Em dashes removed** from all user-visible copy (pages, error messages, the daily email's
  footer/intro/labels, revision history). Left only in code comments + LLM system prompts.
- **Dark email** (`src/server/digest/compose.ts`): the morning brief is now a self-contained **dark
  terminal card** (inline colors + hairline border so it renders consistently in mail clients and on
  `/brief`). Verified by rendering the real `composeBrief` output in a browser; the 8 compose unit
  tests still pass.

### Known stale-data quirk (not a bug)
`/brief` replays **frozen HTML** stored in `digest_log.html` at compose time. Briefs composed *before*
the dark-email change are permanently light in the DB. New briefs are dark. To clear an old white one,
run ONE of these in the cloud **Supabase SQL editor** (prod DB writes — do them yourself):
```sql
-- A) delete old pre-launch test briefs (cleanest; /brief then shows the dark empty state)
delete from digest_log;

-- B) or recolor an existing brief in place (idempotent; only touches old light rows)
update digest_log set html =
  replace(replace(replace(replace(replace(replace(replace(
    html,'#faf9f6','#16191c'),'#1c1b19','#ececed'),'#6b675f','#8d939b'),
    '#e7e4dc','#262a2f'),'#1a7f4b','#3fb27f'),'#a32f2f','#e5685f'),'#b8860b','#d9a441')
where html like '%#faf9f6%';
```
Do **not** "regenerate" by firing the prod cron unless `DIGEST_TO` is your own email (it sends).

---

## What the refactor shipped (by phase — all now on `main`)

- **P0 — foundations**: Haiku/Sonnet model tiering (`normalize/model.ts`); `CostMeter` + per-run/day/job
  ceilings (`normalize/budget.ts`); `writeNodeData` re-embed choke-point (`normalize/upsert.ts`); the
  **assertable TS↔SQL sync-guard test** (`tests/unit/relations.test.ts`).
- **P1 — richer graph**: 14 node types total (added `catalyst, macro_factor, risk, product, commodity,
  organization, signal`) + STRONG/WEAK relations. Migrations `0032` (assertable_v2), `0033` (search v2).
- **P2 — living graph**: fact lifecycle — supersede-on-newer-source merge (`normalize/merge.ts` /
  `lifecycle.ts`) with `node_revisions` history; news archival; snapshot pruning; per-node provenance;
  re-embed on change. Migrations `0034–0039`.
- **P3 — drop portfolio, add tracking**: **dropped `positions`** + all P&L; `/follow` CRUD + `owned`
  flag; `tracked_entities` gained `source/candidate_status/score/last_surfaced_at` + `discovered` kind.
  Migrations `0040` (drop positions — destructive), `0041` (candidate cols). Daily readers filter
  `candidate_status='active'` (the cost firewall).
- **P4 — strict critic** (`server/critic/`): thesis-judge grounds claims, drops unverified quotes, and
  `enforceFloor` deterministically demotes any rating the verified evidence can't support. Writes WEAK
  `confirms_thesis`/`challenges_thesis` edges + a verdict (strength + mandatory bear case).
- **P5 — web research + auto-discovery**: Exa adapter (`server/market/websearch.ts`, SSRF-hardened) +
  gated `research_jobs` queue (`/research`, `/api/research/run`, `server/research/`). Auto-discovery
  (`detectConnections` in `market/daily.ts`) promotes cross-holding entities to tracked **candidates**.
  Migration `0042` (research_jobs + claim RPC + DB rate-limit backstop).
- **P6 — manual control**: edit/archive/restore a node from its page (`node/[id]/actions.ts`,
  `components/node-editor.tsx`) — every edit snapshots a revision + re-embeds; server-side allowlist
  blocks editing identity/internal fields.

Migrations run `0001–0042` (gaps `0011–0015,0018–0022,0024` are intentional brain-lineage holes).

---

## Deploy (current model)

**Vercel auto-deploys `main` to prod on every push.** So shipping = merge to `main` + push. The cron is
`0 11 * * 1-5` UTC (`vercel.json`) and auto-attaches `Authorization: Bearer $CRON_SECRET`.

If the cloud DB is NOT yet migrated (see "Read first" #1):
1. **Push migrations to cloud** from the repo with the cloud project linked (ref `nrzyfqhfbseihxzwcvns`):
   `npx supabase db push`. ⚠️ **`0040` DROPS `positions`** — verify it's empty first; it's pre-use so
   this should be safe, but it deletes data.
2. **Regenerate types** only if developing further: `npm run db:types` (hardened to run from `/tmp` to
   dodge a Supabase CLI 2.106 config-parse bug — don't "simplify" it back).
3. **Seed** the cloud graph if empty after migrating: `npm run seed` (needs `AI_GATEWAY_API_KEY` for
   embeddings). Verify `select count(*) from public.nodes;`.

### Env var placement
Required in **Vercel**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `AI_GATEWAY_API_KEY` (paid credits), `CRON_SECRET`. Recommended:
`FINNHUB_API_KEY`. Optional: `FMP_API_KEY`, `SEC_EDGAR_UA`, `EXA_API_KEY`, `RESEARCH_DAILY_QUOTA`,
`DIGEST_TZ`. Email (pending): `GMAIL_USER` + `GMAIL_APP_PASSWORD`, OR `RESEND_API_KEY` + `RESEND_FROM`;
plus `DIGEST_TO`. **Do NOT** put `GOOGLE_OAUTH_*` in Vercel (prod Google lives in the Supabase
dashboard). `BOOTSTRAP_ADMIN_EMAIL` is read only by `scripts/seed.ts`.

### Cloud refs
- **Supabase**: project ref `nrzyfqhfbseihxzwcvns` (`https://nrzyfqhfbseihxzwcvns.supabase.co`). Google
  provider enabled; redirect URI `…/auth/v1/callback` registered. Christian is active+admin.
- **Local stacks** (isolated from `brain`): `project_id "marketbrain"`, ports **5532x** main / **5533x**
  test. `npm run db:start` / `db:test:start`. See [[marketbrain-supabase-isolation]].

---

## Outstanding / next steps (in priority order)

1. **Verify (or run) the cloud DB migration** — "Read first" #1. Nothing the refactor built works in
   prod until the cloud schema matches `0032–0042`.
2. **Let Appa in.** Publish the Google **OAuth consent screen** ("In production", basic scopes, no
   verification needed) OR add his email as a **test user**. When he signs in, approve at **`/admin`**.
3. **Fix the digest email (OPEN).** Env is already set in prod (Gmail sender + `DIGEST_TO`; Resend
   removed). Diagnose with the `/brief`-today discriminator in "Read first" #3 → fix the Gmail App
   Password (most likely) or the 300s cron timeout. No code change needed for the App-Password path.
4. **Fix age-only news archival** (decay audit, above): don't archive a `news` node still referenced by
   an active thesis / tracked entity, or it silently drops out of thesis evidence + RAG after 45d.
5. **Seed the graph so Appa doesn't start empty** — see "Seed the graph" appendix below. Test it
   yourself first (ideally in a separate graph via the top-left graph selector), confirm it populates,
   wipe the test data, then hand him the same `seed.md` on the day.
6. **Smoke the cron end-to-end** (only after `DIGEST_TO` = your own email):
   `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>.vercel.app/api/cron/daily` → JSON
   summary; check `/brief` renders dark.

### ⚠️ Father's Day send plan (don't spoil the surprise)
- Cron `0 11 * * 1-5` (Mon–Fri ~7am ET) → it would email Appa on a **weekday before** Father's Day,
  AND it does **not run Sunday** (Father's Day = Sun Jun 21, 2026), so it won't auto-send on the day.
- **Until the day:** `DIGEST_TO` = YOUR email (or unset the sender) + redeploy — runs go to you.
- **Father's Day morning:** set `DIGEST_TO` = Appa's email, redeploy, then fire it manually (schedule
  skips Sunday): `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/daily`.
  For ongoing daily delivery afterward, change the schedule to `0 11 * * *`.

### Deferred (additive — node types + brief sections already exist; these just auto-populate them)
- **FMP earnings/ratings → `catalyst` nodes**, **EDGAR filings → `filing` nodes**: adapters exist and
  `liveMarketDeps` wires them, but `runDailyForGraph` doesn't call them yet.
- **LLM connection-finder** (+ a `graph_insights` table) for non-obvious multi-hop connections.
- **Full staged/resumable engine** (`engine_runs` cursor) — current daily run is fine at 1×/day.

---

## Decay & lifecycle — audit (2026-06-19) + the one fishy thing to fix

Investigated because of the worry "nodes might disappear that shouldn't." **Bottom line: NO node is
ever deleted by decay, and only `news` nodes ever auto-change state.** Four distinct mechanisms:

| Mechanism | Touches | Effect | Reversible |
| --- | --- | --- | --- |
| **News archival** (`archiveStaleNews`, `daily.ts:228`) | **only `type='news'`** | age > 45d (120d if `materiality='high'`) → `lifecycle='archived'`; hidden from graph/RAG/brief, **edges kept, revision snapshotted** | ✅ restore on node page |
| **Snapshot prune** (`prune_snapshots`, `0038`) | `price_snapshots` + `metric_snapshots` rows | downsample old time-series (keep <90d, weekly→2y, drop >2y) — **never nodes/edges** | n/a |
| **Candidate decay** (`detectConnections`, `daily.ts:265`) | `tracked_entities` rows | auto-*discovered* candidates not re-surfaced in 21d → `candidate_status='dropped'`; **node untouched**, `manual`/`active` protected | re-follow |
| **Field supersede** (`decideSupersede`, `lifecycle.ts:38`) | fields inside ONE node | newer source overwrites only **narrative** fields; **identity** (ticker/cik/name/url) never; structural = fill-only; old value → `node_revisions` | ✅ revision history |

Companies/people/sectors/themes/theses/products/commodities/orgs/catalysts/macro_factors/risks/signals/
notes **never auto-archive or auto-delete.** The only hard `DELETE`s in the codebase are the dedup-merge
RPCs (`0017`, `0023`) — collapsing duplicate nodes, not time-driven.

**The one fishy thing (fix next session):** `archiveStaleNews` archives news **purely on age, with NO
"still referenced" guard** — despite `lifecycle.ts:69` claiming it archives "(if also unreferenced)."
So a >45d article that is the **evidence for an active thesis** (a `confirms_thesis`/`challenges_thesis`
edge) or still mentioned by a holding gets archived anyway, and the thesis-judge (`subgraph.ts:57`) +
RAG both exclude archived nodes — so **a thesis can silently lose its supporting evidence after 45d.**
Nothing is deleted (restorable), but it drops out of view/judgment. Fix: before archiving a news node,
skip it if it has an incoming edge from an `active` thesis (or any edge from an active tracked entity),
or extend the window for referenced news. Two minor notes while there: `lifecycle='stale'` and whole-node
`lifecycle='superseded'` are **defined but never written** by any code path (supersede is field-level
in-place, which is safer than the old "swap whole node" mental model implies).

---

## Key decisions & gotchas (don't relearn these the hard way)

- **`/brief` renders frozen `digest_log.html`** — it's a stored snapshot, not a live recompose. Theme
  changes to `compose.ts` only affect NEW briefs (see the stale-data quirk above).
- **`edges.assertable` is triple-sourced** — the SQL generated-column literal (`0032`),
  `STRONG_RELATIONS` (`relations.ts`), and `isAssertable()`. Drift fabricates/kills facts; the
  `relations.test.ts` sync-guard fails the build on drift. Keep them byte-identical.
- **`enforceFloor` is the anti-sycophancy guarantee** (`critic/calibration.ts`) — code, not prompt: a
  thesis can't be rated above what its *verified* evidence supports. Thesis edges stay WEAK.
- **`tracked_entities.candidate_status` is the cost firewall** — discovered candidates are NOT
  price/news-fetched. Every reader in the daily path must filter `candidate_status='active'`.
- **`writeNodeData` is the single node-mutation choke-point** — routes revision-snapshot + re-embed
  (only when embedded text changes). Use it for any node data/lifecycle write.
- **Web research is SSRF-sensitive** — `isPublicHttpUrl` blocks raw IPv6 + private ranges; `getText`
  uses `redirect:"error"`. Don't loosen; web content is untrusted.
- **GRANTs ≠ RLS** — every new table needs explicit `grant` (+ `service_role` for cron/route writes).
- **One Vercel-Hobby cron/day. AI Gateway needs PAID credits.** Private companies have no quote API
  (guard on `is_public`). **`npm run db:types` runs from `/tmp`** on purpose (CLI 2.106 config bug).
- **Theme is dark-only, CSS-var driven** (`globals.css`). Hardcoded colors that bypass the vars live in
  `lib/graph-style.ts`, `graph-canvas.tsx`, `thesis-verdict.tsx`, and `digest/compose.ts` (email) —
  change those if you touch the palette. `html { font-size }` in `globals.css` is the global text-size
  lever.

## Run / verify locally
```bash
npm install
npm run db:start && npm run db:reset && npm run seed
npm run dev            # http://localhost:3000
npm test               # 110 unit
npm run db:test:start && npm run db:test:reset && npm run test:integration   # 23, real test DB
npm run e2e            # 6 (auth-gate + cron-routes; authenticated flows are manual-verify)
```
Authenticated `(app)` routes are behind Google OAuth (local Supabase). To eyeball UI without a session,
the public `/sign-in` shows the theme; for gated components, temporarily add a path to `PUBLIC_PATHS`
in `src/lib/supabase/proxy.ts` + a throwaway page (revert after — that's how the dark UI was verified).

---

## Appendix — Seed the graph for the demo

Paste this into **Claude on claude.ai** (browsing on) to generate a `seed.md`, then dump it at `/dump`
(it normalizes into ~all 14 node types + relations). The extractor reads plain prose; it only captures
a STRONG relationship when one sentence states it verbatim, and only copies tickers shown verbatim.

```
You are helping me seed a personal investment knowledge-graph app. Research current, accurate information and write me ONE markdown file I can save as `seed.md`.

Topic: three clusters my dad follows — (1) semiconductor / AI-chip stocks, (2) SpaceX and a possible SpaceX/Starlink IPO, and (3) quantum-computing stocks.

The file gets ingested by an extractor that turns prose into a typed graph of entities and the relationships between them. So write PLAIN, FACTUAL PROSE in short paragraphs under section headings, and follow these rules exactly.

GENERAL
- About 1,000-1,300 words. Keep it under ~7,000 characters so it ingests in one pass.
- Use real, current facts — browse to verify. Do NOT invent tickers, prices, financial figures, or SEC filing numbers. If a date or number is approximate, write "approximately" or "expected".
- The first time you name a PUBLIC company, put its real stock ticker in parentheses, verbatim: "NVIDIA (NVDA)", "Advanced Micro Devices (AMD)", "IonQ (IONQ)". For PRIVATE companies (e.g. SpaceX, Anthropic) write "(private, no ticker)".
- Never use buy / sell / hold / price-target / recommendation language. State facts and reasoning only.

STATE EVERY RELATIONSHIP IN ITS OWN PLAIN SENTENCE (most important rule)
The extractor only captures a connection when a single clear sentence states it. So whenever two things relate, say it directly, e.g.:
- "TSMC (TSM) manufactures NVIDIA's Blackwell and H200 GPUs."
- "NVIDIA competes with Advanced Micro Devices (AMD) in data-center GPUs."
- "Jensen Huang is the CEO of NVIDIA."
- "The H200 depends on high-bandwidth memory (HBM) supplied by Micron (MU) and SK Hynix."
- "US export controls administered by the Bureau of Industry and Security threaten NVIDIA's China revenue."
- "Rising interest rates set by the Federal Reserve weigh on speculative quantum-computing stocks."

INCLUDE SEVERAL OF EACH OF THESE, WOVEN INTO THE PROSE
- Companies — public (with verbatim tickers) and private: semis (NVIDIA NVDA, AMD, TSMC TSM, Broadcom AVGO, Micron MU, ASML, Intel INTC), quantum (IonQ IONQ, Rigetti RGTI, D-Wave QBTS), space (SpaceX private, plus real suppliers/peers you verify).
- People — founders / CEOs and the company they lead (e.g. Jensen Huang, Lisa Su, Elon Musk, Gwynne Shotwell).
- Sectors — e.g. Semiconductors, Aerospace & Defense.
- Themes — e.g. artificial intelligence, quantum computing, the space economy.
- Products — e.g. Blackwell GPU, H200, HBM3E, Starlink, Starship, a named quantum computer.
- Commodities / critical inputs — e.g. high-bandwidth memory (HBM), neon gas, gallium, rare-earth elements. Say which product/company depends on each.
- Organizations (non-companies) — e.g. the Federal Reserve, the SEC, the Bureau of Industry and Security, NASA. Say how each acts on a company or sector.
- Macro factors — e.g. the AI data-center capex cycle, interest-rate policy, the semiconductor cycle, US-China export controls. Say which names each affects.
- Risks — e.g. customer concentration, single-source dependence on TSMC, quantum error-correction being years from commercial value, SpaceX's rich pre-IPO valuation. State what each risk threatens.
- Catalysts — dated, upcoming, market-moving events with a real or clearly-approximate date, and which company/theme each is for (e.g. "IonQ is expected to report Q2 2026 earnings in early August 2026"; "a SpaceX/Starlink IPO has been reported as possible in late 2026 or 2027").
- Signals — a dated observed datapoint, e.g. "In May 2026, TSMC reported monthly revenue up approximately X% year over year (reported June 2026)." Always include the date.
- News — 3 to 5 short, dated, sourced headlines about these names, each with the outlet and date, noting which companies it concerns (e.g. "On 2026-06-12, Reuters reported that ...").
- Theses — write 3 in my dad's first-person voice, as REASONING not advice, each naming specific companies/themes and the risk that could break it (e.g. "I think NVIDIA keeps its AI-chip lead through 2026 because of CUDA software lock-in and priority access to TSMC packaging, though export controls cap the China upside.").

OUTPUT
Return only the finished markdown file inside a single code block, nothing else, so I can save it as seed.md.
```

To clean up test data afterward: do it in a separate graph (top-left graph selector), or scope a delete
by `graph_id` in the cloud SQL editor (destructive — confirm before running).
