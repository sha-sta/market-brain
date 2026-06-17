-- User-defined alert rules + the events the daily cron fires against them. Rules are user-edited
-- (authenticated); events are cron-written (service_role) and surfaced in the brief + in-app.
-- A NULL node_id means a graph-wide rule (e.g. a portfolio-level news_spike). The composite FK to
-- nodes only fires when node_id is non-null (MATCH SIMPLE), so graph-wide rules are allowed.

create table public.alert_rules (
  id         uuid primary key default gen_random_uuid(),
  graph_id   uuid not null references public.graphs (id) on delete cascade,
  node_id    text,
  kind       text not null check (kind in ('price_above', 'price_below', 'pct_move', 'new_filing', 'news_spike')),
  threshold  numeric,                   -- price level, or % for pct_move; null for new_filing/news_spike
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index alert_rules_graph_idx on public.alert_rules (graph_id) where active;

create table public.alert_events (
  id       uuid primary key default gen_random_uuid(),
  graph_id uuid not null references public.graphs (id) on delete cascade,
  rule_id  uuid references public.alert_rules (id) on delete cascade,
  node_id  text,
  message  text not null,
  payload  jsonb not null default '{}'::jsonb,
  seen     boolean not null default false,
  fired_at timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index alert_events_graph_idx on public.alert_events (graph_id, fired_at desc);

alter table public.alert_rules  enable row level security;
alter table public.alert_events enable row level security;

create policy "alert_rules active all" on public.alert_rules
  for all to authenticated using (public.is_active()) with check (public.is_active());
create policy "alert_events active select" on public.alert_events
  for select to authenticated using (public.is_active());
create policy "alert_events active update" on public.alert_events
  for update to authenticated using (public.is_active()) with check (public.is_active());

grant select, insert, update, delete on public.alert_rules to authenticated, service_role;
grant select, update on public.alert_events to authenticated;          -- mark events seen
grant select, insert, update, delete on public.alert_events to service_role;
