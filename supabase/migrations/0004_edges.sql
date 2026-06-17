-- The graph: hard relationships (person->lab, idea->evidence, paper->concept, ...).
-- Created DURING normalization, not in a separate build step. The unique constraint makes
-- edge upsert idempotent so re-processing an upload never duplicates an edge.

create table public.edges (
  id         uuid primary key default gen_random_uuid(),
  src_id     text not null references public.nodes (id) on delete cascade,
  dst_id     text not null references public.nodes (id) on delete cascade,
  type       text not null,
  src_module text not null default 'research-graph',
  dst_module text not null default 'research-graph',
  created_at timestamptz not null default now(),
  unique (src_id, dst_id, type)
);

create index edges_src_idx on public.edges (src_id);
create index edges_dst_idx on public.edges (dst_id);
