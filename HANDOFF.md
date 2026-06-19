# MarketBrain — handoff: graph lifecycle overhaul IMPLEMENTED (deploy + verify pending)

_Last updated: 2026-06-19. Durable invariants live in **`CLAUDE.md`** (read that first); the
self-updating "living graph" is summarized in **`README.md`**. This doc is now ONLY: what shipped on the
branch, and the operational steps left to actually deploy + verify it._

> The five-workstream "keep the graph lean, current, and his" overhaul + the 300s cron timeout fix is
> **merged to `main`** (PR #3, squashed) and **deployed to prod**; migrations `0043–0045` are **pushed
> to the cloud DB**. Tests: **144 unit · 56 integration · 6 e2e**, `npm run build` clean. What's left is
> live verification (below) — no code work remains.

## What shipped (branch `graph-lifecycle-overhaul`, oldest → newest)
1. **Time-box + digest reserve + news cap** — a soft `deadlineMs` threads through `drainPending` +
   `judgeTheses` (breaks between batches/theses → no orphans; judge resumes oldest-first next run); the
   cron reserves the last ~45s for the digest, which stays last. `enqueueNews` caps at 8 newest/company.
   **This is the missing-digest fix** (the heavy steps can no longer starve the send).
2. **Permanence `_tier` extraction** — the extractor stamps news/catalyst/signal with
   `ephemeral|routine|notable|landmark` (real time-scales + "keep longer when unsure"); survives schema
   validation into `data._tier`.
3. **Tiered decay + reference-guarded hard delete** — `decayWindow(type,tier)` + `decayStaleNodes` +
   migration `0043 prune_archived_nodes` (deletes long-archived chronological nodes, never live-thesis
   evidence or active-tracked nodes). `/archived` browse + restore. SQL↔TS sync-guard test.
4. **Thesis lifecycle** — auto-supersede near-restatements (≥0.92 + shared subject) via `superseded_by`;
   `/theses` tab (reuses the verdict panel); add-thesis piped through the existing dump pipeline.
5. **Fact reconciliation** — extractor `corrections` array → `applyCorrections` (verbatim-verify, ≥0.85
   auto-apply / 0.6–0.85 queue in `0044 correction_queue`; rename→`former_name`/aliases; role→delete edge).
6. **Weekly gap-fill** — bounded, deadline-guarded grounding of tracked companies via the market adapters
   (no LLM); migration `0045` adds `graphs.last_gap_fill_at`.

**Verified by tests/build; NOT yet verified live:** the 300s wall-clock (can't unit-test — see step 3
below), the authenticated UI in a browser, and whether the LIVE extractor sets `_tier` sensibly / emits
`corrections` only when warranted (the wiring + gating are stub-tested end-to-end; the model's judgement
is manual-verify).

## Verify live (no code work remains)
- ~~Merge to `main` + deploy~~ — **done** (PR #3, auto-deployed).
- ~~`supabase db push` of `0043`/`0044`/`0045`~~ — **done** (cloud has the schema).
1. **Fire the cron to confirm the timeout fix** (can't be unit-tested). `DIGEST_TO` is still your OWN
   email — safe to test today. Grab `CRON_SECRET` from the Vercel dashboard (`vercel env pull` returns
   empty for this project):
   ```
   curl -sS -m 310 -w '\n— HTTP %{http_code} in %{time_total}s\n' \
     -H "Authorization: Bearer <CRON_SECRET>" https://dj-stocks.vercel.app/api/cron/daily
   ```
   Expect HTTP 200 well under 300s with `results[].digest.status:"sent"` (a 504 near ~300s = still timing
   out).
2. **Eyeball the new UI** (auth-gated, manual-verify per project posture): `/theses` (add a thesis, see it
   become a node + get judged next run) and `/archived` (restore one). To view without a session,
   temporarily add the path to `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts` (revert after).
3. **Spot-check the live extractor** on one real dump: a `_tier` set on news, and a `corrections` entry
   only when the text actually states a fact changed.

## Open setup still pending (operational, unrelated to the build)
1. **Let dad ("Appa") in:** publish the Google OAuth consent screen (or add him as a test user), then
   approve him at `/admin` when he signs in.
2. **Seed the graph so he doesn't start empty:** the "paste into Claude.ai" seed prompt that produces a
   `seed.md` (dumped at `/dump`) is preserved in git — `HANDOFF.md` @ commit `1c8bf38`, "Seed the graph"
   appendix. Test in a separate graph (top-left graph selector), then wipe.
3. **Father's Day = Sun Jun 21, 2026.** The cron is weekday-only, so it won't auto-send Sunday — send
   manually that morning after setting `DIGEST_TO` = his email. Keep `DIGEST_TO` = your own until then.
