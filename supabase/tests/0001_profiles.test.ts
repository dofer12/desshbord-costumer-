// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { addUser, as, createDb } from './helpers/pg'

let db: PGlite

beforeEach(async () => {
  db = await createDb()
})

async function profileOf(id: string) {
  const r = await db.query('select * from public.profiles where id = $1', [id])
  return r.rows[0] as Record<string, unknown> | undefined
}

describe('handle_new_user', () => {
  it('makes the very first user an admin without a forced password change', async () => {
    const id = await addUser(db, 'owner@example.com')
    expect(await profileOf(id)).toMatchObject({
      email: 'owner@example.com',
      display_name: 'owner',
      role: 'admin',
      is_active: true,
      must_change_password: false,
    })
  })

  it('makes later users employees who must change their password', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'dana@example.com', { meta: { display_name: ' דנה ' } })
    expect(await profileOf(id)).toMatchObject({
      display_name: 'דנה',
      role: 'employee',
      must_change_password: true,
    })
  })

  it('honours app_metadata.role for later users and ignores unknown roles', async () => {
    await addUser(db, 'owner@example.com')
    const boss = await addUser(db, 'boss@example.com', { appMeta: { role: 'admin' } })
    const odd = await addUser(db, 'odd@example.com', { appMeta: { role: 'root' } })
    expect(await profileOf(boss)).toMatchObject({ role: 'admin' })
    expect(await profileOf(odd)).toMatchObject({ role: 'employee' })
  })

  it('never takes the role from user-editable user_metadata', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'sneaky@example.com', { meta: { role: 'admin' } })
    expect(await profileOf(id)).toMatchObject({ role: 'employee' })
  })

  it('rejects a second user whose display name matches case-insensitively', async () => {
    await addUser(db, 'dana@example.com')
    await expect(addUser(db, 'DANA@other.com')).rejects.toThrow(/duplicate key/i)
  })

  it('removes the profile when the auth user is deleted', async () => {
    const id = await addUser(db, 'owner@example.com')
    await db.query('delete from auth.users where id = $1', [id])
    expect(await profileOf(id)).toBeUndefined()
  })
})

describe('users that existed before the migration ran', () => {
  it('get a profile each, and the oldest becomes the admin', async () => {
    const seeded = await createDb(async (d) => {
      await d.exec(`
        insert into auth.users (id, email, created_at) values
          ('00000000-0000-0000-0000-000000000002', 'second@example.com', '2026-01-02'),
          ('00000000-0000-0000-0000-000000000001', 'first@example.com', '2026-01-01')`)
    })
    const r = await seeded.query('select email, role, must_change_password from public.profiles order by email')
    expect(r.rows).toEqual([
      { email: 'first@example.com', role: 'admin', must_change_password: false },
      { email: 'second@example.com', role: 'employee', must_change_password: true },
    ])
  })

  it('leaves an empty database alone', async () => {
    const r = await db.query('select count(*)::int as n from public.profiles')
    expect(r.rows[0]).toEqual({ n: 0 })
  })
})

describe('membership helpers', () => {
  const flags = () =>
    db.query<{ m: boolean; a: boolean }>('select public.is_member() as m, public.is_admin() as a')

  it('reports membership and admin status for the calling user', async () => {
    const admin = await addUser(db, 'owner@example.com')
    const emp = await addUser(db, 'dana@example.com')
    expect((await as(db, { id: admin }, flags)).rows[0]).toEqual({ m: true, a: true })
    expect((await as(db, { id: emp }, flags)).rows[0]).toEqual({ m: true, a: false })
  })

  it('treats a deactivated user as neither member nor admin', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await db.query('update public.profiles set is_active = false where id = $1', [admin])
    expect((await as(db, { id: admin }, flags)).rows[0]).toEqual({ m: false, a: false })
  })
})

describe('profiles row level security', () => {
  it('lets active members read every profile', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await addUser(db, 'dana@example.com')
    const r = await as(db, { id: admin }, () => db.query('select id from public.profiles'))
    expect(r.rows).toHaveLength(2)
  })

  it('shows a deactivated user nothing', async () => {
    await addUser(db, 'owner@example.com')
    const emp = await addUser(db, 'dana@example.com')
    await db.query('update public.profiles set is_active = false where id = $1', [emp])
    const r = await as(db, { id: emp }, () => db.query('select id from public.profiles'))
    expect(r.rows).toHaveLength(0)
  })

  it('blocks anonymous access outright', async () => {
    await addUser(db, 'owner@example.com')
    await expect(as(db, 'anon', () => db.query('select * from public.profiles'))).rejects.toThrow(
      /permission denied/i,
    )
  })

  it('blocks every write from signed-in users', async () => {
    const admin = await addUser(db, 'owner@example.com')
    const write = (sql: string) => as(db, { id: admin }, () => db.query(sql))
    await expect(
      write(`insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')`),
    ).rejects.toThrow(/permission denied/i)
    await expect(write(`update public.profiles set role = 'admin'`)).rejects.toThrow(/permission denied/i)
    await expect(write('delete from public.profiles')).rejects.toThrow(/permission denied/i)
  })

  it('does not let signed-in users call the trigger function directly', async () => {
    const admin = await addUser(db, 'owner@example.com')
    await expect(as(db, { id: admin }, () => db.query('select public.handle_new_user()'))).rejects.toThrow(
      /permission denied/i,
    )
  })
})
