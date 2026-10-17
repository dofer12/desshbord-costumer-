// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleAdminRequest, type AdminDeps, type AdminResult, type ProfileRow } from '../functions/admin-users/logic'
import { createDb, addUser } from './helpers/pg'

// The rules of the administrator function over the real SQL of the project (PGlite with 0001 to
// 0003): the profile of a new user is made by the real trigger, a change of a profile is judged by the
// real guard of the last administrator, and the sessions are ended by the real function. Only the
// auth service itself (GoTrue: passwords, bans, tokens) is pretended.

const COLUMNS = 'id, email, display_name, role, is_active, must_change_password, default_remind_min'
const PATCHABLE = new Set(['role', 'is_active', 'display_name', 'must_change_password'])

let db: PGlite
let owner: string
let passwords: Map<string, string>
let banned: Set<string>

beforeEach(async () => {
  db = await createDb()
  // The first user of a project is its administrator.
  owner = await addUser(db, 'owner@example.com', { meta: { display_name: 'Owner' } })
  passwords = new Map()
  banned = new Set()
})

/** The services of the function over the database, with the real rules of the database behind them. */
function realDeps(over: Partial<AdminDeps> = {}): AdminDeps {
  const one = async (sql: string, params: unknown[]) => (await db.query<ProfileRow>(sql, params)).rows[0] ?? null
  return {
    // A token of these tests is "token:<id of a user>"; the real service checks a signature.
    identify: async (token) => {
      const id = token.startsWith('token:') ? token.slice('token:'.length) : ''
      if (!/^[0-9a-f-]{36}$/.test(id)) return null
      const found = await db.query('select 1 from auth.users where id = $1', [id])
      return found.rows.length > 0 ? id : null
    },
    profile: (id) => one(`select ${COLUMNS} from public.profiles where id = $1`, [id]),
    profileByName: (name) => one(`select ${COLUMNS} from public.profiles where lower(display_name) = lower($1)`, [name]),
    profileByEmail: (email) => one(`select ${COLUMNS} from public.profiles where lower(email) = lower($1)`, [email]),
    authCreate: async ({ email, password, role, display_name }) => {
      // GoTrue refuses an e-mail that is there already, whatever its case.
      const taken = await db.query('select 1 from auth.users where lower(email) = lower($1)', [email])
      if (taken.rows.length > 0) return { error: 'email_taken' }
      try {
        const made = await db.query<{ id: string }>(
          `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, $2::jsonb, $3::jsonb) returning id`,
          [email, JSON.stringify({ role }), JSON.stringify({ display_name })],
        )
        passwords.set(made.rows[0].id, password)
        return { id: made.rows[0].id }
      } catch {
        // The trigger that makes the profile refused (a name that is taken, at the same moment as another request).
        return { error: 'failed' }
      }
    },
    authSetPassword: async (id, password) => {
      passwords.set(id, password)
      return true
    },
    authBan: async (id, ban) => {
      if (ban) banned.add(id)
      else banned.delete(id)
      return true
    },
    authDelete: async (id) => {
      await db.query('delete from auth.users where id = $1', [id])
    },
    revokeSessions: async (id) => {
      await db.query('select public.revoke_user_sessions($1)', [id])
      return true
    },
    updateProfile: async (id, patch) => {
      const columns = Object.keys(patch).filter((column) => PATCHABLE.has(column))
      const params: unknown[] = [id, ...columns.map((column) => (patch as Record<string, unknown>)[column])]
      try {
        const updated = await db.query<ProfileRow>(
          `update public.profiles set ${columns.map((column, i) => `${column} = $${i + 2}`).join(', ')} where id = $1 returning ${COLUMNS}`,
          params,
        )
        return updated.rows[0] ?? { error: 'not_found' }
      } catch (error) {
        const e = error as { code?: string; message?: string; constraint?: string }
        if (e.code === '23514' && /profiles_last_admin/.test(e.message ?? '')) return { error: 'last_admin' }
        if (e.code === '23505' && /profiles_display_name_key/.test(`${e.constraint ?? ''} ${e.message ?? ''}`)) return { error: 'name_taken' }
        return { error: 'failed' }
      }
    },
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    log: () => undefined,
    ...over,
  }
}

const ask = (as: string, body: unknown, deps: AdminDeps = realDeps()) => handleAdminRequest(deps, `token:${as}`, body)
const created = (result: AdminResult) => {
  expect(result).toMatchObject({ ok: true })
  return (result as { ok: true; user: ProfileRow }).user
}
const row = async (id: string) => (await db.query<ProfileRow>(`select ${COLUMNS} from public.profiles where id = $1`, [id])).rows[0]
const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0].n)
const makeAdmin = async (name: string) =>
  created(await ask(owner, { action: 'create', email: `${name.toLowerCase()}@example.com`, display_name: name, role: 'admin' }))

describe('create, over the real trigger', () => {
  it('makes an active profile that has to choose a password, with the role, the name and the e-mail that were asked for', async () => {
    const result = await ask(owner, { action: 'create', email: ' New.Person@Example.COM ', display_name: ' דנה כהן ', role: 'employee' })
    const user = created(result)
    expect(user).toMatchObject({ email: 'new.person@example.com', display_name: 'דנה כהן', role: 'employee', is_active: true, must_change_password: true })
    expect(await row(user.id)).toEqual(user)
    expect(passwords.get(user.id)).toBe((result as { temp_password: string }).temp_password)
  })

  it('makes an administrator, who is active', async () => {
    const user = await makeAdmin('Second')
    expect(user).toMatchObject({ role: 'admin', is_active: true, must_change_password: true })
  })

  it('refuses a name that is there already, in another case, and makes no user', async () => {
    const before = await count('auth.users')
    expect(await ask(owner, { action: 'create', email: 'other@example.com', display_name: 'OWNER', role: 'employee' })).toEqual({ ok: false, code: 'name_taken', field: 'display_name' })
    expect(await count('auth.users')).toBe(before)
  })

  it('refuses an e-mail that is there already, in another case, and makes no user', async () => {
    const before = await count('auth.users')
    expect(await ask(owner, { action: 'create', email: 'OWNER@example.com', display_name: 'Somebody Else', role: 'employee' })).toEqual({ ok: false, code: 'email_taken', field: 'email' })
    expect(await count('auth.users')).toBe(before)
  })

  it('leaves no user behind when the database refuses the name after the checks (two requests at the same moment)', async () => {
    const before = await count('auth.users')
    const racing = realDeps({ profileByName: async () => null })
    expect(await ask(owner, { action: 'create', email: 'race@example.com', display_name: 'owner', role: 'employee' }, racing)).toEqual({ ok: false, code: 'failed' })
    expect(await count('auth.users')).toBe(before)
    expect(await count('public.profiles')).toBe(before)
  })
})

describe('the last administrator, over the real guard', () => {
  it('cannot demote themselves while they are the only one, and the profile does not change', async () => {
    expect(await ask(owner, { action: 'set_role', user_id: owner, role: 'employee' })).toEqual({ ok: false, code: 'last_admin' })
    expect(await row(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('can block another administrator, and then cannot be demoted, the last one standing', async () => {
    const second = await makeAdmin('Second')
    expect(created(await ask(owner, { action: 'set_active', user_id: second.id, is_active: false }))).toMatchObject({ id: second.id, is_active: false })
    expect(await ask(owner, { action: 'set_role', user_id: owner, role: 'employee' })).toEqual({ ok: false, code: 'last_admin' })
    expect(await row(owner)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('lets one of two administrators demote themselves, and then the other cannot', async () => {
    const second = await makeAdmin('Second')
    expect(created(await ask(owner, { action: 'set_role', user_id: owner, role: 'employee' }))).toMatchObject({ role: 'employee' })
    // The owner is an employee now, and the function does not serve an employee.
    expect(await ask(owner, { action: 'rename', user_id: second.id, display_name: 'x' })).toEqual({ ok: false, code: 'forbidden' })
    expect(await ask(second.id, { action: 'set_role', user_id: second.id, role: 'employee' })).toEqual({ ok: false, code: 'last_admin' })
    expect(await row(second.id)).toMatchObject({ role: 'admin', is_active: true })
  })

  it('does not serve an administrator who was blocked, so that a blocked one cannot block the other', async () => {
    const second = await makeAdmin('Second')
    await ask(owner, { action: 'set_active', user_id: second.id, is_active: false })
    expect(await ask(second.id, { action: 'set_active', user_id: owner, is_active: false })).toEqual({ ok: false, code: 'forbidden' })
    expect(await row(owner)).toMatchObject({ is_active: true })
  })

  it('does not let an administrator block or reset themselves, whatever the database would say', async () => {
    await makeAdmin('Second')
    expect(await ask(owner, { action: 'set_active', user_id: owner, is_active: false })).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(await ask(owner, { action: 'reset_password', user_id: owner })).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(await row(owner)).toMatchObject({ is_active: true })
    expect(passwords.has(owner)).toBe(false)
  })
})

describe('reset and block, over the real end of sessions', () => {
  const sessions = async (userId: string) =>
    Number((await db.query<{ n: string }>('select count(*) as n from auth.sessions where user_id = $1', [userId])).rows[0].n)
  const addSessions = async (userId: string, n: number) => {
    for (let i = 0; i < n; i++) await db.query('insert into auth.sessions (user_id) values ($1)', [userId])
  }

  it('a reset gives a temporary password, makes the person choose their own, and ends every session of theirs and nobody else\'s', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    await db.query('update public.profiles set must_change_password = false where id = $1', [eli.id])
    await addSessions(eli.id, 3)
    await addSessions(owner, 1)
    const result = await ask(owner, { action: 'reset_password', user_id: eli.id })
    expect(created(result)).toMatchObject({ id: eli.id, must_change_password: true })
    expect(passwords.get(eli.id)).toBe((result as { temp_password: string }).temp_password)
    expect(await row(eli.id)).toMatchObject({ must_change_password: true })
    expect(await sessions(eli.id)).toBe(0)
    expect(await sessions(owner)).toBe(1)
  })

  it('a block stops the person at once, keeps them from signing in, and ends every session of theirs', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    await addSessions(eli.id, 2)
    expect(created(await ask(owner, { action: 'set_active', user_id: eli.id, is_active: false }))).toMatchObject({ id: eli.id, is_active: false })
    expect(await row(eli.id)).toMatchObject({ is_active: false })
    expect(banned.has(eli.id)).toBe(true)
    expect(await sessions(eli.id)).toBe(0)
    // And the person is not a member any more as far as the policies are concerned.
    await db.exec('set role authenticated')
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [eli.id])
    const member = await db.query<{ ok: boolean }>('select public.is_member() as ok')
    await db.exec('reset role')
    expect(member.rows[0].ok).toBe(false)
  })

  it('an unblock lifts the ban and makes the person a member again', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    await ask(owner, { action: 'set_active', user_id: eli.id, is_active: false })
    expect(created(await ask(owner, { action: 'set_active', user_id: eli.id, is_active: true }))).toMatchObject({ is_active: true })
    expect(banned.has(eli.id)).toBe(false)
    expect(await row(eli.id)).toMatchObject({ is_active: true })
  })
})

describe('rename, over the real unique index', () => {
  it('refuses a name that somebody has, in any case, and changes nothing', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    expect(await ask(owner, { action: 'rename', user_id: eli.id, display_name: 'OWNER' })).toEqual({ ok: false, code: 'name_taken', field: 'display_name' })
    expect((await row(eli.id)).display_name).toBe('Eli')
  })

  it('knows the name is taken even when the check before did not see it (two requests at the same moment)', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    const racing = realDeps({ profileByName: async () => null })
    expect(await ask(owner, { action: 'rename', user_id: eli.id, display_name: 'owner' }, racing)).toEqual({ ok: false, code: 'name_taken', field: 'display_name' })
    expect((await row(eli.id)).display_name).toBe('Eli')
  })

  it('changes a name, in Hebrew too, and lets a person change the case of their own', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    expect(created(await ask(owner, { action: 'rename', user_id: eli.id, display_name: 'אלי כהן' }))).toMatchObject({ display_name: 'אלי כהן' })
    expect(created(await ask(owner, { action: 'rename', user_id: eli.id, display_name: 'ELI COHEN' }))).toMatchObject({ display_name: 'ELI COHEN' })
    expect(created(await ask(owner, { action: 'rename', user_id: eli.id, display_name: 'eli cohen' }))).toMatchObject({ display_name: 'eli cohen' })
  })
})

describe('who is calling, over the real tables', () => {
  it('refuses a token that is not a user, and a user of the auth service who has no profile', async () => {
    const nobody = await db.query<{ id: string }>('select gen_random_uuid() as id')
    expect(await ask(nobody.rows[0].id, { action: 'rename', user_id: owner, display_name: 'x' })).toEqual({ ok: false, code: 'unauthenticated' })
    expect(await handleAdminRequest(realDeps(), 'not-a-token', { action: 'rename', user_id: owner, display_name: 'x' })).toEqual({ ok: false, code: 'unauthenticated' })

    const ghost = await addUser(db, 'ghost@example.com')
    await db.query('delete from public.profiles where id = $1', [ghost])
    expect(await ask(ghost, { action: 'rename', user_id: owner, display_name: 'x' })).toEqual({ ok: false, code: 'forbidden' })
    expect((await row(owner)).display_name).toBe('Owner')
  })

  it('refuses an employee, whatever the body says, and changes nothing', async () => {
    const eli = created(await ask(owner, { action: 'create', email: 'eli@example.com', display_name: 'Eli', role: 'employee' }))
    expect(await ask(eli.id, { action: 'set_role', user_id: eli.id, role: 'admin', caller_id: owner, is_admin: true })).toEqual({ ok: false, code: 'forbidden' })
    expect(await row(eli.id)).toMatchObject({ role: 'employee' })
  })
})
