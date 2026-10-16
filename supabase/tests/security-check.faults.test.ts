// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createDb } from './helpers/pg'
import { createPgliteProbe } from './helpers/pgliteProbe'
import { passed, runChecks } from './security-check'

// The proof that the cells of the live check have teeth: each of these breaks one permission of the
// migrations, as a mistake in a later migration or in the dashboard would, and the check must fail
// exactly the cells that are about it. A cell that never fails on a mistake would be a lock painted on.

const FAULTS: Array<{ name: string; sql: string; fails: string[] }> = [
  {
    name: 'anybody can delete a task',
    sql: `grant delete on public.tasks to authenticated;
          create policy tasks_delete_any on public.tasks for delete to authenticated using (true);`,
    fails: ['tasks · delete as the administrator', 'tasks · delete as the employee', 'tasks · delete as a colleague', 'tasks · delete as a deactivated member'],
  },
  {
    name: 'a visitor can read the tasks',
    sql: `grant select on public.tasks to anon;
          create policy tasks_anon_read on public.tasks for select to anon using (true);`,
    fails: ['tasks · read as a visitor', 'realtime · a change of a task does not reach a visitor'],
  },
  {
    name: 'a deactivated member can read the tasks',
    sql: `drop policy tasks_select_members on public.tasks;
          create policy tasks_select_members on public.tasks for select to authenticated using (true);`,
    fails: ['tasks · read as a deactivated member', 'realtime · a change of a task does not reach a deactivated member'],
  },
  {
    name: 'row level security is off for the tasks',
    sql: 'alter table public.tasks disable row level security;',
    fails: [
      'tasks · read as a deactivated member',
      'tasks · create as the employee under the name of the administrator',
      'tasks · create as a deactivated member',
      'tasks · edit as a deactivated member',
      'tasks · send a change as a deactivated member',
      'realtime · a change of a task does not reach a deactivated member',
    ],
  },
  {
    name: 'a task can be made in the name of somebody else',
    sql: `drop policy tasks_insert_members on public.tasks;
          create policy tasks_insert_members on public.tasks for insert to authenticated with check ((select public.is_member()));`,
    fails: ['tasks · create as the employee under the name of the administrator'],
  },
  {
    name: 'a deactivated member can make a task',
    sql: `drop policy tasks_insert_members on public.tasks;
          create policy tasks_insert_members on public.tasks for insert to authenticated with check (created_by = (select auth.uid()));`,
    fails: ['tasks · create as a deactivated member'],
  },
  {
    name: 'the author of a task can be changed by an edit',
    sql: 'drop trigger tasks_touch on public.tasks;',
    fails: ['tasks · the author cannot be changed by an edit'],
  },
  {
    // A policy "for all" also opens the reading, which is why a deactivated member is caught here too.
    name: 'every signed-in user can read and write the history',
    sql: `grant insert, update, delete on public.task_events to authenticated;
          create policy task_events_any on public.task_events for all to authenticated using (true) with check (true);`,
    fails: [
      'task_events · read as a deactivated member',
      'task_events · write as the administrator',
      'task_events · change as the administrator',
      'task_events · delete as the administrator',
      'task_events · write as the employee',
      'task_events · change as the employee',
      'task_events · delete as the employee',
    ],
  },
  {
    name: 'members can write the history',
    sql: `grant insert, update, delete on public.task_events to authenticated;
          create policy task_events_insert on public.task_events for insert to authenticated with check ((select public.is_member()));
          create policy task_events_update on public.task_events for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
          create policy task_events_delete on public.task_events for delete to authenticated using ((select public.is_member()));`,
    fails: [
      'task_events · write as the administrator',
      'task_events · change as the administrator',
      'task_events · delete as the administrator',
      'task_events · write as the employee',
      'task_events · change as the employee',
      'task_events · delete as the employee',
    ],
  },
  {
    name: 'an attachment can be added in the name of somebody else, or of nobody',
    sql: `drop policy attachments_insert_members on public.attachments;
          create policy attachments_insert_members on public.attachments for insert to authenticated with check ((select public.is_member()));`,
    fails: ['attachments · add as the employee under the name of somebody else', 'attachments · add as the employee under no name'],
  },
  {
    name: 'a deactivated member can add an attachment',
    sql: `drop policy attachments_insert_members on public.attachments;
          create policy attachments_insert_members on public.attachments for insert to authenticated with check (uploaded_by = (select auth.uid()));`,
    fails: ['attachments · add as a deactivated member'],
  },
  {
    name: 'an employee can change the statuses',
    sql: 'create policy statuses_any_update on public.statuses for update to authenticated using (true) with check (true);',
    fails: ['statuses · change as the employee'],
  },
  {
    name: 'an employee can add a status',
    sql: 'create policy statuses_any_insert on public.statuses for insert to authenticated with check (true);',
    fails: ['statuses · add as the employee'],
  },
  {
    name: 'an employee can delete a setting',
    sql: 'create policy app_settings_any_delete on public.app_settings for delete to authenticated using (true);',
    fails: ['app_settings · delete as the employee'],
  },
  {
    name: 'a visitor can read the profiles',
    sql: `grant select on public.profiles to anon;
          create policy profiles_anon_read on public.profiles for select to anon using (true);`,
    fails: ['profiles · read as a visitor'],
  },
  {
    name: 'anybody can write to the profiles, so that anybody can make themselves an administrator',
    sql: `grant update on public.profiles to authenticated;
          create policy profiles_any_update on public.profiles for update to authenticated using (true) with check (true);`,
    fails: ['profiles · an employee cannot make themselves an administrator', 'profiles · an administrator cannot change the role of a colleague directly'],
  },
  {
    // A deactivated member is not caught here, and need not be: to delete a row they must be able to
    // see it, and the policy that reads the bucket does not show it to them.
    name: 'a member can delete the files of others',
    sql: `drop policy task_files_delete_uploader_or_admin on storage.objects;
          create policy task_files_delete_any on storage.objects for delete to authenticated using (bucket_id = 'task-files');`,
    fails: ['storage · delete a file as a colleague who did not upload it'],
  },
  {
    name: 'a deactivated member can see and delete the files',
    sql: `drop policy task_files_select_members on storage.objects;
          create policy task_files_select_any on storage.objects for select to authenticated using (bucket_id = 'task-files');
          drop policy task_files_delete_uploader_or_admin on storage.objects;
          create policy task_files_delete_any on storage.objects for delete to authenticated using (bucket_id = 'task-files');`,
    fails: [
      'storage · open a file as a deactivated member',
      'storage · delete a file as a colleague who did not upload it',
      'storage · delete a file as a deactivated member',
    ],
  },
  {
    name: 'a visitor can open the files',
    sql: "create policy task_files_anon_read on storage.objects for select to anon using (bucket_id = 'task-files');",
    fails: ['storage · open a file as a visitor'],
  },
  {
    name: 'a visitor can upload a file',
    sql: "create policy task_files_anon_insert on storage.objects for insert to anon with check (bucket_id = 'task-files');",
    fails: ['storage · upload a JPEG as a visitor'],
  },
  {
    name: 'a deactivated member can upload a file',
    sql: `drop policy task_files_insert_members on storage.objects;
          create policy task_files_insert_members on storage.objects for insert to authenticated with check (bucket_id = 'task-files');`,
    fails: ['storage · upload a JPEG as a deactivated member'],
  },
  {
    name: 'a file can be overwritten',
    sql: `create policy task_files_update_members on storage.objects for update to authenticated
            using (bucket_id = 'task-files' and (select public.is_member())) with check (bucket_id = 'task-files');`,
    fails: ['storage · overwrite a file'],
  },
  {
    name: 'the bucket takes any kind of file',
    sql: "update storage.buckets set allowed_mime_types = null where id = 'task-files';",
    fails: ['storage · upload what is not a JPEG'],
  },
  {
    name: 'the bucket has no limit on the size of a file',
    sql: "update storage.buckets set file_size_limit = null where id = 'task-files';",
    fails: ['storage · upload a file of more than 5 MB'],
  },
  {
    name: 'the bucket is public',
    sql: "update storage.buckets set public = true where id = 'task-files';",
    fails: ['storage · a file cannot be opened by a public address'],
  },
  {
    name: 'the tasks are not published to the live connection',
    sql: 'alter publication supabase_realtime drop table public.tasks;',
    fails: ['realtime · a change of a task reaches the employee'],
  },
]

describe('a database with a mistake in its permissions', () => {
  it('names every fault in this list once', () => {
    expect(new Set(FAULTS.map((f) => f.name)).size).toBe(FAULTS.length)
  })

  it.each(FAULTS)('is caught: $name', async ({ sql, fails }) => {
    const db = await createDb()
    await db.exec(sql)

    const report = await runChecks(createPgliteProbe(db))

    expect(report.setupError).toBeUndefined()
    expect(report.findings.filter((f) => f.verdict === 'failed').map((f) => f.name).sort()).toEqual([...fails].sort())
    expect(passed(report)).toBe(false)
  })
})
