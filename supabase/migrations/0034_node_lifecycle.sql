-- The "living graph" freshness lifecycle. DISTINCT from `status` (per-type domain state: a company's
-- mentioned/owned, a thesis's active/confirmed) — `lifecycle` is the freshness state EVERY node shares:
--   active     - current.
--   stale      - aging/flagged, still surfaced.
--   archived   - old news, hidden from default views + RAG (recoverable; its edges are preserved).
--   superseded - replaced by a newer node (superseded_by points to the replacement).
alter table public.nodes
  add column lifecycle text not null default 'active'
    check (lifecycle in ('active', 'stale', 'archived', 'superseded'));
alter table public.nodes add column superseded_by text; -- the node id (same graph) that replaced this one
alter table public.nodes add column last_judged_at timestamptz; -- thesis-judge change-detection (Phase 4)

-- superseded_by is a graph-scoped soft pointer: enforce it references a live node IN THE SAME GRAPH, and
-- clear ONLY that column (PG15+ column-list SET NULL) if the replacement is deleted (graph_id must stay).
alter table public.nodes
  add constraint nodes_superseded_by_fk
  foreign key (graph_id, superseded_by) references public.nodes (graph_id, id) on delete set null (superseded_by);
-- Invariant: only a superseded node may carry a pointer.
alter table public.nodes
  add constraint nodes_superseded_by_lifecycle_chk
  check (superseded_by is null or lifecycle = 'superseded');

-- Hot path for the brief gather + type-filtered graph/list views (match_nodes uses the HNSW index, not this).
create index nodes_lifecycle_idx on public.nodes (graph_id, type) where lifecycle in ('active', 'stale');
