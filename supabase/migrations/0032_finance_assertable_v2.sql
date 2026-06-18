-- Re-point edges.assertable at the EXPANDED STRONG relation vocab (the 15-node-type graph adds
-- affects/threatens/exposed_to/catalyst_for/produces/depends_on/regulates). The generated column lists
-- a hardcoded literal set; it MUST stay byte-identical to STRONG_RELATIONS in
-- src/server/normalize/relations.ts — the tests/unit/relations.test.ts sync-guard fails the build if
-- they drift. Same drop+recreate pattern as 0025 (which this supersedes). No backfill needed:
-- relation_type is preserved and a STORED generated column recomputes for every existing row on recreate.

-- The partial index references the column, so drop it before the column.
drop index if exists public.edges_assertable_idx;

alter table public.edges drop column assertable;
alter table public.edges
  add column assertable boolean generated always as (
    relation_type in (
      'owns','in_sector','in_theme','founded_by','subsidiary_of',
      'supplies_to','competes_with','listed_on','filed','insider_of',
      'affects','threatens','exposed_to','catalyst_for','produces',
      'depends_on','regulates'
    )
    and confidence >= 0.8
    and evidence_quote is not null
  ) stored;

-- Recreate the graph-scoped assertable index (matches 0023/0025).
create index edges_assertable_idx on public.edges (graph_id, dst_id) where assertable;
