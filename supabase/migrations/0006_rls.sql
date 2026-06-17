-- RLS: only profiles.status='active' may read/write the graph. The normalization worker
-- uses the service-role key (bypasses RLS) for its upserts; these policies gate the
-- browser (anon-key) client. Pending/denied users are authenticated but see nothing.

alter table public.profiles    enable row level security;
alter table public.nodes       enable row level security;
alter table public.edges       enable row level security;
alter table public.raw_uploads enable row level security;
alter table public.assets      enable row level security;

-- profiles: a user sees their own row; admins see all (for the approval queue).
create policy "profiles select self or admin" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or public.is_admin());

-- A user may update their own row, but the guard trigger below blocks status/is_admin edits.
create policy "profiles update self" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Admins may update any profile (approve/deny).
create policy "profiles update admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Privilege-escalation guard: an authenticated NON-admin cannot change their own status or
-- is_admin. The backend (service_role) and migrations (no JWT) are unrestricted — only the
-- 'authenticated' end-user path is policed.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'authenticated' then
    return new;
  end if;
  if not public.is_admin() then
    if new.status is distinct from old.status
       or new.is_admin is distinct from old.is_admin then
      raise exception 'not allowed to change status or is_admin';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Graph tables: active users get full read/write.
create policy "nodes active all" on public.nodes
  for all to authenticated using (public.is_active()) with check (public.is_active());

create policy "edges active all" on public.edges
  for all to authenticated using (public.is_active()) with check (public.is_active());

create policy "assets active all" on public.assets
  for all to authenticated using (public.is_active()) with check (public.is_active());

-- raw_uploads: active users read all; may only insert rows attributed to themselves.
create policy "raw_uploads active select" on public.raw_uploads
  for select to authenticated using (public.is_active());

create policy "raw_uploads self insert" on public.raw_uploads
  for insert to authenticated
  with check (public.is_active() and contributor = (select auth.uid()));

create policy "raw_uploads active update" on public.raw_uploads
  for update to authenticated using (public.is_active()) with check (public.is_active());
