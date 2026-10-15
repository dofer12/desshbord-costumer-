// @vitest-environment node
import { PGlite, type Results } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, as, createDb, type Actor } from './helpers/pg'

// Who may do what with the tables of 0002_core.sql, tried with real roles: an administrator, two
// employees, a member that an administrator has deactivated, and a visitor who is not signed in.

type Member = { id: string }

let db: PGlite
let admin: Member // the first user: an active administrator
let employee: Member // an active employee, "dana"
let colleague: Member // another active employee, "avi"
let inactive: Member // an employee whom an administrator has deactivated
let task: string // a task that the employee created
let deletedTask: string // a deleted task that the administrator created
let employeeFile: string // an attachment that the employee uploaded
let colleagueFile: string // an attachment that the colleague uploaded
let inactiveFile: string // an attachment that the deactivated member uploaded

const denied = /permission denied/i
const policy = /row-level security/i

beforeEach(async () => {
  db = await createDb()
  admin = { id: await addUser(db, 'admin@example.com') }
  employee = { id: await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } }) }
  colleague = { id: await addUser(db, 'avi@example.com', { appMeta: { role: 'employee' } }) }
  inactive = { id: await addUser(db, 'old@example.com', { appMeta: { role: 'employee' } }) }
  await db.query('update public.profiles set is_active = false where id = $1', [inactive.id])

  // The rows to read, edit and delete are written as the owner of the database, as a migration would.
  task = await insertTask(employee.id, false)
  deletedTask = await insertTask(admin.id, true)
  employeeFile = await insertAttachment(task, employee.id)
  colleagueFile = await insertAttachment(task, colleague.id)
  inactiveFile = await insertAttachment(task, inactive.id)
})

async function insertTask(createdBy: string, deleted: boolean) {
  const r = await db.query<{ id: string }>(
    `insert into public.tasks (created_by, no_glassix, deleted_at)
     values ($1, true, case when $2::boolean then now() end) returning id`,
    [createdBy, deleted],
  )
  return r.rows[0].id
}

async function insertAttachment(taskId: string, uploadedBy: string) {
  const r = await db.query<{ id: string }>(
    `insert into public.attachments (task_id, storage_path, kind, uploaded_by)
     values ($1, $2, 'image', $3) returning id`,
    [taskId, `${taskId}/${crypto.randomUUID()}.jpg`, uploadedBy],
  )
  return r.rows[0].id
}

/** Runs one statement with the permissions of the given actor. */
function run(actor: Actor, sql: string, params: unknown[] = []): Promise<Results<Record<string, unknown>>> {
  return as(db, actor, () => db.query<Record<string, unknown>>(sql, params))
}

/** How many rows of a table the actor can see. */
async function count(actor: Actor, table: string): Promise<number> {
  const r = await run(actor, `select count(*)::int as n from ${table}`)
  return r.rows[0].n as number
}

describe('tasks', () => {
  const create = 'insert into public.tasks (id, created_by, no_glassix) values ($1, $2, true)'
  const edit = 'update public.tasks set title = $2 where id = $1'

  it('can be read by every active member, deleted ones included, and by nobody else', async () => {
    expect(await count(admin, 'public.tasks')).toBe(2)
    expect(await count(employee, 'public.tasks')).toBe(2)
    expect(await count(inactive, 'public.tasks')).toBe(0)
    await expect(count('anon', 'public.tasks')).rejects.toThrow(denied)
  })

  it('can be created by a member as themselves, never in the name of somebody else', async () => {
    await run(employee, create, [crypto.randomUUID(), employee.id])
    await expect(run(employee, create, [crypto.randomUUID(), admin.id])).rejects.toThrow(policy)
  })

  it('takes the author from the caller when the app does not send one', async () => {
    const id = crypto.randomUUID()
    await run(employee, 'insert into public.tasks (id, no_glassix) values ($1, true)', [id])
    const r = await db.query('select created_by from public.tasks where id = $1', [id])
    expect(r.rows[0]).toEqual({ created_by: employee.id })
  })

  it('cannot be created by a deactivated member or by a visitor', async () => {
    await expect(run(inactive, create, [crypto.randomUUID(), inactive.id])).rejects.toThrow(policy)
    await expect(run('anon', create, [crypto.randomUUID(), employee.id])).rejects.toThrow(denied)
  })

  it('can be edited by any active member, deleted ones included, and by nobody else', async () => {
    expect((await run(employee, edit, [task, 'by dana'])).affectedRows).toBe(1)
    expect((await run(colleague, edit, [task, 'by avi'])).affectedRows).toBe(1)
    expect((await run(colleague, edit, [deletedTask, 'back again'])).affectedRows).toBe(1)
    expect((await run(inactive, edit, [task, 'no'])).affectedRows).toBe(0)
    await expect(run('anon', edit, [task, 'no'])).rejects.toThrow(denied)
  })

  it('accepts the same upsert twice, which is what a resent change is, and refuses it from a deactivated member', async () => {
    const upsert = `insert into public.tasks (id, title, no_glassix) values ($1, $2, true)
                    on conflict (id) do update set title = excluded.title`
    const id = crypto.randomUUID()
    await run(employee, upsert, [id, 'first'])
    await run(employee, upsert, [id, 'second'])
    const r = await db.query('select title from public.tasks where id = $1', [id])
    expect(r.rows).toEqual([{ title: 'second' }])
    await expect(run(inactive, upsert, [id, 'no'])).rejects.toThrow(policy)
  })

  it('can be deleted by nobody, administrators included', async () => {
    for (const actor of [admin, employee, colleague, 'anon' as const]) {
      await expect(run(actor, 'delete from public.tasks where id = $1', [task])).rejects.toThrow(denied)
    }
  })
})

describe('attachments', () => {
  const add = 'insert into public.attachments (task_id, storage_path, kind, uploaded_by) values ($1, $2, $3, $4)'
  const remove = 'delete from public.attachments where id = $1'

  it('can be read by every active member and by nobody else', async () => {
    expect(await count(admin, 'public.attachments')).toBe(3)
    expect(await count(employee, 'public.attachments')).toBe(3)
    expect(await count(inactive, 'public.attachments')).toBe(0)
    await expect(count('anon', 'public.attachments')).rejects.toThrow(denied)
  })

  it('can be added by a member under their own name and under no other', async () => {
    await run(employee, add, [task, 'a.jpg', 'image', employee.id])
    await expect(run(employee, add, [task, 'b.jpg', 'image', admin.id])).rejects.toThrow(policy)
    await expect(run(employee, add, [task, 'c.jpg', 'image', null])).rejects.toThrow(policy)
    await run(employee, 'insert into public.attachments (task_id, storage_path, kind) values ($1, $2, $3)', [task, 'd.jpg', 'image'])
    const r = await db.query(`select uploaded_by from public.attachments where storage_path = 'd.jpg'`)
    expect(r.rows[0]).toEqual({ uploaded_by: employee.id })
  })

  it('cannot be added by a deactivated member or by a visitor', async () => {
    await expect(run(inactive, add, [task, 'e.jpg', 'image', inactive.id])).rejects.toThrow(policy)
    await expect(run('anon', add, [task, 'f.jpg', 'image', employee.id])).rejects.toThrow(denied)
  })

  it('can be removed by the person who added it or by an administrator, and by nobody else', async () => {
    expect((await run(colleague, remove, [employeeFile])).affectedRows).toBe(0)
    expect((await run(inactive, remove, [inactiveFile])).affectedRows).toBe(0)
    expect((await run(employee, remove, [employeeFile])).affectedRows).toBe(1)
    expect((await run(admin, remove, [colleagueFile])).affectedRows).toBe(1)
    await expect(run('anon', remove, [inactiveFile])).rejects.toThrow(denied)
  })

  it('cannot be changed once added', async () => {
    await expect(run(employee, `update public.attachments set kind = 'product' where id = $1`, [employeeFile])).rejects.toThrow(denied)
  })
})

describe('the history of a task', () => {
  it('can be read by every active member and by nobody else', async () => {
    expect(await count(admin, 'public.task_events')).toBeGreaterThan(0)
    expect(await count(employee, 'public.task_events')).toBeGreaterThan(0)
    expect(await count(inactive, 'public.task_events')).toBe(0)
    await expect(count('anon', 'public.task_events')).rejects.toThrow(denied)
  })

  it('can be written by nobody, only by the triggers that watch the tasks', async () => {
    for (const actor of [admin, employee]) {
      await expect(run(actor, `insert into public.task_events (task_id, type) values ($1, 'updated')`, [task])).rejects.toThrow(denied)
      await expect(run(actor, `update public.task_events set type = 'deleted'`)).rejects.toThrow(denied)
      await expect(run(actor, 'delete from public.task_events')).rejects.toThrow(denied)
    }
  })

  it('still records what a member does, although the member cannot write to it', async () => {
    await run(employee, `update public.tasks set title = 'edited' where id = $1`, [task])
    const r = await db.query(`select type, actor_id from public.task_events where task_id = $1 and type = 'updated'`, [task])
    expect(r.rows).toEqual([{ type: 'updated', actor_id: employee.id }])
  })
})

describe.each([
  {
    table: 'public.statuses',
    insert: `insert into public.statuses (key, name_he, color, sort) values ('extra', 'נוסף', '#000000', 99)`,
    change: `update public.statuses set name_he = 'שונה' where key = 'abroad'`,
    remove: `delete from public.statuses where key = 'abroad'`,
  },
  {
    table: 'public.app_settings',
    insert: `insert into public.app_settings (key, value) values ('extra', '1'::jsonb)`,
    change: `update public.app_settings set value = '"https://example.com/{id}"'::jsonb where key = 'glassix_url_template'`,
    remove: `delete from public.app_settings where key = 'last_backup_at'`,
  },
])('$table', ({ table, insert, change, remove }) => {
  it('can be read by every active member and by nobody else', async () => {
    expect(await count(admin, table)).toBeGreaterThan(0)
    expect(await count(employee, table)).toBeGreaterThan(0)
    expect(await count(inactive, table)).toBe(0)
    await expect(count('anon', table)).rejects.toThrow(denied)
  })

  it('can be changed by an administrator and by nobody else', async () => {
    await expect(run(employee, insert)).rejects.toThrow(policy)
    expect((await run(employee, change)).affectedRows).toBe(0)
    expect((await run(employee, remove)).affectedRows).toBe(0)
    await expect(run(inactive, insert)).rejects.toThrow(policy)
    expect((await run(inactive, change)).affectedRows).toBe(0)
    await expect(run('anon', insert)).rejects.toThrow(denied)

    await run(admin, insert)
    expect((await run(admin, change)).affectedRows).toBe(1)
    expect((await run(admin, remove)).affectedRows).toBe(1)
  })
})

describe('statuses in use', () => {
  it('cannot be deleted, not even by an administrator', async () => {
    await expect(run(admin, `delete from public.statuses where key = 'processing'`)).rejects.toThrow(/foreign key/i)
  })
})

describe('profiles', () => {
  const call = (actor: Actor, name: string | null, reminder: number | null) =>
    run(actor, 'select public.update_my_profile($1, $2)', [name, reminder])
  const profile = async (id: string) => {
    const r = await db.query('select display_name, default_remind_min from public.profiles where id = $1', [id])
    return r.rows[0]
  }

  it('cannot be changed, created or deleted directly, so nobody can promote themselves', async () => {
    await expect(run(employee, `update public.profiles set role = 'admin' where id = $1`, [employee.id])).rejects.toThrow(denied)
    await expect(run(employee, `update public.profiles set is_active = false where id = $1`, [colleague.id])).rejects.toThrow(denied)
    await expect(run(admin, `update public.profiles set role = 'employee' where id = $1`, [admin.id])).rejects.toThrow(denied)
    await expect(run(employee, 'delete from public.profiles')).rejects.toThrow(denied)
    await expect(run(employee, `insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')`)).rejects.toThrow(denied)
  })

  describe('update_my_profile', () => {
    it('changes the name and the default reminder of the caller, and only theirs', async () => {
      const before = await profile(colleague.id)
      await call(employee, 'Dana L', 30)
      expect(await profile(employee.id)).toEqual({ display_name: 'Dana L', default_remind_min: 30 })
      expect(await profile(colleague.id)).toEqual(before)
    })

    it('trims the name, accepts a reminder of zero and accepts the name the caller already has', async () => {
      await call(employee, '  Dana L  ', 0)
      expect(await profile(employee.id)).toEqual({ display_name: 'Dana L', default_remind_min: 0 })
      await call(employee, 'dana l', 5)
      expect(await profile(employee.id)).toEqual({ display_name: 'dana l', default_remind_min: 5 })
    })

    it('refuses an empty or blank name and a negative or missing reminder', async () => {
      await expect(call(employee, '', 15)).rejects.toThrow(/display name/i)
      await expect(call(employee, '   ', 15)).rejects.toThrow(/display name/i)
      await expect(call(employee, null, 15)).rejects.toThrow(/display name/i)
      await expect(call(employee, 'Dana', -1)).rejects.toThrow(/reminder/i)
      await expect(call(employee, 'Dana', null)).rejects.toThrow(/reminder/i)
    })

    it('reports a name that a colleague already has, whatever the case', async () => {
      await expect(call(employee, 'AVI', 15)).rejects.toThrow(/profiles_display_name_key|duplicate key/i)
    })

    it('is for active members only', async () => {
      await expect(call(inactive, 'Back', 15)).rejects.toThrow(/active member/i)
      await expect(call('anon', 'Anon', 15)).rejects.toThrow(denied)
    })
  })

  describe('clear_must_change_password', () => {
    it('clears the flag of the caller and nobody else’s', async () => {
      await run(employee, 'select public.clear_must_change_password()')
      const r = await db.query<{ id: string; must_change_password: boolean }>('select id, must_change_password from public.profiles')
      const flags = Object.fromEntries(r.rows.map((p) => [p.id, p.must_change_password]))
      expect(flags[employee.id]).toBe(false)
      expect(flags[colleague.id]).toBe(true)
    })

    it('is for active members only', async () => {
      await expect(run(inactive, 'select public.clear_must_change_password()')).rejects.toThrow(/active member/i)
      await expect(run('anon', 'select public.clear_must_change_password()')).rejects.toThrow(denied)
    })
  })
})

describe('the task-files bucket', () => {
  const put = 'insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)'
  const names = async (actor: Actor) => (await run(actor, 'select name from storage.objects order by name')).rows.map((r) => r.name)

  beforeEach(async () => {
    await db.query(`insert into storage.buckets (id, name) values ('other', 'other')`)
    await db.query(
      `insert into storage.objects (bucket_id, name, owner_id)
       values ('task-files', 'a/mine.jpg', $1), ('task-files', 'a/theirs.jpg', $2), ('other', 'b/x.jpg', $1)`,
      [employee.id, colleague.id],
    )
  })

  it('is private, takes only JPEG files and none above 5 MB', async () => {
    const r = await db.query(`select public, file_size_limit::int as file_size_limit, allowed_mime_types from storage.buckets where id = 'task-files'`)
    expect(r.rows).toEqual([{ public: false, file_size_limit: 5 * 1024 * 1024, allowed_mime_types: ['image/jpeg'] }])
  })

  it('can be read by active members, in that bucket only, and by nobody else', async () => {
    expect(await names(employee)).toEqual(['a/mine.jpg', 'a/theirs.jpg'])
    expect(await names(admin)).toEqual(['a/mine.jpg', 'a/theirs.jpg'])
    expect(await names(inactive)).toEqual([])
    expect(await names('anon')).toEqual([])
  })

  it('can be added to by active members, in that bucket only', async () => {
    await run(employee, put, ['task-files', 'a/new.jpg', employee.id])
    await expect(run(employee, put, ['other', 'b/new.jpg', employee.id])).rejects.toThrow(policy)
    await expect(run(inactive, put, ['task-files', 'a/inactive.jpg', inactive.id])).rejects.toThrow(policy)
    await expect(run('anon', put, ['task-files', 'a/anon.jpg', null])).rejects.toThrow(policy)
  })

  it('can be deleted by the person who uploaded the file or by an administrator, and by nobody else', async () => {
    const del = 'delete from storage.objects where name = $1'
    expect((await run(colleague, del, ['a/mine.jpg'])).affectedRows).toBe(0)
    expect((await run(inactive, del, ['a/mine.jpg'])).affectedRows).toBe(0)
    expect((await run(employee, del, ['a/mine.jpg'])).affectedRows).toBe(1)
    expect((await run(admin, del, ['a/theirs.jpg'])).affectedRows).toBe(1)
    expect((await run(admin, del, ['b/x.jpg'])).affectedRows).toBe(0)
  })

  it('cannot be overwritten or renamed', async () => {
    const r = await run(employee, `update storage.objects set name = 'a/renamed.jpg' where name = 'a/mine.jpg'`)
    expect(r.affectedRows).toBe(0)
  })
})

describe('realtime', () => {
  it('publishes the tables whose changes every device has to see', async () => {
    const r = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename`,
    )
    expect(r.rows.map((row) => row.tablename)).toEqual(['app_settings', 'profiles', 'statuses', 'tasks'])
  })

  it('is left alone, without an error, where Realtime does not exist', async () => {
    const bare = await createDb(async (d) => {
      await d.exec('drop publication supabase_realtime')
    })
    const r = await bare.query('select count(*)::int as n from pg_publication')
    expect(r.rows[0]).toEqual({ n: 0 })
  })
})

describe('what the two API roles can reach in the public schema', () => {
  it('gives a visitor no table and no function', async () => {
    const tables = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
          and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
            or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
        order by 1`,
    )
    expect(tables.rows).toEqual([])
    const functions = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    )
    expect(functions.rows).toEqual([])
  })

  it('turns row level security on for every table', async () => {
    const r = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
    )
    expect(r.rows).toEqual([])
  })

  it('lets a signed-in user call only the functions that the app needs, and none of the triggers', async () => {
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    )
    expect(r.rows.map((row) => row.proname)).toEqual(['clear_must_change_password', 'is_admin', 'is_member', 'update_my_profile'])
  })
})
