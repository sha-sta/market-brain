-- Let the daily cron manufacture raw_uploads rows from fetched news: extend the kind check to allow
-- 'news', and add source_ref (the canonical article URL) so a re-run skips already-enqueued articles
-- (idempotent cron). A news row drains through the UNCHANGED worker into a `news` node + edges — the
-- key reuse insight: a news article and a user note are both just raw_uploads rows.

alter table public.raw_uploads drop constraint raw_uploads_kind_check;
alter table public.raw_uploads add constraint raw_uploads_kind_check
  check (kind in ('text', 'md', 'pdf', 'image', 'news', 'other'));

alter table public.raw_uploads add column source_ref text;   -- canonical article URL (news rows only)

-- The cron checks this before enqueuing, so the same article URL is never enqueued twice in a graph.
create index raw_uploads_source_ref_idx on public.raw_uploads (graph_id, source_ref)
  where source_ref is not null;
