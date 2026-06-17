-- Morning-brief idempotency + archive. One row per (graph, ET date) enforced by the unique key, so a
-- re-run on the same day skips a second send. Cron-written via service_role; the archived `html` also
-- powers the in-app "today's brief" (/brief), so active users read it.

create table public.digest_log (
  id          uuid primary key default gen_random_uuid(),
  graph_id    uuid not null references public.graphs (id) on delete cascade,
  digest_date date not null,
  html        text,
  resend_id   text,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'archived')),
  created_at  timestamptz not null default now(),
  unique (graph_id, digest_date)
);
create index digest_log_graph_date_idx on public.digest_log (graph_id, digest_date desc);

alter table public.digest_log enable row level security;
create policy "digest_log active select" on public.digest_log
  for select to authenticated using (public.is_active());

grant select on public.digest_log to authenticated;
grant select, insert, update, delete on public.digest_log to service_role;
