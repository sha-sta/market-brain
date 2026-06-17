-- Approved-users layer. Ports console/accounts.py's pending->active|denied workflow
-- to Supabase: a profile per auth.users row, gated by RLS via is_active()/is_admin().

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  name       text,
  status     text not null default 'pending' check (status in ('pending', 'active', 'denied')),
  is_admin   boolean not null default false,
  role       text,
  created_at timestamptz not null default now()
);

-- New signups get a 'pending' profile automatically. Bootstrap/first admin is promoted
-- out-of-band (seed.sql for local dev; a one-time UPDATE in prod) — see README.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS helpers. SECURITY DEFINER so they read profiles WITHOUT triggering profiles' own
-- RLS (prevents infinite recursion when used inside policies). (select auth.uid()) is
-- wrapped per Supabase RLS performance guidance (initplan caching).
create or replace function public.is_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin and p.status = 'active'
  );
$$;
