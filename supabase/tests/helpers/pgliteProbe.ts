import type { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { classifyDb, type DbOp, type Member, type Probe, type Result, type Row, type StorageOp, type Who, type World } from '../security-check'
import { addUser, as, type Actor } from './pg'

// The live check of the permissions (security-check.ts) asks a Probe for everything it does. This
// probe is a Postgres in memory with the real migrations on it, so that the same cells, with the same
// expectations, run in the tests. What Supabase does around Postgres is stood in for by the few lines
// below, and says so where it does:
//   - Storage: the limits of the bucket (the kinds of file, the size) are checked here, as the Storage
//     service does before it writes a row to storage.objects, whose policies are then the real ones.
//   - Realtime: a change reaches a person when the table is in the publication and the person can read
//     the row, which is the rule that the Realtime service applies.
//   - Sign-up and the length of a password are settings of the Auth service, which this does not have.

const BUCKET = 'task-files'
const MARK = 'security-check'

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`not a name: ${name}`)
  return `"${name}"`
}

/** A value for a query: an object goes in as JSON, which is what a jsonb column takes. */
const value = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v)

function conditions(match: Row, from: number): { sql: string; values: unknown[] } {
  const keys = Object.keys(match)
  return { sql: keys.map((key, i) => `${ident(key)} = $${from + i}`).join(' and '), values: keys.map((key) => value(match[key])) }
}

const ok = (rows: Row[]): Result => ({ kind: 'ok', rows: rows.length, data: rows })

async function runDb(db: PGlite, op: DbOp): Promise<Result> {
  switch (op.op) {
    case 'select': {
      const where = op.match ? conditions(op.match, 1) : null
      const columns = op.columns ? op.columns.split(',').map((column) => ident(column.trim())).join(', ') : '*'
      const r = await db.query<Row>(`select ${columns} from public.${ident(op.table)}${where ? ` where ${where.sql}` : ''} limit 1000`, where?.values ?? [])
      return ok(r.rows)
    }
    // The writes do not ask for the rows back (no RETURNING), as the app does not: asking would make
    // the person pass the read policy as well, which would hide a mistake in the write policy.
    case 'insert':
    case 'upsert': {
      const keys = Object.keys(op.row)
      const upsert =
        op.op === 'upsert'
          ? ` on conflict (id) do update set ${keys.filter((key) => key !== 'id').map((key) => `${ident(key)} = excluded.${ident(key)}`).join(', ')}`
          : ''
      const r = await db.query(
        `insert into public.${ident(op.table)} (${keys.map((key) => ident(key)).join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})${upsert}`,
        keys.map((key) => value(op.row[key])),
      )
      return { kind: 'ok', rows: r.affectedRows ?? 0 }
    }
    case 'update': {
      const keys = Object.keys(op.patch)
      const where = conditions(op.match, keys.length + 1)
      const r = await db.query(
        `update public.${ident(op.table)} set ${keys.map((key, i) => `${ident(key)} = $${i + 1}`).join(', ')} where ${where.sql}`,
        [...keys.map((key) => value(op.patch[key])), ...where.values],
      )
      return { kind: 'ok', rows: r.affectedRows ?? 0 }
    }
    case 'delete': {
      const where = conditions(op.match, 1)
      const r = await db.query(`delete from public.${ident(op.table)} where ${where.sql}`, where.values)
      return { kind: 'ok', rows: r.affectedRows ?? 0 }
    }
    case 'rpc': {
      const keys = Object.keys(op.args)
      await db.query(`select public.${ident(op.fn)}(${keys.map((key, i) => `${ident(key)} => $${i + 1}`).join(', ')})`, keys.map((key) => value(op.args[key])))
      return { kind: 'ok', rows: 1 }
    }
  }
}

/** A probe over a database that has the migrations on it. The users are made by `setup`. */
export function createPgliteProbe(db: PGlite): Probe {
  const ids = {} as Record<Member, string>
  let counter = 0

  const actorOf = (who: Who): Actor => (who === 'anon' ? 'anon' : { id: ids[who] })
  const fresh = (prefix: string) => `${MARK}-${prefix}-${++counter}`

  async function storage(who: Who, op: StorageOp): Promise<Result> {
    try {
      const actor = actorOf(who)
      switch (op.op) {
        case 'upload': {
          const bucket = (
            await db.query<{ file_size_limit: string | null; allowed_mime_types: string[] | null }>(
              'select file_size_limit, allowed_mime_types from storage.buckets where id = $1',
              [BUCKET],
            )
          ).rows[0]
          if (!bucket) return { kind: 'error', message: 'Bucket not found' }
          if (bucket.allowed_mime_types && !bucket.allowed_mime_types.includes(op.type)) {
            return { kind: 'refused', message: `mime type ${op.type} is not supported` }
          }
          if (bucket.file_size_limit !== null && op.bytes > Number(bucket.file_size_limit)) {
            return { kind: 'refused', message: 'The object exceeded the maximum allowed size' }
          }
          const exists = (await db.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [BUCKET, op.path])).rows.length > 0
          return await as(db, actor, async () => {
            if (exists && !op.overwrite) return { kind: 'error', message: 'The resource already exists' } as Result
            if (exists) {
              // Overwriting a file is an update of its row, for which the bucket must have a policy.
              const r = await db.query('update storage.objects set name = name where bucket_id = $1 and name = $2 returning id', [BUCKET, op.path])
              return r.rows.length > 0 ? ({ kind: 'ok', rows: 1 } as Result) : ({ kind: 'refused', message: 'new row violates row-level security policy' } as Result)
            }
            await db.query('insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, auth.uid()::text)', [BUCKET, op.path])
            return { kind: 'ok', rows: 1 } as Result
          })
        }
        case 'sign': {
          const r = await as(db, actor, () => db.query('select id from storage.objects where bucket_id = $1 and name = $2', [BUCKET, op.path]))
          return r.rows.length > 0 ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: 'Object not found' }
        }
        case 'public': {
          // The public address of a file works for anybody when the bucket is public, and for nobody when it is not.
          const r = await db.query<{ public: boolean }>('select public from storage.buckets where id = $1', [BUCKET])
          return r.rows[0]?.public ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: 'Bucket not found' }
        }
        case 'remove': {
          const r = await as(db, actor, () => db.query('delete from storage.objects where bucket_id = $1 and name = $2 returning id', [BUCKET, op.path]))
          return { kind: 'ok', rows: r.rows.length }
        }
      }
    } catch (error) {
      return classifyDb(error as { code?: string; message?: string })
    }
  }

  return {
    async setup(): Promise<World> {
      ids.admin = await addUser(db, 'admin@example.com', { appMeta: { role: 'admin' } })
      ids.employee = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
      ids.colleague = await addUser(db, 'avi@example.com', { appMeta: { role: 'employee' } })
      ids.inactive = await addUser(db, 'old@example.com', { appMeta: { role: 'employee' } })
      await db.query('update public.profiles set is_active = false where id = $1', [ids.inactive])

      // The rows to try are written as the owner of the database, as a migration would.
      const newTask = async (by: Member, deleted = false): Promise<string> => {
        const r = await db.query<{ id: string }>(
          'insert into public.tasks (created_by, no_glassix, title, deleted_at) values ($1, true, $2, case when $3::boolean then now() end) returning id',
          [ids[by], MARK, deleted],
        )
        return r.rows[0].id
      }
      const newAttachment = async (by: Member): Promise<string> => {
        const r = await db.query<{ id: string }>(
          "insert into public.attachments (task_id, storage_path, kind, uploaded_by) values ($1, $2, 'image', $3) returning id",
          [task, `${MARK}/${randomUUID()}.jpg`, ids[by]],
        )
        return r.rows[0].id
      }
      const task = await newTask('employee')
      const deletedTask = await newTask('admin', true)
      await newAttachment('employee')

      return {
        ids,
        mark: MARK,
        task,
        deletedTask,
        newTask: (by) => newTask(by),
        newAttachment,
        async newFile(by) {
          const path = `${task}/${randomUUID()}.jpg`
          const made = await storage(by, { op: 'upload', path, type: 'image/jpeg', bytes: 64 })
          if (made.kind !== 'ok') throw new Error(`could not upload a file as the ${by}`)
          return path
        },
        async newSetting(table) {
          const key = fresh(table)
          if (table === 'statuses') {
            await db.query("insert into public.statuses (key, name_he, color, sort) values ($1, $1, '#336699', 999)", [key])
          } else {
            await db.query(`insert into public.app_settings (key, value) values ($1, '{"check": true}'::jsonb)`, [key])
          }
          return key
        },
        fresh,
      }
    },

    async cleanup() {
      // The database goes away with the test.
      return []
    },

    async db(who, op) {
      try {
        return await as(db, actorOf(who), () => runDb(db, op))
      } catch (error) {
        return classifyDb(error as { code?: string; message?: string })
      }
    },

    storage,

    async realtime(who, taskId) {
      try {
        const published = await db.query(
          "select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'",
        )
        if (published.rows.length === 0) return { kind: 'refused', message: 'the table tasks is not in the realtime publication' }
        const visible = await as(db, actorOf(who), () => db.query('select 1 from public.tasks where id = $1', [taskId]))
        return visible.rows.length > 0 ? { kind: 'ok', rows: 1 } : { kind: 'refused', message: 'the person cannot read the task' }
      } catch (error) {
        return classifyDb(error as { code?: string; message?: string })
      }
    },

    async signUp() {
      return { kind: 'skipped', why: 'a setting of the Auth service of a real project' }
    },

    async weakPassword() {
      return { kind: 'skipped', why: 'a setting of the Auth service of a real project' }
    },
  }
}
