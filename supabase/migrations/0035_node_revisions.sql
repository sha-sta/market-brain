-- Append-only history of a node's prior state, written BEFORE an overwrite (supersede / manual edit /
-- archive) so a correction is reversible and auditable. Stores prior TEXT only (data/status/title), NOT
-- the prior embedding (re-derivable from prior_data; 1536 floats per revision would bloat). Written by
-- the cron/worker via service_role AND by active users via the node-editor server actions (Phase 6).
create table public.node_revisions (
  id               uuid primary key default gen_random_uuid(),
  graph_id         uuid not null,
  node_id          text not null,
  prior_data       jsonb not null,
  prior_status     text,
  prior_title      text,
  reason           text not null, -- 'supersede' | 'merge' | 'enrich' | 'manual' | 'archive'
  source_upload_id uuid references public.raw_uploads (id) on delete set null,
  changed_at       timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index node_revisions_node_idx on public.node_revisions (graph_id, node_id, changed_at desc);

alter table public.node_revisions enable row level security;
create policy "node_revisions active select" on public.node_revisions
  for select to authenticated using (public.is_active());
create policy "node_revisions active insert" on public.node_revisions
  for insert to authenticated with check (public.is_active());

-- Active users read + append (manual edits); cron/worker have full access via service_role.
grant select, insert on public.node_revisions to authenticated;
grant select, insert, update, delete on public.node_revisions to service_role;
