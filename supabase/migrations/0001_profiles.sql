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
  v_app_role text;
  v_role text;
  v_chosen_name text;
  v_base_name text;
  v_name text;
  v_attempt integer := 1;
  v_constraint text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  -- Only the service role can write app_metadata, so a valid role there means an admin tool
  -- created this user on purpose. Anyone else (a sign-up that was left switched on, a user added
  -- in the dashboard) gets an inactive profile, which RLS treats as no access at all, until an
  -- admin activates it. The very first user is the exception: the owner creates it.
  v_app_role := nullif(new.raw_app_meta_data ->> 'role', '');
  if v_app_role is not null and v_app_role not in ('admin', 'employee') then
    v_app_role := null;
  end if;
  v_role := case when v_is_first then 'admin' else coalesce(v_app_role, 'employee') end;

  v_chosen_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  v_base_name := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user');
  v_name := coalesce(v_chosen_name, v_base_name);

  loop
    begin
      insert into public.profiles (id, email, display_name, role, is_active, must_change_password)
      values (
        new.id,
        coalesce(new.email, ''),
        v_name,
        v_role,
        v_is_first or v_app_role is not null,
        not v_is_first
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- A name somebody typed must stay unique, and the error says so. A name derived from the
      -- email only has to be unique ("dana", "dana 2", ...): creating a user must not fail
      -- because two colleagues share the part before the @.
      if v_constraint is distinct from 'profiles_display_name_key' or v_chosen_name is not null then
        raise;
      end if;
      v_attempt := v_attempt + 1;
      v_name := v_base_name || ' ' || v_attempt;
    end;
  end loop;

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
-- user before running this file) still get a profile, by the same rules as a new user:
-- the oldest is the active admin, and the others stay inactive unless an admin tool gave
-- them a role. Names derived from the same email prefix get a number ("dana", "dana 2").
with ranked as (
  select
    u.id,
    coalesce(u.email, '') as email,
    case when u.raw_app_meta_data ->> 'role' in ('admin', 'employee') then u.raw_app_meta_data ->> 'role' end as app_role,
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'user'
    ) as base_name,
    row_number() over (order by u.created_at, u.id) as age
  from auth.users u
), named as (
  select *, row_number() over (partition by lower(base_name) order by age) as same_name
  from ranked
)
insert into public.profiles (id, email, display_name, role, is_active, must_change_password)
select
  id,
  email,
  case when same_name = 1 then base_name else base_name || ' ' || same_name end,
  case when age = 1 then 'admin' else coalesce(app_role, 'employee') end,
  age = 1 or app_role is not null,
  age > 1
from named;
