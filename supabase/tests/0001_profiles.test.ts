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

  // Spec section 8: even if a user gets created (a sign-up toggle left on, a user added in the
  // dashboard), without an active profile row RLS blocks everything.
  it('starts every later user inactive, so a stray account sees nothing until someone activates it', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'dana@example.com')
    expect(await profileOf(id)).toMatchObject({ is_active: false })
  })

  it('activates a later user only when an admin tool provisions it with a role in app_metadata', async () => {
    await addUser(db, 'owner@example.com')
    const employee = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
    const boss = await addUser(db, 'boss@example.com', { appMeta: { role: 'admin' } })
    expect(await profileOf(employee)).toMatchObject({ role: 'employee', is_active: true, must_change_password: true })
    expect(await profileOf(boss)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('ignores an unknown role and leaves that user an inactive employee', async () => {
    await addUser(db, 'owner@example.com')
    const odd = await addUser(db, 'odd@example.com', { appMeta: { role: 'root' } })
    expect(await profileOf(odd)).toMatchObject({ role: 'employee', is_active: false })
  })

  it('never takes the role or the activation from user-editable user_metadata', async () => {
    await addUser(db, 'owner@example.com')
    const id = await addUser(db, 'sneaky@example.com', { meta: { role: 'admin', is_active: true } })
    expect(await profileOf(id)).toMatchObject({ role: 'employee', is_active: false })
  })

  it('keeps names derived from the email unique, so creating a user never fails because of them', async () => {
    const first = await addUser(db, 'dana@gmail.com')
    const second = await addUser(db, 'dana@walla.co.il')
    const third = await addUser(db, 'DANA@example.org')
    expect(await profileOf(first)).toMatchObject({ display_name: 'dana' })
    expect(await profileOf(second)).toMatchObject({ display_name: 'dana 2' })
    expect(await profileOf(third)).toMatchObject({ display_name: 'DANA 3' })
  })

  it('still rejects a name chosen on purpose that is taken, ignoring case', async () => {
    await addUser(db, 'owner@example.com', { meta: { display_name: 'Dana' } })
    await expect(addUser(db, 'other@example.com', { meta: { display_name: 'dana' } })).rejects.toThrow(/duplicate key/i)
  })

  it('does not rename a name chosen on purpose that collides with a name derived from an email', async () => {
    await addUser(db, 'dana@example.com')
    await expect(addUser(db, 'someone@example.com', { meta: { display_name: 'Dana' } })).rejects.toThrow(/duplicate key/i)
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
    const r = await seeded.query(
      'select email, role, is_active, must_change_password from public.profiles order by email',
    )
    expect(r.rows).toEqual([
      { email: 'first@example.com', role: 'admin', is_active: true, must_change_password: false },
      // Same rule as for a new user: only the oldest is active until an admin says otherwise.
      { email: 'second@example.com', role: 'employee', is_active: false, must_change_password: true },
    ])
  })

  it('keep a role and the activation that an admin tool gave them', async () => {
    const seeded = await createDb(async (d) => {
      await d.exec(`
        insert into auth.users (id, email, created_at, raw_app_meta_data) values
          ('00000000-0000-0000-0000-000000000001', 'first@example.com', '2026-01-01', '{}'),
          ('00000000-0000-0000-0000-000000000002', 'boss@example.com', '2026-01-02', '{"role":"admin"}'),
          ('00000000-0000-0000-0000-000000000003', 'odd@example.com', '2026-01-03', '{"role":"root"}')`)
    })
    const r = await seeded.query('select email, role, is_active from public.profiles order by email')
    expect(r.rows).toEqual([
      { email: 'boss@example.com', role: 'admin', is_active: true },
      { email: 'first@example.com', role: 'admin', is_active: true },
      { email: 'odd@example.com', role: 'employee', is_active: false },
    ])
  })

  it('do not make the migration fail when their email names collide', async () => {
    const seeded = await createDb(async (d) => {
      await d.exec(`
        insert into auth.users (id, email, created_at) values
          ('00000000-0000-0000-0000-000000000001', 'dana@gmail.com', '2026-01-01'),
          ('00000000-0000-0000-0000-000000000002', 'dana@walla.co.il', '2026-01-02'),
          ('00000000-0000-0000-0000-000000000003', 'DANA@example.org', '2026-01-03')`)
    })
    const r = await seeded.query('select email, display_name from public.profiles order by email')
    expect(r.rows).toEqual([
      { email: 'DANA@example.org', display_name: 'DANA 3' },
      { email: 'dana@gmail.com', display_name: 'dana' },
      { email: 'dana@walla.co.il', display_name: 'dana 2' },
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
    const emp = await addUser(db, 'dana@example.com', { appMeta: { role: 'employee' } })
    expect((await as(db, { id: admin }, flags)).rows[0]).toEqual({ m: true, a: true })
    expect((await as(db, { id: emp }, flags)).rows[0]).toEqual({ m: true, a: false })
  })

  it('does not count a user nobody has activated as a member', async () => {
    await addUser(db, 'owner@example.com')
    const stray = await addUser(db, 'stray@example.com')
    expect((await as(db, { id: stray }, flags)).rows[0]).toEqual({ m: false, a: false })
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

  it('shows a user nobody has activated nothing', async () => {
    await addUser(db, 'owner@example.com')
    const stray = await addUser(db, 'stray@example.com')
    const r = await as(db, { id: stray }, () => db.query('select id from public.profiles'))
    expect(r.rows).toHaveLength(0)
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
