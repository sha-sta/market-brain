-- Throttle state for the structural gap-fill pass: ground essential identity facts on tracked companies
-- at most once per interval (weekly), so the daily run doesn't re-attempt it every day. Written by the
-- cron's service_role (RLS update policy already exists on graphs for active users; service_role bypasses).
alter table public.graphs add column last_gap_fill_at timestamptz;
