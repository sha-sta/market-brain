-- Reference-guarded HARD delete of long-archived chronological nodes — the "keep the free-tier DB lean"
-- half of tiered decay. archiveStaleNews/decayStaleNodes only soft-hides (lifecycle='archived', edges +
-- revision kept, recoverable); this reclaims the row + its pgvector embedding once the node is past its
-- per-tier DELETE window. CASCADE (0034/0035: edges, node_revisions, price/metric snapshots,
-- node_similarity all `on delete cascade` on the node FK; superseded_by is `on delete set null`) cleans
-- every child, so `delete from public.nodes` reclaims everything. The ONLY risk is semantic — deleting a
-- node that is still EVIDENCE for an active thesis, or still linked to an active tracked entity — which
-- the `guarded` CTE prevents. security definer so the cron's service_role runs it; never exposed to users.
--
-- The per-(type,tier) delete windows in `win` MUST mirror decayWindow() in lifecycle.ts. The sync-guard
-- unit test (tests/unit/lifecycle.test.ts) parses these tuples and fails the build on drift. Filings are
-- the primary record and are intentionally NOT in the eligible set (never hard-deleted). `landmark` news
-- has no delete window (handled below: it resolves to NULL ddays and is filtered out). Missing/unknown
-- `_tier` falls back to the 'notable' window — "when unsure, keep longer", never over-prune.
create or replace function public.prune_archived_nodes(p_graph_id uuid, p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  deleted_count integer;
begin
  with win(type, tier, ddays) as (
    values
      ('news','ephemeral',21),('news','routine',60),('news','notable',270),
      ('catalyst','ephemeral',45),('catalyst','routine',120),('catalyst','notable',365),
      ('signal','ephemeral',21),('signal','routine',90),('signal','notable',270)
  ),
  eligible as (
    select n.graph_id, n.id
    from public.nodes n
    cross join lateral (
      -- Resolve the node's effective delete window (days): its stored _tier if we delete on it; landmark
      -- => NULL (never); anything else (missing/unknown) => the conservative 'notable' default for its type.
      select coalesce(
        (select w.ddays from win w where w.type = n.type and w.tier = n.data->>'_tier'),
        case when n.data->>'_tier' = 'landmark' then null
             else (select w.ddays from win w where w.type = n.type and w.tier = 'notable') end
      ) as ddays
    ) tw
    where n.graph_id = p_graph_id
      and n.lifecycle = 'archived'
      and n.type in ('news','catalyst','signal') -- filings are the primary record; never hard-deleted
      and tw.ddays is not null -- landmark news (and any never-delete tier) is excluded
      and (
        coalesce(
          nullif(n.data->>'published_at', ''),
          nullif(n.data->>'event_date', ''),
          nullif(n.data->>'observed_at', ''),
          n.created_at::text
        )
      )::timestamptz < p_now - (tw.ddays || ' days')::interval
  ),
  guarded as (
    -- PROTECT: a node that is the SOURCE of a confirms/challenges edge into a LIVE thesis (evidence is the
    -- edge src; the judge writes evidence -> thesis). Deleting it would silently strip a thesis's evidence.
    select e.src_id as id
    from public.edges e
    join public.nodes t on t.graph_id = e.graph_id and t.id = e.dst_id
    where e.graph_id = p_graph_id
      and e.relation_type in ('confirms_thesis', 'challenges_thesis')
      and t.type = 'thesis'
      and t.lifecycle in ('active', 'stale')
    union
    -- PROTECT: a node still referenced by an ACTIVE tracked entity (a followed name).
    select te.node_id as id
    from public.tracked_entities te
    where te.graph_id = p_graph_id
      and te.candidate_status = 'active'
  ),
  to_delete as (
    select el.id from eligible el
    where el.id not in (select id from guarded)
  )
  delete from public.nodes n
  using to_delete d
  where n.graph_id = p_graph_id and n.id = d.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_archived_nodes(uuid, timestamptz) from public;
grant execute on function public.prune_archived_nodes(uuid, timestamptz) to service_role;
