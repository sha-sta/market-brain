-- Integrity v2: edge corroboration + a human review queue for ambiguous entity merges.

-- ============================================================================================
-- (B3) Corroboration — how many DISTINCT source uploads asserted an edge.
-- ============================================================================================
-- 1 by default (the creating upload). A fact asserted by several sources is more trustworthy; the
-- count is surfaced in the node panel. The `assertable` gate is NOT relaxed by this — corroboration
-- is informational, not a shortcut around evidence.
alter table public.edges
  add column support_count int not null default 1;

-- Atomic edge upsert. Insert, or on (src,dst,type) conflict refresh metadata: keep the STRONGEST
-- confidence + its relation_type/method, keep the first non-null evidence/source, and bump
-- support_count only when a *different* source upload corroborates (so re-processing the same upload
-- never inflates it). Replaces the JS .upsert so the read-modify-write can't race. Service-role only.
create or replace function public.upsert_edge(
  p_src_id text,
  p_dst_id text,
  p_type text,
  p_relation_type text,
  p_method text,
  p_confidence real,
  p_evidence_quote text default null,
  p_source_upload_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.edges (src_id, dst_id, type, relation_type, method, confidence, evidence_quote, source_upload_id, support_count)
  values (p_src_id, p_dst_id, p_type, p_relation_type, p_method, p_confidence, p_evidence_quote, p_source_upload_id, 1)
  on conflict (src_id, dst_id, type) do update set
    support_count = edges.support_count
      + (case when excluded.source_upload_id is not null
                and excluded.source_upload_id is distinct from edges.source_upload_id
              then 1 else 0 end),
    confidence = greatest(edges.confidence, excluded.confidence),
    relation_type = case when excluded.confidence >= edges.confidence then excluded.relation_type else edges.relation_type end,
    method = case when excluded.confidence >= edges.confidence then excluded.method else edges.method end,
    evidence_quote = coalesce(edges.evidence_quote, excluded.evidence_quote),
    source_upload_id = coalesce(edges.source_upload_id, excluded.source_upload_id);
end;
$$;

grant execute on function public.upsert_edge(text, text, text, text, text, real, text, uuid) to service_role;

-- ============================================================================================
-- (B2) SAME_AS review queue — surface ambiguous merges for a human instead of silently dropping them.
-- ============================================================================================
-- When dedupe lands an entity in the ambiguous fuzzy band (and the vector boost didn't promote it to a
-- confident match), the worker still inserts a NEW node (the safe default — never auto-merge on doubt)
-- AND records the candidate pair here. An admin later confirms (merge) or dismisses.
create table public.node_merge_candidates (
  id          uuid primary key default gen_random_uuid(),
  left_id     text not null references public.nodes (id) on delete cascade, -- the newly inserted node
  right_id    text not null references public.nodes (id) on delete cascade, -- the existing near-duplicate
  score       real not null,                                                -- fuzzy similarity (0-100)
  status      text not null default 'pending',                              -- pending | merged | dismissed
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index node_merge_candidates_pending_idx on public.node_merge_candidates (created_at) where status = 'pending';

-- RLS on (project convention). No grant to `authenticated`, so it's reachable only via the service-role
-- client — and the /review UI is requireAdmin-gated before it ever uses that client.
alter table public.node_merge_candidates enable row level security;
grant all on public.node_merge_candidates to service_role;

-- Merge two nodes atomically: repoint the dropped node's edges onto the kept node (skipping any that
-- would duplicate an existing edge — those cascade away with the delete), then delete the dropped node.
-- Node `data` is reconciled by the caller before invoking this. Service-role only.
create or replace function public.merge_nodes(keep_id text, drop_id text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if keep_id = drop_id then return; end if;
  -- Repoint the dropped node's edges onto the kept node. Skip edges that run BETWEEN the two nodes
  -- (e.dst/e.src already = keep_id) — repointing those would mint a keep->keep self-loop; instead they
  -- cascade away with the dropped node. Also skip any that would duplicate an existing kept-node edge.
  update public.edges e set src_id = keep_id
    where e.src_id = drop_id
      and e.dst_id <> keep_id
      and not exists (select 1 from public.edges k where k.src_id = keep_id and k.dst_id = e.dst_id and k.type = e.type);
  update public.edges e set dst_id = keep_id
    where e.dst_id = drop_id
      and e.src_id <> keep_id
      and not exists (select 1 from public.edges k where k.dst_id = keep_id and k.src_id = e.src_id and k.type = e.type);
  delete from public.nodes where id = drop_id; -- duplicate + between-the-pair edges cascade away
end;
$$;

grant execute on function public.merge_nodes(text, text) to service_role;
