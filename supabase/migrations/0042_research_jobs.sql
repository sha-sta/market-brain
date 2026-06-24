-- The gated, queued interactive research path. The reader submits a prompt ("dig into HBM supply risk for my
-- names"); a row is inserted (pending), an async route processes it (web search -> populate graph ->
-- strict synthesis -> result), and the UI polls the row. A small daily quota (enforced in the action)
-- bounds cost. The requester sees only their own jobs; the service-role processor mutates status/result.
create table public.research_jobs (
  id             uuid primary key default gen_random_uuid(),
  graph_id       uuid not null references public.graphs (id) on delete cascade,
  requester      uuid not null references public.profiles (id),
  prompt         text not null,
  params         jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  result_summary text,
  result_node_id text,
  cost_usd       numeric not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index research_jobs_graph_status_idx on public.research_jobs (graph_id, status, created_at desc);
create index research_jobs_requester_day_idx on public.research_jobs (requester, created_at desc); -- quota counting

alter table public.research_jobs enable row level security;
create policy "research_jobs select own" on public.research_jobs
  for select to authenticated
  using (public.is_active() and requester = (select auth.uid()));
create policy "research_jobs insert own" on public.research_jobs
  for insert to authenticated
  with check (public.is_active() and requester = (select auth.uid()));
-- No UPDATE/DELETE for authenticated: only the service-role processor mutates status/result/cost.
grant select, insert on public.research_jobs to authenticated;
grant select, insert, update, delete on public.research_jobs to service_role;

create trigger research_jobs_touch_updated_at
  before update on public.research_jobs
  for each row execute function public.touch_updated_at();

-- DB-level rate-limit BACKSTOP. The app enforces a softer per-user quota (RESEARCH_DAILY_QUOTA, default
-- 5) in the submit action, but the RLS insert policy would otherwise let an active user insert directly
-- via the SDK and bypass it. This hard cap (25 / rolling 24h / requester) bounds AI cost from abuse
-- without interfering with normal use.
create or replace function public.research_jobs_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  recent int;
begin
  select count(*) into recent
    from public.research_jobs
   where requester = new.requester and created_at > now() - interval '24 hours';
  if recent >= 25 then
    raise exception 'research job rate limit exceeded (25 per 24h)';
  end if;
  return new;
end;
$$;
create trigger research_jobs_rate_limit_trg
  before insert on public.research_jobs
  for each row execute function public.research_jobs_rate_limit();

-- Claim one pending job -> running atomically (SKIP LOCKED prevents a double-trigger from
-- double-processing). Returns the claimed row, or no rows if it was already taken / not pending.
create or replace function public.claim_research_job(p_job_id uuid)
returns setof public.research_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  update public.research_jobs j
     set status = 'running'
   where j.id = (
     select r.id from public.research_jobs r
      where r.id = p_job_id and r.status = 'pending'
      for update skip locked
   )
  returning j.*;
end;
$$;
revoke all on function public.claim_research_job(uuid) from public;
grant execute on function public.claim_research_job(uuid) to service_role;
