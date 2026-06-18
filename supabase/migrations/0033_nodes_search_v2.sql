-- Extend the nodes.search tsvector to cover the new node types' prose fields (catalyst.outcome,
-- macro_factor.current_reading, risk.mitigation) so FTS recall holds on resolved catalysts and macro
-- readings. A generated column can't be ALTERed in place, so drop the GIN index, drop the column, and
-- recreate both. Preserves every key from 0003 — only the three new ones are added.

drop index if exists public.nodes_search_idx;

alter table public.nodes drop column search;
alter table public.nodes
  add column search tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(data ->> 'name', '') || ' ' ||
      coalesce(data ->> 'headline', '') || ' ' ||
      coalesce(data ->> 'statement', '') || ' ' ||
      coalesce(data ->> 'description', '') || ' ' ||
      coalesce(data ->> 'definition', '') || ' ' ||
      coalesce(data ->> 'summary', '') || ' ' ||
      coalesce(data ->> 'body', '') || ' ' ||
      coalesce(data ->> 'outcome', '') || ' ' ||
      coalesce(data ->> 'current_reading', '') || ' ' ||
      coalesce(data ->> 'mitigation', '')
    )
  ) stored;

create index nodes_search_idx on public.nodes using gin (search);
