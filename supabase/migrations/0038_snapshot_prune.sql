-- Retention/downsample for the time-series tables (the "delete outdated quant data" half of the living
-- graph). Invoked per-graph from the daily engine after refresh (try/catch isolated). security definer
-- so the cron's service_role can run it; never exposed to users.
--   price_snapshots:  keep all < 90d; 90d–2y keep only the latest per (node, ISO week); drop > 2y.
--   metric_snapshots: keep all < 400d (covers YoY); 400d–5y keep latest per (node, metric, quarter); drop > 5y.
create or replace function public.prune_snapshots(p_graph_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- price: drop everything older than 2 years.
  delete from public.price_snapshots
   where graph_id = p_graph_id and captured_at < now() - interval '2 years';

  -- price: between 90 days and 2 years, keep only the latest row per (node, ISO week). The keep-set
  -- subquery carries its OWN bounds (independent of statement order); `id` is the PK (never null) so
  -- the NOT IN is null-safe.
  delete from public.price_snapshots p
   where p.graph_id = p_graph_id
     and p.captured_at < now() - interval '90 days'
     and p.captured_at >= now() - interval '2 years'
     and p.id not in (
       select distinct on (node_id, date_trunc('week', captured_at)) id
         from public.price_snapshots
        where graph_id = p_graph_id
          and captured_at < now() - interval '90 days'
          and captured_at >= now() - interval '2 years'
        order by node_id, date_trunc('week', captured_at), captured_at desc
     );

  -- metric: drop everything older than 5 years.
  delete from public.metric_snapshots
   where graph_id = p_graph_id and captured_at < now() - interval '5 years';

  -- metric: between 400 days and 5 years, keep only the latest per (node, metric, quarter). Self-bounded
  -- keep-set; `id` PK is never null so NOT IN is null-safe.
  delete from public.metric_snapshots m
   where m.graph_id = p_graph_id
     and m.captured_at < now() - interval '400 days'
     and m.captured_at >= now() - interval '5 years'
     and m.id not in (
       select distinct on (node_id, metric, date_trunc('quarter', captured_at)) id
         from public.metric_snapshots
        where graph_id = p_graph_id
          and captured_at < now() - interval '400 days'
          and captured_at >= now() - interval '5 years'
        order by node_id, metric, date_trunc('quarter', captured_at), captured_at desc
     );
end;
$$;

revoke all on function public.prune_snapshots(uuid) from public;
grant execute on function public.prune_snapshots(uuid) to service_role;
