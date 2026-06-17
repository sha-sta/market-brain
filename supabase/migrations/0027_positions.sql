-- Manual holdings. Public companies: `shares` + `cost_basis` (per-share avg) drive live P&L against
-- price_snapshots. Private companies (Anthropic, SpaceX — no quote API): `manual_value` carries the
-- whole-position valuation. `is_watchlist` rows are tracked-but-unowned. All user-edited.

create table public.positions (
  id           uuid primary key default gen_random_uuid(),
  graph_id     uuid not null,
  node_id      text not null,            -- [[company]] node
  account      text,
  shares       numeric,
  cost_basis   numeric,                  -- per-share average cost (public cos)
  manual_value numeric,                  -- whole-position manual valuation (private cos)
  is_watchlist boolean not null default false,
  opened_at    date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index positions_graph_node_idx on public.positions (graph_id, node_id);

alter table public.positions enable row level security;
create policy "positions active all" on public.positions
  for all to authenticated using (public.is_active()) with check (public.is_active());
grant select, insert, update, delete on public.positions to authenticated, service_role;

create trigger positions_touch_updated_at
  before update on public.positions
  for each row execute function public.touch_updated_at();
