-- Per-node freshness provenance so the supersede rule can answer "is the incoming source NEWER than the
-- fact already stored?". `data_as_of` is the source document's date (news.published_at, filing.filed_at,
-- catalyst.event_date), falling back to write time — a backfilled OLD article must never overwrite a
-- fresh fact. Per-FIELD provenance lives in data._provenance (jsonb, no DDL). `source_upload_id` traces
-- the upload that last wrote the narrative. No new grants — new columns inherit the nodes table grants.
alter table public.nodes add column source_upload_id uuid references public.raw_uploads (id) on delete set null;
alter table public.nodes add column data_as_of timestamptz;
create index nodes_data_as_of_idx on public.nodes (graph_id, type, data_as_of desc);
