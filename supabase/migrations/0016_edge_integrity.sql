-- Edge integrity v1: make relationships auditable so generated outreach can't credit someone for
-- work they didn't do. An edge may ground a FACTUAL claim only if it (a) is a STRONG relation type,
-- (b) clears a confidence bar, and (c) carries a verbatim evidence_quote from a source upload.
-- Everything else is association (weak) and is navigation/provenance only — never asserted.

alter table public.edges
  add column relation_type    text  not null default 'relates_to',
  add column evidence_quote   text,
  add column source_upload_id uuid  references public.raw_uploads (id) on delete set null,
  add column confidence       real  not null default 0,
  add column method           text  not null default 'wikilink';

-- `assertable` is the single gate the drafter checks. Generated/STORED so it can't drift from its
-- inputs. The STRONG set must stay in sync with src/server/normalize/relations.ts.
alter table public.edges
  add column assertable boolean generated always as (
    relation_type in ('authored', 'created', 'affiliated_with', 'published_in', 'member_of', 'advises', 'owns')
    and confidence >= 0.8
    and evidence_quote is not null
  ) stored;

-- Conservative legacy backfill: existing edges get a mapped relation_type from their raw `type`
-- label, but NO evidence_quote -> assertable=false. The pre-existing graph therefore cannot ground
-- outreach claims until those docs are re-dumped through the grounded extractor. Safe by default.
update public.edges set
  method = 'legacy',
  relation_type = case
    when type in ('authors', 'author') then 'authored'
    when type in ('lab', 'institution', 'affiliation') then 'affiliated_with'
    when type = 'pi' then 'advises'
    when type = 'owner' then 'owns'
    when type = 'creators' then 'created'
    when type = 'mentions' then 'mentions'
    when type = 'motivated_by' then 'motivated_by'
    when type = 'relates_to' then 'relates_to'
    else 'relates_to'
  end;

create index edges_assertable_idx on public.edges (dst_id) where assertable;
