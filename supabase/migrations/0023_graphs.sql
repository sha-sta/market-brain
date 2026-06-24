-- Multi-graph: partition the single shared knowledge graph into named, ISOLATED graphs that active
-- users switch between. Once a graph is active, ingest/search/ask scope to it only. Isolation is a
-- DB invariant: node PK becomes composite (graph_id, id), so the same slug (e.g. "nvda") can exist
-- independently in two graphs and dedupe/wikilinks never cross a graph boundary.
--
-- (upsert_edge is graph-scoped here but keeps the 8-arg integrity signature from 0017.)

-- ============================================================================================
-- 1. graphs table. Shared partitions: any active user sees/creates/renames any graph.
-- ============================================================================================
create table public.graphs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.graphs enable row level security;
create policy "graphs active select" on public.graphs
  for select to authenticated using (public.is_active());
create policy "graphs active insert" on public.graphs
  for insert to authenticated with check (public.is_active());
create policy "graphs active update" on public.graphs
  for update to authenticated using (public.is_active()) with check (public.is_active());

-- New tables get NO grants by default (the 0009 schema-wide grant was a one-time snapshot).
grant select, insert, update, delete on public.graphs to authenticated, service_role;

-- ============================================================================================
-- 2. Default "Main" graph. Fixed sentinel UUID so the backfill below is deterministic + re-runnable
--    across dev/test/prod, and so the app can fall back to it when a profile has no current graph.
-- ============================================================================================
insert into public.graphs (id, name) values ('00000000-0000-0000-0000-0000000000aa', 'Main');

-- ============================================================================================
-- 3. Add graph_id to the scoped tables (nullable first), backfill all existing rows to "Main".
-- ============================================================================================
alter table public.nodes                 add column graph_id uuid;
alter table public.edges                 add column graph_id uuid;
alter table public.raw_uploads            add column graph_id uuid;
alter table public.assets                 add column graph_id uuid;
alter table public.node_merge_candidates  add column graph_id uuid;

update public.nodes                 set graph_id = '00000000-0000-0000-0000-0000000000aa';
update public.edges                 set graph_id = '00000000-0000-0000-0000-0000000000aa';
update public.raw_uploads           set graph_id = '00000000-0000-0000-0000-0000000000aa';
update public.assets                set graph_id = '00000000-0000-0000-0000-0000000000aa';
update public.node_merge_candidates set graph_id = '00000000-0000-0000-0000-0000000000aa';

-- ============================================================================================
-- 4. Composite-PK rebuild on nodes. Text FKs that reference nodes(id) must be dropped before the PK
--    can change, then recreated as composite (graph_id, <col>) -> nodes(graph_id, id).
-- ============================================================================================
alter table public.edges                 drop constraint edges_src_id_fkey;
alter table public.edges                 drop constraint edges_dst_id_fkey;
alter table public.assets                 drop constraint assets_node_id_fkey;
alter table public.node_merge_candidates  drop constraint node_merge_candidates_left_id_fkey;
alter table public.node_merge_candidates  drop constraint node_merge_candidates_right_id_fkey;

alter table public.nodes alter column graph_id set not null;
alter table public.nodes drop constraint nodes_pkey;
alter table public.nodes add primary key (graph_id, id);
alter table public.nodes add constraint nodes_graph_fk
  foreign key (graph_id) references public.graphs (id) on delete restrict;

-- Lock graph_id on the remaining scoped tables + reference graphs.
alter table public.edges alter column graph_id set not null;
alter table public.edges add constraint edges_graph_fk
  foreign key (graph_id) references public.graphs (id) on delete restrict;
alter table public.raw_uploads alter column graph_id set not null;
alter table public.raw_uploads add constraint raw_uploads_graph_fk
  foreign key (graph_id) references public.graphs (id) on delete restrict;
alter table public.assets alter column graph_id set not null;
alter table public.assets add constraint assets_graph_fk
  foreign key (graph_id) references public.graphs (id) on delete restrict;
alter table public.node_merge_candidates alter column graph_id set not null;
alter table public.node_merge_candidates add constraint node_merge_candidates_graph_fk
  foreign key (graph_id) references public.graphs (id) on delete restrict;

-- Recreate the node FKs as composite. Edges never cross graphs, so a single graph_id covers both
-- endpoints. assets uses SET NULL (node_id) [PG15+] so deleting a node unlinks the asset but keeps
-- its (NOT NULL) graph_id. Merge candidates pair two nodes within one graph (dedupe never crosses).
alter table public.edges add constraint edges_src_fk
  foreign key (graph_id, src_id) references public.nodes (graph_id, id) on delete cascade;
alter table public.edges add constraint edges_dst_fk
  foreign key (graph_id, dst_id) references public.nodes (graph_id, id) on delete cascade;
alter table public.assets add constraint assets_node_fk
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete set null (node_id);
alter table public.node_merge_candidates add constraint node_merge_candidates_left_fk
  foreign key (graph_id, left_id) references public.nodes (graph_id, id) on delete cascade;
alter table public.node_merge_candidates add constraint node_merge_candidates_right_fk
  foreign key (graph_id, right_id) references public.nodes (graph_id, id) on delete cascade;

-- ============================================================================================
-- 5. Edge uniqueness + hot indexes become per-graph (the data layer always filters by graph_id now).
-- ============================================================================================
alter table public.edges drop constraint edges_src_id_dst_id_type_key;
alter table public.edges add constraint edges_graph_src_dst_type_key unique (graph_id, src_id, dst_id, type);

drop index public.edges_src_idx;
drop index public.edges_dst_idx;
create index edges_src_idx on public.edges (graph_id, src_id);
create index edges_dst_idx on public.edges (graph_id, dst_id);

drop index public.edges_assertable_idx;
create index edges_assertable_idx on public.edges (graph_id, dst_id) where assertable;

drop index public.assets_node_idx;
create index assets_node_idx on public.assets (graph_id, node_id);

-- raw_uploads keeps its (status) index for the cross-graph drain (claim_raw_uploads filters status
-- only). Add a graph-scoped one for the per-graph pending count in the UI.
create index raw_uploads_graph_status_idx on public.raw_uploads (graph_id, status);

-- ============================================================================================
-- 6. RPC rewrites. Signature changes require drop + recreate. claim_raw_uploads is unchanged — it
--    `returns setof public.raw_uploads`, so the new graph_id column travels with each claimed row.
-- ============================================================================================

-- match_nodes: add p_graph_id (required) + filter. SECURITY INVOKER (default) so RLS still applies.
-- The HNSW index has no graph_id dimension, so this scans then filters by graph_id (fine at our scale).
drop function if exists public.match_nodes(vector(1536), float, int, text);
create or replace function public.match_nodes(
  query_embedding vector(1536),
  p_graph_id      uuid,
  match_threshold float default 0.0,
  match_count     int   default 10,
  exclude_id      text  default null
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
    and 1 - (n.embedding <=> query_embedding) >= match_threshold
  order by n.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_nodes(vector(1536), uuid, float, int, text) to authenticated, service_role;

-- upsert_edge: prepend p_graph_id, insert it, scope the conflict target to the per-graph unique key.
-- (8-arg integrity signature from 0017.)
drop function if exists public.upsert_edge(text, text, text, text, text, real, text, uuid);
create or replace function public.upsert_edge(
  p_graph_id uuid,
  p_src_id text,
  p_dst_id text,
  p_type text,
  p_relation_type text,
  p_method text,
  p_confidence real,
  p_evidence_quote text default null,
  p_source_upload_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.edges (graph_id, src_id, dst_id, type, relation_type, method, confidence, evidence_quote,
                            source_upload_id, support_count)
  values (p_graph_id, p_src_id, p_dst_id, p_type, p_relation_type, p_method, p_confidence, p_evidence_quote,
          p_source_upload_id, 1)
  on conflict (graph_id, src_id, dst_id, type) do update set
    support_count = edges.support_count
      + (case when excluded.source_upload_id is not null
                and excluded.source_upload_id is distinct from edges.source_upload_id
              then 1 else 0 end),
    confidence = greatest(edges.confidence, excluded.confidence),
    relation_type = case when excluded.confidence >= edges.confidence then excluded.relation_type else edges.relation_type end,
    method = case when excluded.confidence >= edges.confidence then excluded.method else edges.method end,
    evidence_quote = coalesce(edges.evidence_quote, excluded.evidence_quote),
    source_upload_id = coalesce(edges.source_upload_id, excluded.source_upload_id);
end;
$$;
grant execute on function public.upsert_edge(uuid, text, text, text, text, text, real, text, uuid) to service_role;

-- merge_nodes: prepend p_graph_id; scope every edge repoint + the node delete to that graph (a merge
-- never crosses graphs — decision: dedupe is per-graph).
drop function if exists public.merge_nodes(text, text);
create or replace function public.merge_nodes(p_graph_id uuid, keep_id text, drop_id text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if keep_id = drop_id then return; end if;
  update public.edges e set src_id = keep_id
    where e.graph_id = p_graph_id
      and e.src_id = drop_id
      and e.dst_id <> keep_id
      and not exists (select 1 from public.edges k where k.graph_id = p_graph_id and k.src_id = keep_id and k.dst_id = e.dst_id and k.type = e.type);
  update public.edges e set dst_id = keep_id
    where e.graph_id = p_graph_id
      and e.dst_id = drop_id
      and e.src_id <> keep_id
      and not exists (select 1 from public.edges k where k.graph_id = p_graph_id and k.dst_id = keep_id and k.src_id = e.src_id and k.type = e.type);
  delete from public.nodes where graph_id = p_graph_id and id = drop_id;
end;
$$;
grant execute on function public.merge_nodes(uuid, text, text) to service_role;

-- ============================================================================================
-- 7. Per-user active graph. Self-update is allowed by the existing "profiles update self" policy;
--    the guard trigger only blocks status/is_admin edits, so changing current_graph_id is fine.
-- ============================================================================================
alter table public.profiles add column current_graph_id uuid references public.graphs (id);
update public.profiles set current_graph_id = '00000000-0000-0000-0000-0000000000aa';
