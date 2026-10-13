-- 0001_profiles.sql
-- Login users, the "first user becomes admin" bootstrap, and the membership
-- helpers that every later table's RLS policies build on.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  default_remind_min integer not null default 15 check (default_remind_min >= 0),
  created_at timestamptz not null default now()
);

create unique index profiles_display_name_key on public.profiles (lower(display_name));

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  )
$$;

revoke all on function public.is_member() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_first boolean;
  v_role text;
  v_name text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  v_role := case
    when v_is_first then 'admin'
    else coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'employee')
  end;
  if v_role not in ('admin', 'employee') then
    v_role := 'employee';
  end if;

  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );

  insert into public.profiles (id, email, display_name, role, must_change_password)
  values (new.id, coalesce(new.email, ''), v_name, v_role, not v_is_first);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy profiles_select_members
  on public.profiles
  for select
  to authenticated
  using (public.is_member());

-- Users that already existed when this ran (for example the owner created the first
-- user before running this file) still get a profile. The oldest of them is the admin.
insert into public.profiles (id, email, display_name, role, must_change_password)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'user'
  ),
  case when row_number() over (order by u.created_at) = 1 then 'admin' else 'employee' end,
  row_number() over (order by u.created_at) > 1
from auth.users u;
