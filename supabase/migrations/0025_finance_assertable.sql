-- Re-point edges.assertable at the MarketBrain STRONG relation vocab. The generated column lists a
-- hardcoded literal set; it MUST stay in sync with STRONG_RELATIONS in
-- src/server/normalize/relations.ts, or no edge is ever assertable. edges is empty on a fresh DB, so the legacy
-- backfill below is a no-op — kept for parity / re-runs against pre-existing rows.

-- The partial index `edges_assertable_idx` references the column, so drop it before the column.
drop index if exists public.edges_assertable_idx;

alter table public.edges drop column assertable;
alter table public.edges
  add column assertable boolean generated always as (
    relation_type in (
      'owns','in_sector','in_theme','founded_by','subsidiary_of',
      'supplies_to','competes_with','listed_on','filed','insider_of'
    )
    and confidence >= 0.8
    and evidence_quote is not null
  ) stored;

-- Recreate the graph-scoped assertable index (matches 0023).
create index edges_assertable_idx on public.edges (graph_id, dst_id) where assertable;

-- Legacy relation_type backfill for finance raw `type` labels (no-op on empty edges).
update public.edges set
  relation_type = case
    when type = 'sector'                then 'in_sector'
    when type in ('themes', 'theme')    then 'in_theme'
    when type in ('founders', 'founder') then 'founded_by'
    when type = 'tickers'               then 'mentions'
    when type = 'mentions'              then 'mentions'
    when type = 'relates_to'            then 'relates_to'
    else 'relates_to'
  end
where method = 'legacy';
