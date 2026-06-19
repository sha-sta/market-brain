-- Fact reconciliation: when the extractor flags that a stored fact on a PERMANENT node changed (a CEO
-- left, a product was discontinued, guidance was revised), high-confidence + evidence-verified changes
-- auto-apply through writeNodeData (reversible via node_revisions). Mid-confidence ones land HERE for a
-- human to confirm/reject rather than silently mutating a core entity. The worker (service_role) writes
-- rows; an active user reads them for review.
create table public.correction_queue (
  id               uuid primary key default gen_random_uuid(),
  graph_id         uuid not null,
  node_id          text not null,
  field            text not null,
  old_value        text,
  new_value        text not null,
  evidence         text,
  confidence       real not null,
  kind             text not null default 'value' check (kind in ('value', 'rename', 'relation_expiry')),
  source_upload_id uuid references public.raw_uploads (id) on delete set null,
  status           text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_at       timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);

create index correction_queue_pending_idx on public.correction_queue (graph_id, status) where status = 'pending';

alter table public.correction_queue enable row level security;
-- Active users may review the queue; only the service-role worker writes/resolves it.
create policy "correction_queue select" on public.correction_queue
  for select to authenticated using (public.is_active());

grant select on public.correction_queue to authenticated;
grant select, insert, update, delete on public.correction_queue to service_role;
