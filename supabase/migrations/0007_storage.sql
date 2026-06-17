-- Private Storage buckets for raw uploads + referenced binary assets. Both gated by RLS on
-- storage.objects. Uploads are scoped to the contributor's own folder (<uid>/...). Assets
-- are written by the worker (service-role, bypasses RLS); clients only read them.

insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('assets', 'assets', false)
  on conflict (id) do nothing;

create policy "uploads read active" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.is_active());

create policy "uploads insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and public.is_active()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "assets read active" on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and public.is_active());
