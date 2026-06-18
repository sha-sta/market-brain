-- General quant time-series, the metric analogue of price_snapshots: catalyst outcomes (EPS actual vs
-- est), fundamentals (revenue, margin), macro readings (CPI print), signal strength over time. One row
-- per (node, metric) observation. Cron-written via service_role; active users read for history/charts.
create table public.metric_snapshots (
  id               uuid primary key default gen_random_uuid(),
  graph_id         uuid not null,
  node_id          text not null,
  metric           text not null, -- 'eps_actual','eps_estimate','revenue','gross_margin','cpi_yoy','signal_strength'
  value            numeric,
  unit             text,
  as_of            date, -- the period the metric describes (verbatim from source)
  source           text, -- 'fmp','finnhub','manual','llm'
  source_upload_id uuid references public.raw_uploads (id) on delete set null,
  captured_at      timestamptz not null default now(),
  foreign key (graph_id, node_id) references public.nodes (graph_id, id) on delete cascade
);
create index metric_snapshots_history_idx on public.metric_snapshots (graph_id, node_id, metric, captured_at desc);

alter table public.metric_snapshots enable row level security;
create policy "metric_snapshots active select" on public.metric_snapshots
  for select to authenticated using (public.is_active());
grant select on public.metric_snapshots to authenticated;
grant select, insert, update, delete on public.metric_snapshots to service_role;
