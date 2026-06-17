-- The graph: canonical entities. The old markdown frontmatter becomes the `data` jsonb;
-- every node is stamped with its `contributor` and carries an `embedding` for relatedness.

create table public.nodes (
  id          text primary key,                 -- stable kebab slug (BaseNote.id)
  type        text not null,                    -- company|person|sector|theme|news|filing|thesis|note
  module      text not null default 'market-brain',
  title       text not null,
  status      text,
  data        jsonb not null default '{}'::jsonb, -- type-specific fields + body prose
  tags        text[] not null default '{}',
  contributor uuid references public.profiles (id),
  embedding   vector(1536),                     -- openai/text-embedding-3-small via AI Gateway
  -- Full-text over the human-meaningful fields. Two-arg to_tsvector(regconfig, text) is
  -- IMMUTABLE, so it is valid in a generated column. Finance fields added: a `news` node keys on
  -- `headline`, a `thesis` on `statement`, and `summary`/`description` carry the prose for both.
  search tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(data ->> 'name', '') || ' ' ||
      coalesce(data ->> 'headline', '') || ' ' ||
      coalesce(data ->> 'statement', '') || ' ' ||
      coalesce(data ->> 'description', '') || ' ' ||
      coalesce(data ->> 'definition', '') || ' ' ||
      coalesce(data ->> 'summary', '') || ' ' ||
      coalesce(data ->> 'body', '')
    )
  ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index nodes_search_idx on public.nodes using gin (search);
create index nodes_tags_idx   on public.nodes using gin (tags);
create index nodes_type_idx   on public.nodes (type);
-- HNSW needs no training data (unlike ivfflat) and gives good recall at our scale.
create index nodes_embedding_idx on public.nodes using hnsw (embedding vector_cosine_ops);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger nodes_touch_updated_at
  before update on public.nodes
  for each row execute function public.touch_updated_at();
