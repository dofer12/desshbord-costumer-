-- 0002_core.sql
-- The task core: statuses, settings, tasks, their attachments and their history, with the rules
-- that keep them honest. Run it once in the Supabase SQL Editor after 0001_profiles.sql.
--
-- Part 1: tables, constraints, indexes and seed data.
-- Part 2: triggers (updated_at, done_by, the change history, the Glassix rule).
-- Part 3: permissions (row level security), the file bucket, realtime, profile functions.

-- ---------------------------------------------------------------------------------------------
-- Part 1: tables
-- ---------------------------------------------------------------------------------------------

create table public.statuses (
  key text primary key,
  name_he text not null,
  color text not null,
  sort integer not null,
  is_active boolean not null default true
);

alter table public.statuses enable row level security;

-- The 17 statuses of the old app, with the same names and colours.
insert into public.statuses (key, name_he, color, sort) values
  ('processing', 'בטיפול', '#22a559', 1),
  ('pending', 'בהמתנה לתשלום', '#6b7280', 2),
  ('completed', 'הושלמו', '#7c9cc0', 3),
  ('on-hold', 'משהה', '#e9a45c', 4),
  ('cancelled', 'בוטלו', '#3a4250', 5),
  ('refunded', 'החזר כספי', '#9aa3ad', 6),
  ('failed', 'נכשלו', '#e0707a', 7),
  ('cargo', 'Send to CARGO', '#1e88c9', 8),
  ('late', 'חריגה מהצפי', '#f08a80', 9),
  ('bank', 'ממתינה להעברה בנקאית', '#2fb86a', 10),
  ('to-branch', 'הועבר לאיסוף מסניף', '#8fcf9b', 11),
  ('await-pickup', 'ממתין לאיסוף לקוח', '#a78bda', 12),
  ('courier', 'נמסר לחברת שליחויות', '#d4b800', 13),
  ('delivered-branch', 'נמסר ללקוח בסניף', '#8aa7c7', 14),
  ('pull', 'משיכה מסניפים', '#d93a32', 15),
  ('manager', 'טיפול מנהל', '#c2185b', 16),
  ('abroad', 'הזמנת חו"ל', '#18c13a', 17);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('glassix_url_template', '""'::jsonb),
  ('ship_methods', '["איסוף עצמי", "משלוח עד הבית", "נקודת איסוף", "CARGO"]'::jsonb),
  ('last_backup_at', 'null'::jsonb);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'general' check (kind in ('general', 'delivery', 'pickup')),
  -- The author keeps their tasks for life, so a user who has created tasks cannot be deleted.
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  title text not null default '',
  notes text not null default '',
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  status_key text not null default 'processing' references public.statuses (key),
  assignee_id uuid references public.profiles (id) on delete set null,
  due_at timestamptz,
  duration_min integer not null default 30 check (duration_min > 0),
  remind_min integer check (remind_min >= 0),
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null,

  customer_name text not null default '',
  customer_phone text not null default '',
  -- Digits only, so a search finds the number however it was typed.
  customer_phone_digits text generated always as (regexp_replace(customer_phone, '\D', '', 'g')) stored,
  order_number text not null default '',
  service_call_number text not null default '',
  glassix_conversation_id text not null default '',
  no_glassix boolean not null default false,

  cargo_number text not null default '',
  sent_to_cargo boolean not null default false,

  product_name text not null default '',
  product_sku text not null default '',
  thumb_attachment_id uuid,

  ship_method text not null default '',
  ship_status text not null default '',
  order_date text not null default '',
  billing text not null default '',
  ship_to text not null default '',

  -- The id of the task in the old app. Unique, so importing the same backup twice adds nothing.
  legacy_id text unique,
  legacy_handler text not null default ''

  -- The rule "a Glassix conversation id, or the tick that there is none" is checked by a trigger
  -- (check_glassix_rule, in part 2) and not by a CHECK constraint, see there.
);

alter table public.tasks enable row level security;

create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_order_number_idx on public.tasks (order_number);
create index tasks_updated_at_idx on public.tasks (updated_at);
create index tasks_open_due_idx on public.tasks (due_at) where done_at is null and deleted_at is null;

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  storage_path text not null,
  thumb_path text not null default '',
  kind text not null check (kind in ('image', 'screenshot', 'product')),
  width integer,
  height integer,
  bytes integer,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.attachments enable row level security;

create index attachments_task_idx on public.attachments (task_id);

alter table public.tasks
  add constraint tasks_thumb_attachment_fkey
  foreign key (thumb_attachment_id) references public.attachments (id) on delete set null;

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type text not null check (type in (
    'created', 'updated', 'status', 'assigned', 'done', 'reopened', 'deleted', 'restored',
    'attachment_added', 'attachment_removed'
  )),
  changes jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

alter table public.task_events enable row level security;

create index task_events_task_idx on public.task_events (task_id, at desc);

-- ---------------------------------------------------------------------------------------------
-- Part 2: triggers. They run on the server, so the app can neither skip them nor fake what they
-- write.
-- ---------------------------------------------------------------------------------------------

-- Keeps the bookkeeping columns of a task honest, whatever the app sends: the id, the author and
-- the creation time of a task never change, updated_at is the time of this change, and done_by is
-- whoever marked the task done.
create function public.touch_task() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.done_by := case when new.done_at is null then null else coalesce(auth.uid(), new.created_by) end;
    return new;
  end if;

  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.done_by := case
    when new.done_at is null then null
    when old.done_at is null then auth.uid()
    -- Still done, so keep who did it. The one exception is the foreign key action that clears the
    -- name of a removed person: it runs inside this trigger's caller (depth 2), never from the app.
    when pg_trigger_depth() > 1 then new.done_by
    else old.done_by
  end;
  return new;
end;
$$;

create trigger tasks_touch
  before insert or update on public.tasks
  for each row execute function public.touch_task();

-- Writes the history of a task: what changed, who changed it, and when.
create function public.log_task_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  rest jsonb;
  step record;
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, type) values (new.id, actor, 'created');
    return null;
  end if;

  -- Every field that changed, as {field: [old, new]}. The fields that the server keeps up to date
  -- itself say nothing about what a person did, so they are left out.
  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value)), '{}'::jsonb)
    into rest
    from jsonb_each(to_jsonb(new)) as n
    join jsonb_each(to_jsonb(old)) as o on o.key = n.key
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'done_by', 'created_at', 'customer_phone_digits');

  -- A change of deleted_at, done_at, the status or the assignee gets an event of its own kind. A
  -- move from one date to another date is not a deletion or a completion, so it stays with the rest.
  for step in
    select * from (values
      (1, 'deleted_at', case
        when old.deleted_at is null and new.deleted_at is not null then 'deleted'
        when old.deleted_at is not null and new.deleted_at is null then 'restored'
      end),
      (2, 'done_at', case
        when old.done_at is null and new.done_at is not null then 'done'
        when old.done_at is not null and new.done_at is null then 'reopened'
      end),
      (3, 'status_key', 'status'),
      (4, 'assignee_id', 'assigned')
    ) as s (ord, field, kind)
    where s.kind is not null and (rest -> s.field) is not null
    order by s.ord
  loop
    insert into public.task_events (task_id, actor_id, type, changes)
    values (new.id, actor, step.kind, jsonb_build_object(step.field, rest -> step.field));
    rest := rest - step.field;
  end loop;

  if rest <> '{}'::jsonb then
    insert into public.task_events (task_id, actor_id, type, changes) values (new.id, actor, 'updated', rest);
  end if;
  return null;
end;
$$;

create trigger tasks_log_event
  after insert or update on public.tasks
  for each row execute function public.log_task_event();

-- Every task has a Glassix conversation id, or the tick that there is no conversation. This is
-- checked on the row that was really written, after the insert or the update, and not by a CHECK
-- constraint: the app sends a change as an upsert that holds only the changed fields, Postgres
-- first builds a whole new row from the defaults for it (which has neither the id nor the tick) and
-- checks the constraints of that row before it finds that the task already exists.
create function public.check_glassix_rule() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.no_glassix and new.glassix_conversation_id = '' then
    raise exception 'new row for relation "tasks" violates check constraint "tasks_glassix_rule"'
      using errcode = '23514', schema = 'public', table = 'tasks', constraint = 'tasks_glassix_rule';
  end if;
  return null;
end;
$$;

create trigger tasks_glassix_rule
  after insert or update on public.tasks
  for each row execute function public.check_glassix_rule();

-- Writes the adding and the removing of an attachment on the history of its task.
create function public.log_attachment_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, type, changes)
    values (
      new.task_id, auth.uid(), 'attachment_added',
      jsonb_build_object('attachment', jsonb_build_array(null::jsonb, jsonb_build_object('id', new.id, 'kind', new.kind)))
    );
  elsif exists (select 1 from public.tasks where id = old.task_id) then
    -- When a whole task is deleted its attachments go with it, and its history goes too.
    insert into public.task_events (task_id, actor_id, type, changes)
    values (
      old.task_id, auth.uid(), 'attachment_removed',
      jsonb_build_object('attachment', jsonb_build_array(jsonb_build_object('id', old.id, 'kind', old.kind), null::jsonb))
    );
  end if;
  return null;
end;
$$;

create trigger attachments_log_event
  after insert or delete on public.attachments
  for each row execute function public.log_attachment_event();

-- ---------------------------------------------------------------------------------------------
-- Part 3: permissions, the file bucket, realtime and the profile functions
-- ---------------------------------------------------------------------------------------------
-- Row level security is on for every table. The grants say what each of the two roles of the app
-- can do at all, the policies say on which rows. `anon`, a visitor who is not signed in, gets
-- nothing. Supabase hands every new table and function to both roles, so what the app must not
-- have is taken away first.

revoke all on table public.statuses, public.app_settings, public.tasks, public.attachments, public.task_events
  from public, anon, authenticated;
-- The trigger functions are for the triggers only. (A trigger does not need its caller to be able to
-- execute the function.)
revoke all on function
  public.touch_task(), public.log_task_event(), public.log_attachment_event(), public.check_glassix_rule()
  from public, anon, authenticated;

grant select, insert, update, delete on table public.statuses, public.app_settings to authenticated;
-- Nobody deletes a task: it is marked deleted instead, and the history keeps the record.
grant select, insert, update on table public.tasks to authenticated;
grant select, insert, delete on table public.attachments to authenticated;
-- The history is written by the triggers alone.
grant select on table public.task_events to authenticated;

-- Statuses and settings: every active member reads, an administrator writes.
create policy statuses_select_members on public.statuses
  for select to authenticated using ((select public.is_member()));
create policy statuses_insert_admin on public.statuses
  for insert to authenticated with check ((select public.is_admin()));
create policy statuses_update_admin on public.statuses
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy statuses_delete_admin on public.statuses
  for delete to authenticated using ((select public.is_admin()));

create policy app_settings_select_members on public.app_settings
  for select to authenticated using ((select public.is_member()));
create policy app_settings_insert_admin on public.app_settings
  for insert to authenticated with check ((select public.is_admin()));
create policy app_settings_update_admin on public.app_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy app_settings_delete_admin on public.app_settings
  for delete to authenticated using ((select public.is_admin()));

-- Tasks: every active member reads (deleted rows too, so that a deletion reaches every device),
-- creates a task under their own name, and edits any task.
create policy tasks_select_members on public.tasks
  for select to authenticated using ((select public.is_member()));
create policy tasks_insert_members on public.tasks
  for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy tasks_update_members on public.tasks
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));

-- Attachments: members read and add (under their own name); the person who added one, or an
-- administrator, removes it.
create policy attachments_select_members on public.attachments
  for select to authenticated using ((select public.is_member()));
create policy attachments_insert_members on public.attachments
  for insert to authenticated
  with check ((select public.is_member()) and uploaded_by = (select auth.uid()));
create policy attachments_delete_uploader_or_admin on public.attachments
  for delete to authenticated
  using ((select public.is_member()) and (uploaded_by = (select auth.uid()) or (select public.is_admin())));

create policy task_events_select_members on public.task_events
  for select to authenticated using ((select public.is_member()));

-- The private bucket for the pictures: JPEG only, 5 MB at most (the app shrinks them first).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 5 * 1024 * 1024, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Active members read and add files in that bucket; the uploader or an administrator deletes one;
-- nobody overwrites one.
create policy task_files_select_members on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files' and (select public.is_member()));
create policy task_files_insert_members on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-files' and (select public.is_member()));
create policy task_files_delete_uploader_or_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'task-files'
    and (select public.is_member())
    and (owner_id = (select auth.uid())::text or (select public.is_admin()))
  );

-- Realtime: the tables whose changes every open app has to hear about. Where there is no realtime
-- publication nothing happens.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array['tasks', 'statuses', 'app_settings', 'profiles'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

-- The only two things a user may change about their own profile. Nobody can write to profiles
-- directly, so nobody can make themselves an administrator or switch themselves back on.
create function public.update_my_profile(p_display_name text, p_default_remind_min integer)
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
  if p_default_remind_min is null or p_default_remind_min < 0 then
    raise exception 'the default reminder cannot be negative or missing' using errcode = '22023';
  end if;
  -- A name that a colleague already has raises the unique violation of profiles_display_name_key.
  update public.profiles
     set display_name = v_name, default_remind_min = p_default_remind_min
   where id = (select auth.uid());
end;
$$;

-- Called after the user has chosen a new password of their own.
create function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    raise exception 'only an active member can change their profile' using errcode = '42501';
  end if;
  update public.profiles set must_change_password = false where id = (select auth.uid());
end;
$$;

revoke all on function public.update_my_profile(text, integer) from public, anon;
revoke all on function public.clear_must_change_password() from public, anon;
grant execute on function public.update_my_profile(text, integer) to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
