-- Re-create match_nodes (the RAG pgvector RPC) to exclude HIDDEN nodes (archived/superseded) by
-- default, so stale/replaced content never surfaces in /ask. The dedupe boost in upsert.ts passes
-- p_include_hidden=true so it can still match a hidden near-duplicate (avoiding re-creating it).
-- Adding a parameter changes the signature, so drop the old 5-arg function first, then re-grant.
drop function if exists public.match_nodes(vector(1536), uuid, float, int, text);
create or replace function public.match_nodes(
  query_embedding  vector(1536),
  p_graph_id       uuid,
  match_threshold  float   default 0.0,
  match_count      int     default 10,
  exclude_id       text    default null,
  p_include_hidden boolean default false
)
returns table (id text, type text, title text, similarity float)
language sql stable
set search_path = public, pg_catalog
as $$
  select n.id, n.type, n.title, 1 - (n.embedding <=> query_embedding) as similarity
  from public.nodes n
  where n.embedding is not null
    and n.graph_id = p_graph_id
    and (exclude_id is null or n.id <> exclude_id)
    and (p_include_hidden or n.lifecycle in ('active', 'stale'))
    and 1 - (n.embedding <=> query_embedding) >= match_threshold
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_nodes(vector(1536), uuid, float, int, text, boolean) to authenticated, service_role;
