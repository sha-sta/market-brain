# Contributing to MarketBrain

Thanks for your interest. MarketBrain is primarily a personal project, but issues and pull requests
are welcome.

## Development setup

```bash
npm install
cp .env.example .env.local      # fill in the keys you need (see README "Environment variables")
npm run db:start                # local Supabase (isolated; ports 5532x)
npm run db:reset                # apply migrations
npm run seed                    # seed an example graph
npm run dev                     # http://localhost:3000
```

See the README for the full local-development and environment-variable reference.

## The quality gate

There is **no remote build gate** — the bar is a green local run before you push:

```bash
npm run lint
npm run typecheck
npm run build
npm test                        # 144 unit tests
```

CI runs lint + typecheck + unit tests on every push and PR. Integration (`npm run test:integration`,
real test DB) and e2e (`npm run e2e`) are run locally — they need a database and aren't part of CI.
Do not bypass commit hooks (`--no-verify`) or push a red build.

## Project invariants (please don't break these)

- **No buy/sell/hold/recommend vocabulary anywhere** (UI, prompts, email). The graph surfaces facts;
  the reader decides. This is enforced by tests and is a hard design rule.
- **Cross-layer sync guards are intentional.** The `assertable` relation vocabulary is triple-sourced
  and the decay windows are double-sourced; unit tests fail the build if the SQL and TypeScript drift.
  If you change one, change all of them.
- **RLS on every table**, and every new table needs explicit grants.

See `CLAUDE.md` for the full list of project invariants.

## Commits & pull requests

- Conventional-commit style titles under ~70 chars: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `chore:`. The body should explain *why*, not *what*.
- Add tests for new features (unit minimum; e2e for user-facing flows).
- Keep PRs focused — a bug fix shouldn't also refactor unrelated code.
- Open PRs against `main`.
