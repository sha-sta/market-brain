-- The daily cron's work-list: which nodes to fetch news/prices/filings for. Graph-scoped. A node is
-- tracked once it's a holding, a watchlist name, or a theme the user follows. The composite FK to
-- nodes(graph_id, id) means you can only track a node that already exists in this graph.

create table public.tracked_entities (
  graph_id   uuid not null,
  node_id    text not null,
  kind       text not null check (kind in ('owned', 'watchlist', 'theme')),
  created_at timestamptz not null default now(),
  primary key (graph_id, node_id),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index tracked_entities_graph_idx on public.tracked_entities (graph_id);

alter table public.tracked_entities enable row level security;
create policy "tracked_entities active all" on public.tracked_entities
  for all to authenticated using (public.is_active()) with check (public.is_active());

-- RLS gates the policy; the GRANT makes it reachable at all (new tables get no grants by default).
grant select, insert, update, delete on public.tracked_entities to authenticated, service_role;
