# MarketBrain — handoff: graph lifecycle overhaul (lean growth, decay/delete, thesis & fact lifecycle) + the 300s cron timeout

_Last updated: 2026-06-19. `main` is deployed to prod. Durable project invariants (deploy model,
Supabase, hard constraints, UI, email, how-to-run) now live in **`CLAUDE.md`** — read that first; this
doc is ONLY the next build task + current open issues. The full phase-by-phase refactor history is in
git (it's not repeated here)._

> **Feed this doc into a fresh session to produce a comprehensive implementation plan, then build it.**

**Scope (one umbrella — "keep the graph lean, current, and his"). The planning session should sequence
these; they share the daily-run + lifecycle code so plan them together:**
1. **Add less daily** — ingest caps + materiality gate + a structural gap-fill pass (vs piling on news).
2. **Tiered decay + HARD-DELETE** — importance tiers scale retention (incl. a landmark/never tier); a
   short floor; actually delete decayed chronological nodes (free-plan DB), reference-aware.
3. **Thesis lifecycle** — never time-decay; replace via `superseded_by`; a `/theses` tab + add-thesis form.
4. **Fact reconciliation** — correct permanent nodes when facts change (rename, CEO→ex-CEO), cost-scoped.
5. **300s timeout** — the above bound the work; also reorder/​time-box so the digest always sends.
The decay audit + the archive-still-referenced bug are context running through all of these.

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

### Retention: HARD-DELETE + importance-tiered decay (free-plan lean-DB requirement)
Motivation: Supabase **free tier ≈ 500MB**, and every node carries a pgvector embedding (~6KB+ each),
so 45 days of accumulating-then-only-hidden news is real, growing cost. Two changes:

**1. Actually DELETE decayed chronological nodes (don't just hide them).** Today `archiveStaleNews` only
flips `lifecycle='archived'` — the row + embedding stay forever. Switch to (or add) a hard prune.
**Mechanically safe — deletion cascades are already wired:** `edges.src_id/dst_id`, `node_revisions`,
`price_snapshots`, `metric_snapshots`, and `node_similarity` all have `on delete cascade` on the node
FK; `superseded_by` is `on delete set null`. So `delete from public.nodes where …` cleanly reclaims
everything. The ONLY risk is **semantic**: deleting a node that's evidence for an active thesis
(`confirms_thesis`/`challenges_thesis` edge) or still linked to an active tracked entity permanently
destroys that evidence. So deletion MUST be **reference-aware** (this supersedes — and is stricter than
— the archival bug above). Recommended shape: keep `archived` as a short soft-hide grace, then a
reference-guarded prune deletes archived chronological nodes past a (tier-scaled) delete window. Do it
in a `service_role` SQL function like `prune_snapshots`, called from the daily run.

**2. Importance/decay TIERS that scale how fast a node decays.** A primitive version already exists:
`news.materiality` (high/med/low) already drives 45d vs 120d (`lifecycle.ts:newsArchiveCutoffMs`), and
the extractor already emits it. Generalize this:
- Add a top **"landmark / permanent"** tier (never auto-archive/delete) for rare, durable, market-
  defining events — the user's example: "SpaceX acquires Cursor for $60B" must NOT be forgotten, vs a
  routine price-blip article that should decay in days. **The current 45d floor is TOO LONG** — the
  bottom tier should be short (truly irrelevant/noise news goes in days). So the levels become e.g.
  `ephemeral (~2-3d) → routine (~21-30d) → notable (~180d) → landmark (never)` — tune these.
- Teach the **extractor prompt** (`server/normalize/prompt.ts`) + the enum (`schemas.ts`) to assign the
  tier deliberately (it currently judges `materiality` already), with explicit guidance + examples for
  the landmark tier so it's used sparingly.
- Generalize the windows in `lifecycle.ts`: replace `newsArchiveCutoffMs(materiality)` with a
  `decayWindow(type, tier)` → {archive days, delete days, or never} map.

**Which node types get tiered decay (identify the chronological ones; structural ones never decay):**
- **news** — `materiality` (exists) → the prime target.
- **catalyst** — `importance` (exists) + `event_date`: decays only AFTER its event date passes (a future
  catalyst is always kept); a passed low-importance catalyst decays, a landmark one persists.
- **signal** — dated `observed_at` and explicitly designed to SUPERSEDE prior readings → a superseded /
  stale signal is the soonest delete candidate.
- **filing** — by `form_type` (a 10-K/10-Q stays relevant ~a year+, an 8-K/Form-4 far less).
- **note** — notes go stale too, and they're MIXED (factual + opinion). Give a note a tier as well so it
  decays (an LLM-assigned tier at ingest, same vocabulary). **Prefer the tier→window approach over a
  brittle absolute LLM "delete-by date"** (an absolute future date the model guesses is error-prone);
  the tier maps to a window like everything else. A note can also be **superseded by a newer note that
  conflicts with it** (see the conflict-supersede note in Thesis lifecycle) — but because notes carry
  FACTS, auto-deleting on a model-judged "conflict" is risky (a false positive silently drops good
  info), so gate that behind high precision or user confirmation, not silent auto-delete.
- **Structural types keep forever** (no time-decay): company, person, sector, theme, product, commodity,
  organization, macro_factor, risk. (risk/macro_factor are persistent context.)
- **thesis** — does NOT time-decay; it's replaced/removed, not aged out. See the next subsection.
Note `risk.severity/likelihood` and `thesis.conviction` enums already exist — reuse the same tiering
vocabulary for consistency.

### Thesis lifecycle & management (related workstream — theses are replaced, never time-decayed)
Theses are the user's standing OPINIONS — purely opinionated (notes are mixed fact+opinion). They
shouldn't vanish because time passed; they should be **revised/replaced** when he forms a new view, and
challenged by evidence (the thesis-judge already does the latter via `confirms_thesis`/`challenges_thesis`
edges + `enforceFloor`). Design:
- **Never time-decay a thesis.** Removal is (a) manual, or (b) **superseded by a new/conflicting thesis**.
- **Reuse the dormant `superseded_by` machinery for replacement** — migration `0034` already defines
  `lifecycle='superseded'` + `superseded_by` (a same-graph soft pointer) but NO code path writes it
  today. "Replace thesis A with thesis B" is its natural first use: mark A `superseded`, point
  `superseded_by → B`. Lean toward **user-confirmed** replacement ("does this replace your earlier
  thesis on X?") rather than silent auto-supersede, since these are his opinions.
- **Add a `/theses` tab** (nav slots alongside Following/Ask): list his theses with the judge's
  strength/verdict (reuse `components/thesis-verdict.tsx`) and let him **manually archive/remove** old
  ones (reuse the existing `node/[id]/actions.ts` archive/restore actions). This is the easy, safe win —
  theses + notes are his only opinionated nodes, and theses are the purely-opinionated ones worth a
  dedicated management surface.
- **Add-a-thesis form** that creates a single thesis node AND auto-connects it like every other node.
  **Implement by piping the thesis text through the EXISTING dump/normalize pipeline** (`uploadText` →
  `raw_uploads` → `drainPending`), NOT a parallel path — the extractor already produces a `thesis` node
  + links + embedding from prose, so a focused "write a thesis" entry point just feeds that same path
  (consistent with "a news article is just a raw_uploads row"). This **keeps dump-based thesis
  extraction intact** automatically (same code path).

### Fact reconciliation — update/replace stale facts on PERMANENT nodes (cross-node correction)
Distinct from time-decay: when reality changes (a company RENAMES, a CEO becomes ex-CEO, a product is
discontinued), the relevant **structural/permanent** node is wrong and should be CORRECTED in place, not
deleted. Today's supersede only overwrites narrative fields WITHIN one node during a same-entity merge
(`decideSupersede`, dated newer) — there is no cross-node fact-correction. Build it, but **cost-scoped**.

**Cost verdict (the user asked):** a naive "semantic-search every new node → LLM cross-reference every
candidate pair, daily" is **too expensive AND worsens the 300s timeout** (an extra LLM call per new node
on top of drain+judge). Make it cheap by scoping — real fact-changes are RARE:
- **Piggyback on the extraction LLM that already runs.** The extractor prompt ALREADY injects nearby
  existing entities (`renderExistingEntities`/`buildDynamicTail` in `prompt.ts`) so the model can link.
  Extend that pass to ALSO emit, when the new text contradicts/updates an existing entity, a small
  structured flag: `{ corrects: "[[entity-id]]", field, old, new, evidence }`. **No extra call** — it's
  in the output the extractor already produces.
- **Embedding similarity (no LLM) finds candidates;** escalate to an LLM ONLY for the rare flagged case.
- **Scope to permanent types** (company/person/product/organization/sector) — skip news/note/etc.
- Apply the correction through **`writeNodeData`** so every correction snapshots a `node_revisions` row
  (auditable + reversible) — never a raw `update`.

**Two real subtleties to handle (don't let the plan miss these):**
- **Company rename:** `name` is an `IDENTITY_FIELD` (`lifecycle.ts`) deliberately NEVER superseded —
  overwriting it breaks the dedupe hard-key (future articles using the new name won't match the node).
  So a rename must **add an alias / `former_name`** (and keep the old as a search alias) or re-key
  carefully, NOT blind-overwrite. Treat rename as its own case.
- **Role/relationship change (CEO → ex-CEO):** update the person's `role` (narrative, already
  superseable) AND retire/qualify the `insider_of`/`founded_by` EDGE — but edges have no lifecycle
  column today, so decide how to "expire" an edge (delete it, or add a qualifier/validity).
- **Safety:** auto-correcting permanent nodes is high-stakes (a false positive corrupts a core entity).
  Because it goes through `writeNodeData` it's reversible via revision history, but consider a
  confidence bar / log / confirmation, especially for identity-ish changes.

### Open design questions for the plan to resolve
- Gap-fill heuristic: which fields/edges are "essential" per node type, and how to detect-cheaply.
- Per-company news cap (e.g. top N by materiality?) and the ingest materiality/quality threshold.
- The tier → {archive window, delete window} map, and the exact "landmark/never" criteria for the prompt.
- Reference-guard for deletion: never delete a node cited by an active thesis or linked to an active
  tracked entity — define precisely (which edge types / lifecycle states protect a node from prune).
- Soft-hide grace before hard delete, or delete directly? (recoverability vs DB space.)
- Note staleness: tier→window (recommended) vs absolute LLM "delete-by date"; and whether/how a newer
  note may supersede a conflicting older one (conflict detection = embedding similarity + an LLM
  contradiction check — what precision bar, and confirm-vs-auto, given notes carry facts).
- Thesis replacement: user-confirmed supersede vs auto on a new conflicting thesis; the UX for "this
  replaces thesis X". Where `/theses` slots in the nav.
- Fact reconciliation: the flag schema the extractor emits; the confidence bar for auto-applying a
  correction; company-rename handling (alias/`former_name` vs re-key); how to expire a stale edge
  (CEO→ex-CEO) given edges have no lifecycle column.
- Reorder digest-before-judge vs time-box the judge — which best guarantees the email sends.
- Does research need the same caps + tiering on what it drains in?

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
