# MarketBrain — project invariants (read every session)

A private **stock-market research knowledge graph** — a Father's Day gift. A self-updating research
brain: the user tracks names/industries; a daily cron + on-demand research grow and amend the graph
(tiered decay + reference-guarded hard-delete, fact reconciliation, thesis supersede, re-judge theses),
and it produces strict, non-sycophantic theses.
**Posture: aggregate & surface only.** Task-specific state + the current next step live in `HANDOFF.md`.

## Deploy / branch model
- **`main` is prod.** Vercel auto-deploys `main` on every push (prod alias `dj-stocks.vercel.app`,
  repo `github.com/sha-sta/market-brain`). Shipping = merge to `main` + push. No CI; the gate is local
  `npm run build` + `npm test` green.
- Commit/push only when asked; branch first if on `main`. No `Co-Authored-By` lines (user preference).
- One Vercel-Hobby **cron/day**: `0 11 * * 1-5` UTC (~7am ET, weekdays) → `/api/cron/daily`
  (Bearer `CRON_SECRET`, fail-closed). It does fetch + brief together in ONE ≤300s invocation.

## Supabase
- Cloud project ref **`nrzyfqhfbseihxzwcvns`**; migrations **`0001–0045` are pushed** (`0043–0045` =
  `prune_archived_nodes` hard-delete, `correction_queue`, `graphs.last_gap_fill_at`). Christian is
  active+admin. Google OAuth lives in the Supabase dashboard (NOT Vercel env).
- **Local stacks are isolated from the sibling `brain` project**: `project_id "marketbrain"`, ports
  **5532x** main / **5533x** test. Never touch `brain`'s instance. `npm run db:start` / `db:test:start`.
- **`npm run db:types` runs from `/tmp` on purpose** (Supabase CLI 2.106 chokes on `config.toml`'s
  `env(...)`). Don't "simplify" it back.

## Hard invariants — violating any of these silently breaks correctness
- **No buy/sell/hold/recommend vocabulary anywhere** (UI, prompts, email). The graph surfaces; the
  reader decides. There is deliberately no buy/sell relation.
- **`edges.assertable` is triple-sourced** — the SQL generated-column literal (latest
  `*_finance_assertable*.sql`), `STRONG_RELATIONS` (`server/normalize/relations.ts`), and
  `isAssertable()`. Keep byte-identical; `tests/unit/relations.test.ts` fails the build on drift.
- **The hard-delete windows are double-sourced** — the per-(type,tier) `deleteDays` in `decayWindow()`
  (`lifecycle.ts`) and the `values` table in `prune_archived_nodes` (`0043_*.sql`) MUST match;
  `tests/unit/lifecycle.test.ts`'s sync-guard fails the build on drift.
- **`tracked_entities.candidate_status='active'` is the cost firewall** — auto-discovered *candidates*
  are NEVER price/news-fetched. Every reader in the daily path must filter `candidate_status='active'`.
- **`writeNodeData` (`server/normalize/upsert.ts`) is the single node-mutation choke-point** — it
  snapshots a `node_revisions` row + re-embeds (only when embedded text changed). Use it for any node
  data/lifecycle write; never `update` nodes directly.
- **Web research is SSRF-sensitive** — `isPublicHttpUrl` blocks raw IPv6 + private ranges; `getText`
  uses `redirect:"error"`. Web content is untrusted; don't loosen.
- **GRANTs ≠ RLS** — every new table needs an explicit `grant` (+ `service_role` for cron/route writes)
  or it 403s. RLS on every table.
- **AI Gateway needs PAID credits.** Private companies have no quote API (guard on `is_public`).
- **Server actions: RETURN `{ ok, message }` for expected errors, never `throw`** — a thrown Error in a
  prod server action is redacted to a generic "Server Components render" message, hiding the real
  reason. (See `follow/actions.ts` / `research/actions.ts` for the pattern.)

## Lifecycle / decay (tiered; see "Living graph" in README)
- **Decay is TIERED and DOES hard-delete now.** The extractor stamps each chronological node
  (news/catalyst/signal) a permanence `_tier` (`ephemeral`/`routine`/`notable`/`landmark`);
  `decayWindow(type,tier)` (`lifecycle.ts`) maps it to an archive then a delete window. `decayStaleNodes`
  (`market/daily.ts`) archives aged news/catalyst/signal/filing (soft-hide, edges + revision kept,
  restorable at `/archived`), then `prune_archived_nodes` (SQL, `0043`) **hard-deletes** long-archived
  chronological nodes to reclaim the row + embedding. The delete is **reference-aware**: it never deletes
  a node that is evidence for a live thesis (`confirms_thesis`/`challenges_thesis` from an active/stale
  thesis) or is linked to an `active` tracked entity. Landmark + filing never delete; **thesis/note +
  structural types never decay**. A missing `_tier` falls back to the longest non-landmark window
  ("keep longer when unsure").
- **Whole-node `superseded` IS used now** — thesis replacement marks the old thesis `lifecycle='superseded'`
  + `superseded_by → new` (`critic/thesis-supersede.ts`); the judge ignores superseded theses. Field-level
  supersede (newer source swaps a narrative field within one node; identity fields never overwritten) is
  unchanged. `stale` is still defined-but-unused.
- **Fact reconciliation** corrects PERMANENT nodes when the source says a fact changed
  (`normalize/reconcile.ts`): verbatim-verified, ≥0.85 confidence auto-applies via `writeNodeData`;
  0.6–0.85 queues in `correction_queue`. A rename appends `former_name`/`aliases` (never overwrites
  `name`); a role change deletes the stale `insider_of` edge (edges have no lifecycle column).
- Reads filter `lifecycle in ('active','stale')`. `/brief` renders **frozen `digest_log.html`** (a
  stored snapshot, not a live recompose) — `compose.ts` theme changes only affect NEW briefs.

## UI
- **Single fixed dark theme**, CSS-var driven (`src/app/globals.css`: `--background #0f1113`,
  `--surface`, `--foreground`, `--muted`, `--border`, `--ok/--warn/--danger`). Newsreader serif for
  prose; **IBM Plex Mono for data only**. `html { font-size }` in globals.css is the one text-size lever.
- Colors that bypass the CSS vars (change these too if you touch the palette): `lib/graph-style.ts`,
  `components/graph-canvas.tsx`, `components/thesis-verdict.tsx`, `server/digest/compose.ts` (email).

## Email
- The cron sends the brief to whatever **`DIGEST_TO`** is, with **NO account/approval gate**. Sender =
  Gmail SMTP if `GMAIL_APP_PASSWORD` set, else Resend (**Resend is removed in prod** — Gmail only). Mail
  adapters degrade silently (catch + `reportError`, never throw), so a send failure leaves the brief
  `archived`/`failed` with no surfaced error.

## Run / verify locally
```bash
npm install
npm run db:start && npm run db:reset && npm run seed
npm run dev            # http://localhost:3000
npm test               # 144 unit
npm run db:test:start && npm run db:test:reset && npm run test:integration   # 56, real test DB
npm run e2e            # 6 (auth-gate + cron routes; authenticated flows are manual-verify)
```
Authenticated `(app)` routes sit behind Google OAuth (local Supabase). To eyeball UI without a session,
`/sign-in` shows the theme; for gated components, temporarily add a path to `PUBLIC_PATHS` in
`src/lib/supabase/proxy.ts` + a throwaway page (revert after).
