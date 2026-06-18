-- tracked_entities becomes BOTH the user's follow-list AND the engine's auto-discovery queue.
--   source           manual (user-followed) | auto (engine-discovered)
--   candidate_status candidate (discovered, NOT yet fetched — the cost firewall) | active (fetched daily) | dropped
--   score            connection strength / recency, for promotion ranking
--   last_surfaced_at recency, for decaying stale candidates that never get promoted
-- Existing rows + manual follows default to source='manual', candidate_status='active'. The daily
-- readers (trackedCompanies, gatherConnections) MUST filter candidate_status='active' so a discovered
-- candidate never silently incurs a quote/news API call. Adds kind 'discovered' for auto entries.
alter table public.tracked_entities
  add column source text not null default 'manual' check (source in ('manual', 'auto'));
alter table public.tracked_entities
  add column candidate_status text not null default 'active' check (candidate_status in ('candidate', 'active', 'dropped'));
alter table public.tracked_entities add column score numeric not null default 0;
alter table public.tracked_entities add column last_surfaced_at timestamptz not null default now();

-- Widen the kind check to allow engine-discovered entities. `if exists` so a renamed/missing constraint
-- degrades gracefully instead of aborting the migration mid-flight.
alter table public.tracked_entities drop constraint if exists tracked_entities_kind_check;
alter table public.tracked_entities
  add constraint tracked_entities_kind_check check (kind in ('owned', 'watchlist', 'theme', 'discovered'));

create index tracked_entities_status_idx on public.tracked_entities (graph_id, candidate_status);
