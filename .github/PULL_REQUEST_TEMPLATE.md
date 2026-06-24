## Summary

What does this change and **why**?

## Changes

-

## Testing

- [ ] `npm run lint` clean
- [ ] `npm run typecheck` clean
- [ ] `npm run build` green
- [ ] `npm test` green (unit)
- [ ] `npm run test:integration` (if DB-touching changes)

## Checklist

- [ ] No buy/sell/hold/recommend vocabulary added (UI, prompts, email)
- [ ] Cross-layer sync guards kept in sync (assertable vocab / decay windows) if touched
- [ ] New tables have RLS + explicit grants
- [ ] Tests added for new behavior
- [ ] Conventional-commit title
