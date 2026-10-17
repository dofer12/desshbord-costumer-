// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, createDb } from './helpers/pg'

// 0003_admin.sql: the guard that keeps the last active administrator in place, and the end of the
// sessions of a user. The guard is a trigger, so it holds for every route to the table: the app's
// functions, the dashboard, and plain SQL as the superuser (which is what these tests are).

let db: PGlite
let owner: string

beforeEach(async () => {
  db = await createDb()
  // The first user of a project is its administrator.
  owner = await addUser(db, 'owner@example.com')
})

const admin = (email: string) => addUser(db, email, { appMeta: { role: 'admin' } })
const employee = (email: string) => addUser(db, email, { appMeta: { role: 'employee' } })

async function profile(id: string) {
  const r = await db.query<{ role: string; is_active: boolean; display_name: string }>(
    'select role, is_active, display_name from public.profiles where id = $1',
    [id],
  )
  return r.rows[0]
}

const block = (id: string) => db.query('update public.profiles set is_active = false where id = $1', [id])
const demote = (id: string) => db.query(`update public.profiles set role = 'employee' where id = $1`, [id])
const GUARD = /profiles_last_admin/

describe('the last active administrator', () => {
  it('cannot be blocked, and the refusal is a check violation that the function can recognise', async () => {
    await expect(block(owner)).rejects.toMatchObject({ code: '23514', message: expect.stringMatching(GUARD) })
    expect(await profile(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('cannot be demoted to an employee', async () => {
    await expect(demote(owner)).rejects.toThrow(GUARD)
    expect(await profile(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('cannot be blocked and demoted in one change either', async () => {
    await expect(db.query(`update public.profiles set role = 'employee', is_active = false where id = $1`, [owner])).rejects.toThrow(GUARD)
    expect(await profile(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('cannot be deleted, neither as a profile nor with the user behind it', async () => {
    await expect(db.query('delete from public.profiles where id = $1', [owner])).rejects.toThrow(GUARD)
    await expect(db.query('delete from auth.users where id = $1', [owner])).rejects.toThrow(GUARD)
    expect(await profile(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('may be changed in every way that leaves them an active administrator', async () => {
    await db.query(`update public.profiles set display_name = 'המנהל', default_remind_min = 30, must_change_password = true where id = $1`, [owner])
    await db.query(`update public.profiles set role = 'admin', is_active = true where id = $1`, [owner])
    expect(await profile(owner)).toMatchObject({ role: 'admin', is_active: true, display_name: 'המנהל' })
  })
})

describe('with more than one administrator', () => {
  it('lets one of two be demoted, and then refuses to demote the one that is left', async () => {
    const second = await admin('second@example.com')
    await demote(owner)
    expect(await profile(owner)).toMatchObject({ role: 'employee' })
    await expect(demote(second)).rejects.toThrow(GUARD)
    await expect(block(second)).rejects.toThrow(GUARD)
    expect(await profile(second)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('does not count an administrator who is blocked', async () => {
    const second = await admin('second@example.com')
    await block(second)
    await expect(block(owner)).rejects.toThrow(GUARD)
    await expect(demote(owner)).rejects.toThrow(GUARD)
    // The blocked one comes back first, and then the other can go.
    await db.query('update public.profiles set is_active = true where id = $1', [second])
    await block(owner)
    expect(await profile(owner)).toMatchObject({ is_active: false })
  })

  it('does not count an employee as an administrator', async () => {
    await employee('dana@example.com')
    await expect(block(owner)).rejects.toThrow(GUARD)
  })

  it('lets the administrator change places with another in the right order: promote first, then demote', async () => {
    const dana = await employee('dana@example.com')
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [dana])
    await demote(owner)
    expect(await profile(dana)).toMatchObject({ role: 'admin' })
    expect(await profile(owner)).toMatchObject({ role: 'employee' })
  })

  it('lets a blocked administrator be demoted or deleted, because they are not the last one', async () => {
    const second = await admin('second@example.com')
    await block(second)
    await demote(second)
    await db.query('delete from public.profiles where id = $1', [second])
    expect(await profile(second)).toBeUndefined()
  })
})

describe('employees', () => {
  it('can be blocked, unblocked, promoted, renamed and deleted freely', async () => {
    const dana = await employee('dana@example.com')
    await block(dana)
    await db.query('update public.profiles set is_active = true where id = $1', [dana])
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [dana])
    await db.query(`update public.profiles set role = 'employee', display_name = 'דנה' where id = $1`, [dana])
    expect(await profile(dana)).toMatchObject({ role: 'employee', display_name: 'דנה' })
    await db.query('delete from public.profiles where id = $1', [dana])
    expect(await profile(dana)).toBeUndefined()
  })
})

describe('revoke_user_sessions', () => {
  async function sessionsOf(id: string) {
    const r = await db.query<{ n: number }>('select count(*)::int as n from auth.sessions where user_id = $1', [id])
    return r.rows[0].n
  }

  it('ends the sessions of the user it is given and leaves the sessions of everybody else', async () => {
    const dana = await employee('dana@example.com')
    await db.query('insert into auth.sessions (user_id) values ($1), ($1), ($2)', [dana, owner])
    expect(await sessionsOf(dana)).toBe(2)

    await db.query('select public.revoke_user_sessions($1)', [dana])

    expect(await sessionsOf(dana)).toBe(0)
    expect(await sessionsOf(owner)).toBe(1)
  })

  it('does nothing, and does not fail, for a user with no sessions or one that does not exist', async () => {
    await db.query('insert into auth.sessions (user_id) values ($1)', [owner])
    await db.query('select public.revoke_user_sessions($1)', ['00000000-0000-0000-0000-000000000000'])
    await db.query('select public.revoke_user_sessions($1)', [await employee('dana@example.com')])
    expect(await sessionsOf(owner)).toBe(1)
  })

  it('is for the service role alone: neither anon nor an app user may call it', async () => {
    const can = async (role: string) => {
      const r = await db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.revoke_user_sessions(uuid)', 'execute') as ok`, [role])
      return r.rows[0].ok
    }
    expect(await can('anon')).toBe(false)
    expect(await can('authenticated')).toBe(false)
    expect(await can('service_role')).toBe(true)
  })
})

describe('the text of the migration', () => {
  // PGlite is one connection, so two administrators acting at the same moment cannot be tried here.
  // What can be pinned is that the guard takes a lock before it looks, so that the second change
  // waits for the first and sees its result.
  it('takes an advisory lock before the guard looks for another administrator', () => {
    const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '0003_admin.sql'), 'utf8')
    const lock = sql.indexOf('pg_advisory_xact_lock')
    const look = sql.indexOf('not exists')
    expect(lock).toBeGreaterThan(-1)
    expect(look).toBeGreaterThan(lock)
  })
})
