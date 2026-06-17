-- Atomic claim for the normalization drain: flip up to `batch` pending rows to 'processing'
-- under FOR UPDATE SKIP LOCKED so concurrent cron invocations never grab the same row.
-- Backend-only (service_role) — not exposed to authenticated/anon.

create or replace function public.claim_raw_uploads(batch int default 5)
returns setof public.raw_uploads
language sql
as $$
  update public.raw_uploads
  set status = 'processing'
  where id in (
    select id from public.raw_uploads
    where status = 'pending'
    order by created_at
    for update skip locked
    limit batch
  )
  returning *;
$$;

revoke all on function public.claim_raw_uploads(int) from public;
grant execute on function public.claim_raw_uploads(int) to service_role;
