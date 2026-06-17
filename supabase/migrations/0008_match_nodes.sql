-- pgvector similarity search for the node-detail "related" panel and the dedupe embedding
-- boost. SECURITY INVOKER (default): RLS on `nodes` applies, so only active users get rows
-- and inactive users get an empty result — no bypass. Called via supabase.rpc('match_nodes').

create or replace function public.match_nodes(
  query_embedding vector(1536),
  match_threshold float default 0.0,
  match_count     int   default 10,
  exclude_id      text  default null
)
returns table (id text, type text, title text, similarity float)
language sql stable
-- search_path must include the schema holding pgvector's `<=>` operator (public). An empty
-- search_path hides the operator: `operator does not exist: vector <=> vector`.
set search_path = public, pg_catalog
as $$
  select n.id, n.type, n.title, 1 - (n.embedding <=> query_embedding) as similarity
  from public.nodes n
  where n.embedding is not null
    and (exclude_id is null or n.id <> exclude_id)
    and 1 - (n.embedding <=> query_embedding) >= match_threshold
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
