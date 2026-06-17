-- One row per public ticker per daily cron run. Cron-written via service_role (private companies are
-- skipped — guarded on is_public — so they never get a fabricated price). Active users read for P&L,
-- movers, and history charts. The (graph_id, node_id, captured_at desc) index serves both
-- "latest snapshot per node" and time-series history.

create table public.price_snapshots (
  id          uuid primary key default gen_random_uuid(),
  graph_id    uuid not null,
  node_id     text not null,
  ticker      text not null,
  price       numeric,
  change_pct  numeric,
  market_cap  numeric,
  captured_at timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index price_snapshots_history_idx on public.price_snapshots (graph_id, node_id, captured_at desc);

alter table public.price_snapshots enable row level security;
create policy "price_snapshots active select" on public.price_snapshots
  for select to authenticated using (public.is_active());

-- Cron writes via service_role (bypasses RLS). Active users read only.
grant select on public.price_snapshots to authenticated;
grant select, insert, update, delete on public.price_snapshots to service_role;
