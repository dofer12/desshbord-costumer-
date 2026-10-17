-- 0003_admin.sql
-- What the administrator tools lean on: a guard that keeps the last active administrator in place,
-- whoever tries to remove them and by whatever route, and a way to end every session of a user.
-- The rest of the administration (employees, statuses, settings) needs nothing new here: it uses
-- the Edge Function admin-users, and the admin-only policies of 0002. The one other thing is the
-- function with which a person changes their own profile, which now holds the lines of the form.

-- The last active administrator cannot be blocked, demoted or deleted. It is a trigger and not a
-- check in the function, so that it holds for the dashboard and for SQL as well.
create function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a change that takes an active administrator out of that state can matter.
  if not (old.role = 'admin' and old.is_active) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role = 'admin' and new.is_active then
    return new;
  end if;

  -- Two such changes made at the same moment are judged one after the other. Without the lock each
  -- of them could see the other administrator as still in place, and both would go through.
  perform pg_advisory_xact_lock(hashtext('public.profiles.last_admin'));

  if not exists (
    select 1 from public.profiles p
    where p.id <> old.id and p.role = 'admin' and p.is_active
  ) then
    raise exception 'profiles_last_admin'
      using errcode = '23514', hint = 'The last active administrator cannot be blocked, demoted or deleted.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.protect_last_admin() from public, anon, authenticated;

create trigger profiles_protect_last_admin
  before update of role, is_active or delete on public.profiles
  for each row execute function public.protect_last_admin();

-- Ends every session of a user, so that a person who was blocked, or whose password was reset, is
-- signed out of every device. Their refresh tokens go with the sessions. The Edge Function calls it
-- with the secret key; nobody else may.
create function public.revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- A person's own profile. The form of the app takes a name of 1 to 60 characters with nothing in it that a
-- list or a log line could be spoiled by (the function of the administrators holds the same line), and a
-- reminder of a day at the most. The function holds them too, for whoever calls it: a screen is never the
-- protection. Otherwise it is the function of 0002, and its grants stay as they were.
create or replace function public.update_my_profile(p_display_name text, p_default_remind_min integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_display_name), '');
begin
  if not public.is_member() then
    raise exception 'only an active member can change their profile' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'the display name cannot be empty' using errcode = '22023';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'the display name cannot be longer than 60 characters' using errcode = '22023';
  end if;
  if v_name ~ '[\x01-\x1f\x7f-\x9f]' then
    raise exception 'the display name cannot hold a control character' using errcode = '22023';
  end if;
  if p_default_remind_min is null or p_default_remind_min < 0 or p_default_remind_min > 1440 then
    raise exception 'the default reminder must be between 0 and 1440 minutes' using errcode = '22023';
  end if;
  -- A name that a colleague already has raises the unique violation of profiles_display_name_key.
  update public.profiles
     set display_name = v_name, default_remind_min = p_default_remind_min
   where id = (select auth.uid());
end;
$$;
