-- Raw input preservation + async-normalization status. Nothing a human gives us is ever
-- lost: the original paste/file is kept so normalization can be re-run later. `status`
-- drives the per-file UI and the cron drain; failures stay visible (never silently dropped).

create table public.raw_uploads (
  id           uuid primary key default gen_random_uuid(),
  contributor  uuid not null references public.profiles (id),
  kind         text not null check (kind in ('text', 'md', 'pdf', 'image', 'other')),
  storage_path text,                  -- 'uploads' bucket path (files); null for pasted text
  raw_text     text,                  -- pasted text, or text extracted from pdf/image
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'done', 'failed')),
  error        text,
  usage        jsonb,                  -- per-document token usage + estimated $ cost (worker.setStatus)
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create index raw_uploads_status_idx on public.raw_uploads (status);

-- Binary assets (images/diagrams/pdfs) linked to nodes; node references them by storage path.
create table public.assets (
  id           uuid primary key default gen_random_uuid(),
  node_id      text references public.nodes (id) on delete set null,
  kind         text not null,
  storage_path text not null,         -- 'assets' bucket path
  caption      text,
  created_at   timestamptz not null default now()
);

create index assets_node_idx on public.assets (node_id);
