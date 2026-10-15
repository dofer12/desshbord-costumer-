// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_SHIP_METHODS, PRIORITIES, TASK_KINDS, newTask } from '../../src/features/tasks/model'
import { addUser, createDb } from './helpers/pg'

// The task type of the app is written by hand, so these tests hold it against the real table.

describe('the task model and the tasks table', () => {
  it('have the same columns', async () => {
    const db = await createDb()
    const r = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks' order by column_name`,
    )
    expect(Object.keys(newTask('user', 'task')).sort()).toEqual(r.rows.map((c) => c.column_name))
  })

  it('start from the same values', async () => {
    const db = await createDb()
    const owner = await addUser(db, 'owner@example.com')
    const id = crypto.randomUUID()
    // The Glassix rule makes the plain default invalid on purpose, so the tick is set here.
    const r = await db.query<Record<string, unknown>>(
      'insert into public.tasks (id, created_by, no_glassix) values ($1, $2, true) returning *',
      [id, owner],
    )
    const row = r.rows[0]
    const model: Record<string, unknown> = { ...newTask(owner, id) }
    // The server stamps the times itself.
    for (const column of Object.keys(model).filter((k) => !['created_at', 'updated_at', 'no_glassix'].includes(k))) {
      expect(row[column], column).toEqual(model[column])
    }
  })

  it('accept the same kinds and priorities', async () => {
    const db = await createDb()
    const owner = await addUser(db, 'owner@example.com')
    for (const kind of TASK_KINDS) {
      await db.query('insert into public.tasks (created_by, kind, no_glassix) values ($1, $2, true)', [owner, kind])
    }
    for (const priority of PRIORITIES) {
      await db.query('insert into public.tasks (created_by, priority, no_glassix) values ($1, $2, true)', [owner, priority])
    }
  })

  it('offer the shipping methods that the settings start with', async () => {
    const db = await createDb()
    const r = await db.query(`select value from public.app_settings where key = 'ship_methods'`)
    expect(r.rows[0]).toEqual({ value: [...DEFAULT_SHIP_METHODS] })
  })
})
