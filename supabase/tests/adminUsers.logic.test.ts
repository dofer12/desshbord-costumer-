// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  handleAdminRequest,
  makeTempPassword,
  parseAdminRequest,
  type AdminDeps,
  type AdminResult,
  type ProfileRow,
  type Role,
} from '../functions/admin-users/logic'

// The rules of the administrator function, with nothing behind them but pretend services: who may
// call it, what a request must look like, in which order things are done, and what is never said.
// adminUsers.db.test.ts runs the same rules over the real SQL.

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ADMIN_ID = '22222222-2222-4222-8222-222222222222'
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'
const BLOCKED_ADMIN_ID = '44444444-4444-4444-8444-444444444444'
const STRANGER_ID = '55555555-5555-4555-8555-555555555555'
const MISSING_ID = '77777777-7777-4777-8777-777777777777'
const TOKEN = 'secret-token-of-the-caller'

const profile = (id: string, over: Partial<ProfileRow> = {}): ProfileRow => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  display_name: `name ${id.slice(0, 4)}`,
  role: 'employee',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
  ...over,
})

type Call = [method: string, ...args: unknown[]]
type Failures = Partial<{
  authSetPassword: boolean
  authBan: boolean
  revokeSessions: boolean
  authCreate: 'email_taken' | 'failed'
  updateProfile: 'name_taken' | 'last_admin' | 'not_found' | 'failed'
  /** The profile of the user that was just made cannot be read. */
  createdHasNoProfile: boolean
  /** Reading the profile of the user that was just made breaks. */
  createdProfileThrows: boolean
  /** The profile of the user that was just made does not have `must_change_password` set. */
  createdWithoutFlag: boolean
  /** A service that is reached after the profile is read breaks, with this message. */
  throws: string
}>

/** Pretend services over a small map of profiles, that record every call that changes something. */
function world(over: { failures?: Failures; random?: (n: number) => Uint8Array } = {}) {
  const profiles = new Map<string, ProfileRow>(
    [
      profile(ADMIN_ID, { display_name: 'Dana Admin', email: 'dana@example.com', role: 'admin' }),
      profile(OTHER_ADMIN_ID, { display_name: 'Omer Admin', email: 'omer@example.com', role: 'admin' }),
      profile(EMPLOYEE_ID, { display_name: 'Eli Employee', email: 'eli@example.com' }),
      profile(BLOCKED_ADMIN_ID, { display_name: 'Bar Blocked', email: 'bar@example.com', role: 'admin', is_active: false }),
    ].map((p) => [p.id, p]),
  )
  // Who the tokens are. STRANGER_ID has a token (a real user of the auth service) and no profile.
  const tokens = new Map<string, string>([
    [TOKEN, ADMIN_ID],
    ['employee-token', EMPLOYEE_ID],
    ['blocked-token', BLOCKED_ADMIN_ID],
    ['stranger-token', STRANGER_ID],
  ])
  const failures: Failures = { ...over.failures }
  const calls: Call[] = []
  const logs: Array<Record<string, unknown>> = []
  let created = 0
  let lastCreated: string | null = null
  const copy = <T,>(value: T): T => structuredClone(value)

  const deps: AdminDeps = {
    identify: vi.fn(async (token: string) => tokens.get(token) ?? null),
    profile: vi.fn(async (id: string) => {
      if (failures.createdHasNoProfile && id === lastCreated) return null
      if (failures.createdProfileThrows && id === lastCreated) throw new Error('the database is down')
      const found = profiles.get(id)
      return found ? copy(found) : null
    }),
    profileByName: vi.fn(async (name: string) => {
      const found = [...profiles.values()].find((p) => p.display_name.toLowerCase() === name.toLowerCase())
      return found ? copy(found) : null
    }),
    profileByEmail: vi.fn(async (email: string) => {
      const found = [...profiles.values()].find((p) => p.email.toLowerCase() === email.toLowerCase())
      return found ? copy(found) : null
    }),
    authCreate: vi.fn(async (input) => {
      calls.push(['authCreate', copy(input)])
      if (failures.throws) throw new Error(failures.throws)
      if (failures.authCreate) return { error: failures.authCreate }
      created += 1
      const id = `99999999-9999-4999-8999-${String(created).padStart(12, '0')}`
      lastCreated = id
      profiles.set(
        id,
        profile(id, { email: input.email, display_name: input.display_name, role: input.role, must_change_password: !failures.createdWithoutFlag }),
      )
      return { id }
    }),
    authSetPassword: vi.fn(async (id: string, password: string) => {
      calls.push(['authSetPassword', id, password])
      if (failures.throws) throw new Error(failures.throws)
      return !failures.authSetPassword
    }),
    authBan: vi.fn(async (id: string, banned: boolean) => {
      calls.push(['authBan', id, banned])
      return !failures.authBan
    }),
    authDelete: vi.fn(async (id: string) => {
      calls.push(['authDelete', id])
      profiles.delete(id)
    }),
    revokeSessions: vi.fn(async (id: string) => {
      calls.push(['revokeSessions', id])
      return !failures.revokeSessions
    }),
    updateProfile: vi.fn(async (id: string, patch) => {
      calls.push(['updateProfile', id, copy(patch)])
      if (failures.throws) throw new Error(failures.throws)
      if (failures.updateProfile) return { error: failures.updateProfile }
      const found = profiles.get(id)
      if (!found) return { error: 'not_found' as const }
      // The pretend guard: the only active administrator stays.
      const leaves = found.role === 'admin' && found.is_active && (patch.role === 'employee' || patch.is_active === false)
      const others = [...profiles.values()].filter((p) => p.id !== id && p.role === 'admin' && p.is_active)
      if (leaves && others.length === 0) return { error: 'last_admin' as const }
      Object.assign(found, patch)
      return copy(found)
    }),
    randomBytes: over.random ?? ((n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 224)),
    log: (line) => void logs.push(copy(line)),
  }
  return { deps, profiles, calls, logs }
}

type World = ReturnType<typeof world>

/** What a request that is refused must not have done: nothing that changes a user was called. */
function expectNothingChanged(w: World) {
  expect(w.calls).toEqual([])
}

const ask = (w: World, body: unknown, token: string | null = TOKEN) => handleAdminRequest(w.deps, token, body)
const refused = (code: string, field?: string) => (field === undefined ? { ok: false, code } : { ok: false, code, field })
const methods = (w: World) => w.calls.map(([method]) => method)

describe('who is calling', () => {
  it.each([null, '', '   '])('says "unauthenticated" for the token %j, without asking anybody who it is', async (token) => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'x' }, token)).toEqual(refused('unauthenticated'))
    expect(w.deps.identify).not.toHaveBeenCalled()
    expectNothingChanged(w)
  })

  it('says "unauthenticated" for a token that nobody knows', async () => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'x' }, 'forged-token')).toEqual(refused('unauthenticated'))
    expectNothingChanged(w)
  })

  it.each([
    ['a user of the auth service who has no profile', 'stranger-token'],
    ['an employee', 'employee-token'],
    ['an administrator who is blocked', 'blocked-token'],
  ])('says "forbidden" for %s, and changes nothing', async (_who, token) => {
    const w = world()
    expect(await ask(w, { action: 'set_role', user_id: EMPLOYEE_ID, role: 'admin' }, token)).toEqual(refused('forbidden'))
    expectNothingChanged(w)
    expect(w.profiles.get(EMPLOYEE_ID)?.role).toBe('employee')
  })

  it('takes nothing in the body for who the caller is, or what they may do', async () => {
    const w = world()
    const body = {
      action: 'set_role',
      user_id: EMPLOYEE_ID,
      role: 'admin',
      caller_id: ADMIN_ID,
      is_admin: true,
      role_of_caller: 'admin',
      app_metadata: { role: 'admin' },
      user_metadata: { role: 'admin' },
    }
    expect(await ask(w, body, 'employee-token')).toEqual(refused('forbidden'))
    expectNothingChanged(w)
  })

  it('judges the caller before it looks at the body: a stranger learns nothing of what is valid', async () => {
    const w = world()
    expect(await ask(w, { action: 'no such action' }, 'employee-token')).toEqual(refused('forbidden'))
    expect(await ask(w, null, null)).toEqual(refused('unauthenticated'))
  })

  it('reads the profile of the caller for every request: a caller who was blocked meanwhile is refused', async () => {
    const w = world()
    expect((await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'First Name' })).ok).toBe(true)
    w.profiles.get(ADMIN_ID)!.is_active = false
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Second Name' })).toEqual(refused('forbidden'))
  })
})

describe('what a request must look like', () => {
  const valid = { action: 'create', email: 'new@example.com', display_name: 'New Person', role: 'employee' }

  it.each([
    ['null', null, 'body'],
    ['an array', [], 'body'],
    ['a string', 'create', 'body'],
    ['a number', 42, 'body'],
    ['an empty object', {}, 'action'],
    ['an unknown action', { action: 'delete_user', user_id: EMPLOYEE_ID }, 'action'],
    ['an action that is not a string', { action: 7 }, 'action'],
    ['an e-mail that is empty', { ...valid, email: '' }, 'email'],
    ['an e-mail with only spaces', { ...valid, email: '   ' }, 'email'],
    ['an e-mail with no @', { ...valid, email: 'nobody.example.com' }, 'email'],
    ['an e-mail with two @', { ...valid, email: 'a@b@example.com' }, 'email'],
    ['an e-mail with nothing before the @', { ...valid, email: '@example.com' }, 'email'],
    ['an e-mail with nothing after the @', { ...valid, email: 'a@' }, 'email'],
    ['an e-mail with a space in it', { ...valid, email: 'a b@example.com' }, 'email'],
    ['an e-mail with a line break in it', { ...valid, email: 'a\n@example.com' }, 'email'],
    ['an e-mail with a control character in it', { ...valid, email: 'a\u0007b@example.com' }, 'email'],
    ['an e-mail that is over 254 characters', { ...valid, email: `${'a'.repeat(243)}@example.com` }, 'email'],
    ['an e-mail that is not a string', { ...valid, email: 12 }, 'email'],
    ['a name that is empty', { ...valid, display_name: '' }, 'display_name'],
    ['a name that is only spaces', { ...valid, display_name: '   ' }, 'display_name'],
    ['a name of 61 characters', { ...valid, display_name: 'ש'.repeat(61) }, 'display_name'],
    ['a name with a control character', { ...valid, display_name: 'a\u0007b' }, 'display_name'],
    ['a name with a line break', { ...valid, display_name: 'a\nb' }, 'display_name'],
    ['a name that is not a string', { ...valid, display_name: null }, 'display_name'],
    ['a role that does not exist', { ...valid, role: 'owner' }, 'role'],
    ['a role that is missing', { action: 'create', email: 'a@b.co', display_name: 'x' }, 'role'],
    ['a user id that is not a UUID (reset)', { action: 'reset_password', user_id: 'dana' }, 'user_id'],
    ['a user id that is missing (reset)', { action: 'reset_password' }, 'user_id'],
    ['a user id that is not a UUID (block)', { action: 'set_active', user_id: '1', is_active: false }, 'user_id'],
    ['a user id that is too long (role)', { action: 'set_role', user_id: `${EMPLOYEE_ID}0`, role: 'admin' }, 'user_id'],
    ['a user id that is a space (rename)', { action: 'rename', user_id: ' ', display_name: 'x' }, 'user_id'],
    ['a user id with SQL in it', { action: 'reset_password', user_id: `${EMPLOYEE_ID}'; drop table profiles; --` }, 'user_id'],
    ['is_active that is not a boolean', { action: 'set_active', user_id: EMPLOYEE_ID, is_active: 'false' }, 'is_active'],
    ['is_active that is missing', { action: 'set_active', user_id: EMPLOYEE_ID }, 'is_active'],
    ['a role that does not exist (set_role)', { action: 'set_role', user_id: EMPLOYEE_ID, role: 'root' }, 'role'],
    ['a name that is empty (rename)', { action: 'rename', user_id: EMPLOYEE_ID, display_name: '' }, 'display_name'],
  ])('refuses %s as "invalid", with the field, and changes nothing', async (_what, body, field) => {
    const w = world()
    expect(await ask(w, body)).toEqual(refused('invalid', field))
    expectNothingChanged(w)
  })

  it('ignores fields that it does not know', async () => {
    const w = world()
    const result = await ask(w, { ...valid, shoe_size: 44, is_admin: true, id: STRANGER_ID })
    expect(result.ok).toBe(true)
    expect(w.calls[0]).toEqual(['authCreate', { email: 'new@example.com', password: expect.any(String), role: 'employee', display_name: 'New Person' }])
  })

  it('lets a name of 60 characters and an e-mail of 254 characters through', async () => {
    const w = world()
    const email = `${'a'.repeat(242)}@example.com`
    expect(email).toHaveLength(254)
    expect((await ask(w, { ...valid, email, display_name: 'ש'.repeat(60) })).ok).toBe(true)
  })

  it('lowers the case of the e-mail and trims it and the name', () => {
    expect(parseAdminRequest({ action: 'create', email: '  Dana@Example.COM ', display_name: '  דנה כהן  ', role: 'admin' })).toEqual({
      action: 'create',
      email: 'dana@example.com',
      display_name: 'דנה כהן',
      role: 'admin',
    })
    // A user id is the same user in capitals (the digits of the ids in this file have no case).
    const lower = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
    expect(parseAdminRequest({ action: 'rename', user_id: lower.toUpperCase(), display_name: ' x ' })).toEqual({
      action: 'rename',
      user_id: lower,
      display_name: 'x',
    })
  })

  it('says which field is wrong when it is parsed on its own', () => {
    expect(parseAdminRequest({ action: 'create', email: 'x', display_name: 'a', role: 'admin' })).toEqual({ invalid: 'email' })
    expect(parseAdminRequest(undefined)).toEqual({ invalid: 'body' })
  })
})

describe('ids that are not UUIDs (the pretend server of the demo and of the tests)', () => {
  const plain = { isUserId: (value: string) => /^[\w-]{1,64}$/.test(value) }

  it('takes the ids that the predicate takes, as they are, and refuses the others', () => {
    expect(parseAdminRequest({ action: 'reset_password', user_id: 'u-Dana' }, plain)).toEqual({ action: 'reset_password', user_id: 'u-Dana' })
    expect(parseAdminRequest({ action: 'reset_password', user_id: 'u dana' }, plain)).toEqual({ invalid: 'user_id' })
    expect(parseAdminRequest({ action: 'reset_password', user_id: '' }, plain)).toEqual({ invalid: 'user_id' })
    expect(parseAdminRequest({ action: 'reset_password', user_id: 7 }, plain)).toEqual({ invalid: 'user_id' })
  })

  it('is not the way of the real function: with no predicate only a UUID is an id', () => {
    expect(parseAdminRequest({ action: 'reset_password', user_id: 'u-dana' })).toEqual({ invalid: 'user_id' })
    expect(parseAdminRequest({ action: 'reset_password', user_id: 'u-dana' }, {})).toEqual({ invalid: 'user_id' })
  })

  it('serves a request with such an id all the way', async () => {
    const w = world()
    w.profiles.set('u-dana', profile('u-dana', { display_name: 'Dana Employee', email: 'dana@example.com' }))
    const result = await handleAdminRequest(w.deps, TOKEN, { action: 'rename', user_id: 'u-dana', display_name: 'Dana Cohen' }, plain)
    expect(result).toMatchObject({ ok: true, user: { id: 'u-dana', display_name: 'Dana Cohen' } })
  })

  it('writes such an id in the log as it is, and a UUID in lower case', async () => {
    const w = world()
    w.profiles.set('u-dana', profile('u-dana', { display_name: 'Dana Employee', email: 'dana@example.com' }))
    await handleAdminRequest(w.deps, TOKEN, { action: 'rename', user_id: 'u-dana', display_name: 'Dana Cohen' }, plain)
    expect(w.logs).toEqual([{ caller: ADMIN_ID, action: 'rename', target: 'u-dana', code: 'ok' }])
  })
})

describe('create', () => {
  const body = { action: 'create', email: 'New@Example.com', display_name: 'New Person', role: 'employee' as Role }

  it('makes the user with the role and the name, and returns the profile and a temporary password', async () => {
    const w = world()
    const result = await ask(w, body)
    expect(result).toMatchObject({ ok: true, user: { email: 'new@example.com', display_name: 'New Person', role: 'employee', is_active: true, must_change_password: true } })
    const password = (result as { temp_password?: string }).temp_password
    expect(password).toHaveLength(TEMP_PASSWORD_LENGTH)
    expect(w.calls).toEqual([['authCreate', { email: 'new@example.com', password, role: 'employee', display_name: 'New Person' }]])
  })

  it('makes an administrator when it is asked to', async () => {
    const w = world()
    expect(await ask(w, { ...body, role: 'admin' })).toMatchObject({ ok: true, user: { role: 'admin' } })
  })

  it.each([
    ['the same', 'Eli Employee'],
    ['another case of', 'eLI eMPLOYEE'],
  ])('says "name_taken", before any user is made, for %s name', async (_how, name) => {
    const w = world()
    expect(await ask(w, { ...body, display_name: name })).toEqual(refused('name_taken', 'display_name'))
    expect(w.deps.authCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['the same', 'eli@example.com'],
    ['another case of', 'ELI@Example.COM'],
  ])('says "email_taken", before any user is made, for %s e-mail', async (_how, email) => {
    const w = world()
    expect(await ask(w, { ...body, email })).toEqual(refused('email_taken', 'email'))
    expect(w.deps.authCreate).not.toHaveBeenCalled()
  })

  it('says "email_taken" when the auth service says so (two requests at the same moment)', async () => {
    const w = world({ failures: { authCreate: 'email_taken' } })
    expect(await ask(w, body)).toEqual(refused('email_taken', 'email'))
  })

  it('says "failed" for any other failure of the auth service', async () => {
    const w = world({ failures: { authCreate: 'failed' } })
    expect(await ask(w, body)).toEqual(refused('failed'))
  })

  it('takes the user away again when the profile that should have been made cannot be read, and says "failed"', async () => {
    const w = world({ failures: { createdHasNoProfile: true } })
    expect(await ask(w, body)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['authCreate', 'authDelete'])
  })

  it('takes the user away again when something breaks after the user was made, so that no user is left without a profile', async () => {
    const w = world({ failures: { createdProfileThrows: true } })
    expect(await ask(w, body)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['authCreate', 'authDelete'])
    expect(w.profiles.size).toBe(4)
  })

  it('makes the person choose a password even when the profile did not come with that set', async () => {
    const w = world({ failures: { createdWithoutFlag: true } })
    const result = await ask(w, body)
    expect(result).toMatchObject({ ok: true, user: { must_change_password: true } })
    expect(methods(w)).toEqual(['authCreate', 'updateProfile'])
  })

  it('takes the user away again when that cannot be set, and says "failed"', async () => {
    const w = world({ failures: { createdWithoutFlag: true, updateProfile: 'failed' } })
    expect(await ask(w, body)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['authCreate', 'updateProfile', 'authDelete'])
  })
})

describe('reset_password', () => {
  const body = { action: 'reset_password', user_id: EMPLOYEE_ID }

  it('sets a new temporary password, makes the person choose their own, ends their sessions, and returns the password', async () => {
    const w = world()
    const result = await ask(w, body)
    const password = (result as { temp_password?: string }).temp_password
    expect(password).toHaveLength(TEMP_PASSWORD_LENGTH)
    expect(result).toMatchObject({ ok: true, user: { id: EMPLOYEE_ID, must_change_password: true } })
    expect(w.calls).toEqual([
      ['authSetPassword', EMPLOYEE_ID, password],
      ['updateProfile', EMPLOYEE_ID, { must_change_password: true }],
      ['revokeSessions', EMPLOYEE_ID],
    ])
  })

  it('says "not_found" for a user that is not there', async () => {
    const w = world()
    expect(await ask(w, { ...body, user_id: MISSING_ID })).toEqual(refused('not_found'))
    expectNothingChanged(w)
  })

  it('refuses the caller who resets themselves: the profile page is for that', async () => {
    const w = world()
    expect(await ask(w, { ...body, user_id: ADMIN_ID })).toEqual(refused('invalid', 'user_id'))
    expectNothingChanged(w)
  })

  it('says "failed", and does not set the flag, when the password cannot be set', async () => {
    const w = world({ failures: { authSetPassword: true } })
    expect(await ask(w, body)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['authSetPassword'])
  })

  it('says "not_found", and ends no session, when the person is gone by the time the flag is set', async () => {
    const w = world({ failures: { updateProfile: 'not_found' } })
    expect(await ask(w, body)).toEqual(refused('not_found'))
    expect(methods(w)).toEqual(['authSetPassword', 'updateProfile'])
  })

  it('says "failed", and shows no password, when the sessions cannot be ended (it is safe to ask again)', async () => {
    const w = world({ failures: { revokeSessions: true } })
    const result = await ask(w, body)
    expect(result).toEqual(refused('failed'))
    expect(JSON.stringify(result)).not.toMatch(/temp_password/)
  })

  it('can reset another administrator, and one who is blocked', async () => {
    const w = world()
    expect((await ask(w, { ...body, user_id: OTHER_ADMIN_ID })).ok).toBe(true)
    expect((await ask(w, { ...body, user_id: BLOCKED_ADMIN_ID })).ok).toBe(true)
  })

  it('gives another password every time', async () => {
    let n = 0
    const w = world({ random: (size) => Uint8Array.from({ length: size }, (_, i) => (i * 13 + 5 * ++n) % 224) })
    const first = (await ask(w, body)) as { temp_password: string }
    const second = (await ask(w, body)) as { temp_password: string }
    expect(first.temp_password).not.toBe(second.temp_password)
  })
})

describe('set_active', () => {
  const block = { action: 'set_active', user_id: EMPLOYEE_ID, is_active: false }
  const unblock = { action: 'set_active', user_id: EMPLOYEE_ID, is_active: true }

  it('blocks: the profile first, so that the person is stopped at once, then the sign-in, then the sessions', async () => {
    const w = world()
    expect(await ask(w, block)).toMatchObject({ ok: true, user: { id: EMPLOYEE_ID, is_active: false } })
    expect(w.calls).toEqual([
      ['updateProfile', EMPLOYEE_ID, { is_active: false }],
      ['authBan', EMPLOYEE_ID, true],
      ['revokeSessions', EMPLOYEE_ID],
    ])
  })

  it('unblocks: the sign-in is allowed again first, and then the profile is switched on', async () => {
    const w = world()
    w.profiles.get(EMPLOYEE_ID)!.is_active = false
    expect(await ask(w, unblock)).toMatchObject({ ok: true, user: { id: EMPLOYEE_ID, is_active: true } })
    expect(w.calls).toEqual([
      ['authBan', EMPLOYEE_ID, false],
      ['updateProfile', EMPLOYEE_ID, { is_active: true }],
    ])
  })

  it('refuses the caller who blocks themselves, and changes nothing', async () => {
    const w = world()
    expect(await ask(w, { ...block, user_id: ADMIN_ID })).toEqual(refused('invalid', 'user_id'))
    expectNothingChanged(w)
  })

  it('lets the caller "unblock" themselves, which changes nothing that matters', async () => {
    const w = world()
    expect((await ask(w, { ...unblock, user_id: ADMIN_ID })).ok).toBe(true)
  })

  it('says "last_admin", and does nothing more, when the guard keeps the last administrator', async () => {
    const w = world({ failures: { updateProfile: 'last_admin' } })
    expect(await ask(w, { ...block, user_id: OTHER_ADMIN_ID })).toEqual(refused('last_admin'))
    expect(methods(w)).toEqual(['updateProfile'])
  })

  it('says "not_found" for a user that is not there', async () => {
    const w = world()
    expect(await ask(w, { ...block, user_id: MISSING_ID })).toEqual(refused('not_found'))
    expectNothingChanged(w)
  })

  it('says "failed" when the sign-in cannot be switched off after the profile was blocked, and is safe to ask again', async () => {
    const w = world({ failures: { authBan: true } })
    expect(await ask(w, block)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['updateProfile', 'authBan'])
    expect(w.profiles.get(EMPLOYEE_ID)?.is_active).toBe(false)
    // Asked again, it does it all again, and it comes out the same.
    w.calls.length = 0
    expect(await ask(w, block)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['updateProfile', 'authBan'])
  })

  it('says "failed" when the sessions cannot be ended', async () => {
    const w = world({ failures: { revokeSessions: true } })
    expect(await ask(w, block)).toEqual(refused('failed'))
    expect(methods(w)).toEqual(['updateProfile', 'authBan', 'revokeSessions'])
  })

  it('does not switch the profile on when the sign-in could not be allowed again', async () => {
    const w = world({ failures: { authBan: true } })
    w.profiles.get(EMPLOYEE_ID)!.is_active = false
    expect(await ask(w, unblock)).toEqual(refused('failed'))
    expect(w.profiles.get(EMPLOYEE_ID)?.is_active).toBe(false)
    expect(methods(w)).toEqual(['authBan'])
  })
})

describe('set_role', () => {
  it('changes the role', async () => {
    const w = world()
    expect(await ask(w, { action: 'set_role', user_id: EMPLOYEE_ID, role: 'admin' })).toMatchObject({ ok: true, user: { id: EMPLOYEE_ID, role: 'admin' } })
    expect(w.calls).toEqual([['updateProfile', EMPLOYEE_ID, { role: 'admin' }]])
  })

  it('lets an administrator change their own role while there is another one', async () => {
    const w = world()
    expect(await ask(w, { action: 'set_role', user_id: ADMIN_ID, role: 'employee' })).toMatchObject({ ok: true, user: { role: 'employee' } })
  })

  it('says "last_admin" when the only administrator would demote themselves', async () => {
    const w = world()
    w.profiles.get(OTHER_ADMIN_ID)!.is_active = false
    expect(await ask(w, { action: 'set_role', user_id: ADMIN_ID, role: 'employee' })).toEqual(refused('last_admin'))
    expect(w.profiles.get(ADMIN_ID)?.role).toBe('admin')
  })

  it('says "last_admin" when the guard says so', async () => {
    const w = world({ failures: { updateProfile: 'last_admin' } })
    expect(await ask(w, { action: 'set_role', user_id: OTHER_ADMIN_ID, role: 'employee' })).toEqual(refused('last_admin'))
  })

  it('succeeds without changing anything when the person already has the role', async () => {
    const w = world()
    expect(await ask(w, { action: 'set_role', user_id: EMPLOYEE_ID, role: 'employee' })).toMatchObject({ ok: true, user: { id: EMPLOYEE_ID, role: 'employee' } })
    expectNothingChanged(w)
  })

  it('says "not_found" for a user that is not there', async () => {
    const w = world()
    expect(await ask(w, { action: 'set_role', user_id: MISSING_ID, role: 'admin' })).toEqual(refused('not_found'))
  })
})

describe('rename', () => {
  it('trims the name and changes it', async () => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: '  Eli Cohen ' })).toMatchObject({ ok: true, user: { display_name: 'Eli Cohen' } })
    expect(w.calls).toEqual([['updateProfile', EMPLOYEE_ID, { display_name: 'Eli Cohen' }]])
  })

  it.each([
    ['the same', 'Omer Admin'],
    ['another case of', 'OMER admin'],
  ])('says "name_taken" for %s name of somebody else', async (_how, name) => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: name })).toEqual(refused('name_taken', 'display_name'))
    expectNothingChanged(w)
  })

  it('succeeds without changing anything when the name is the same', async () => {
    const w = world()
    expect((await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Eli Employee' })).ok).toBe(true)
    expectNothingChanged(w)
  })

  it('lets a person change only the case of their own name', async () => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'ELI EMPLOYEE' })).toMatchObject({ ok: true, user: { display_name: 'ELI EMPLOYEE' } })
    expect(w.calls).toHaveLength(1)
  })

  it('passes on "name_taken" from the database (two requests at the same moment)', async () => {
    const w = world({ failures: { updateProfile: 'name_taken' } })
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Somebody New' })).toEqual(refused('name_taken', 'display_name'))
  })

  it('says "not_found" for a user that is not there', async () => {
    const w = world()
    expect(await ask(w, { action: 'rename', user_id: MISSING_ID, display_name: 'x' })).toEqual(refused('not_found'))
  })
})

describe('when something unexpected happens', () => {
  it('says "failed", with no word of what went wrong, and logs only a code', async () => {
    const w = world({ failures: { throws: 'connection to 10.0.0.5 refused, password=hunter2' } })
    const result = await ask(w, { action: 'reset_password', user_id: EMPLOYEE_ID })
    expect(result).toEqual(refused('failed'))
    expect(JSON.stringify([result, w.logs])).not.toMatch(/hunter2|10\.0\.0\.5|refused/)
    expect(w.logs).toEqual([{ caller: ADMIN_ID, action: 'reset_password', target: EMPLOYEE_ID, code: 'failed' }])
  })

  it('says "failed" for a create that throws too', async () => {
    const w = world({ failures: { throws: 'boom' } })
    expect(await ask(w, { action: 'create', email: 'a@b.co', display_name: 'A B', role: 'employee' })).toEqual(refused('failed'))
  })

  it('does not let a log that cannot be written change what was done', async () => {
    const w = world()
    w.deps.log = () => {
      throw new Error('the log is full')
    }
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Eli Cohen' })).toMatchObject({ ok: true, user: { display_name: 'Eli Cohen' } })
  })

  it('says "failed" when the service that tells who the caller is breaks', async () => {
    const w = world()
    ;(w.deps.identify as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('auth is down'))
    expect(await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'x' })).toEqual(refused('failed'))
    expectNothingChanged(w)
  })
})

describe('what is written down, and what is never said', () => {
  it('writes one line for each request: who, what, to whom, and how it ended', async () => {
    const w = world()
    await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Eli Cohen' })
    await ask(w, { action: 'set_role', user_id: MISSING_ID, role: 'admin' })
    await ask(w, { action: 'rename', user_id: 'not a uuid', display_name: 'x' })
    await ask(w, { action: 'nonsense\n\u001b[31mred' })
    await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'x' }, 'employee-token')
    await ask(w, { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'x' }, null)
    expect(w.logs).toEqual([
      { caller: ADMIN_ID, action: 'rename', target: EMPLOYEE_ID, code: 'ok' },
      { caller: ADMIN_ID, action: 'set_role', target: MISSING_ID, code: 'not_found' },
      // What the caller typed is not copied into the log unless it is one of the known actions or a UUID.
      { caller: ADMIN_ID, action: 'rename', code: 'invalid' },
      { caller: ADMIN_ID, code: 'invalid' },
      { caller: EMPLOYEE_ID, code: 'forbidden' },
      { code: 'unauthenticated' },
    ])
  })

  it('never puts a password or the token in a log line or in a refusal, whatever the request and the outcome', async () => {
    const passwords = new Set<string>()
    const said: unknown[] = []
    const answers: AdminResult[] = []
    const requests: Array<[unknown, Failures?]> = [
      [{ action: 'create', email: 'a@b.co', display_name: 'A B', role: 'employee' }],
      [{ action: 'create', email: 'a@b.co', display_name: 'A B', role: 'employee' }, { authCreate: 'failed' }],
      [{ action: 'create', email: 'a@b.co', display_name: 'A B', role: 'employee' }, { createdHasNoProfile: true }],
      [{ action: 'create', email: 'eli@example.com', display_name: 'Z', role: 'employee' }],
      [{ action: 'reset_password', user_id: EMPLOYEE_ID }],
      [{ action: 'reset_password', user_id: EMPLOYEE_ID }, { revokeSessions: true }],
      [{ action: 'reset_password', user_id: EMPLOYEE_ID }, { authSetPassword: true }],
      [{ action: 'reset_password', user_id: EMPLOYEE_ID }, { throws: 'password was p4ss' }],
      [{ action: 'reset_password', user_id: ADMIN_ID }],
      [{ action: 'set_active', user_id: EMPLOYEE_ID, is_active: false }],
      [{ action: 'set_active', user_id: EMPLOYEE_ID, is_active: false }, { authBan: true }],
      [{ action: 'set_role', user_id: EMPLOYEE_ID, role: 'admin' }],
      [{ action: 'rename', user_id: EMPLOYEE_ID, display_name: 'New Name' }],
      [{ action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Omer Admin' }],
      [{ action: 'whatever', password: 'p4ssw0rd-in-the-body' }],
    ]
    for (const [body, failures] of requests) {
      const w = world({ failures })
      const result = await ask(w, body)
      answers.push(result)
      const password = (result as { temp_password?: string }).temp_password
      if (password) passwords.add(password)
      for (const call of w.calls) {
        if (call[0] === 'authSetPassword') passwords.add(call[2] as string)
        if (call[0] === 'authCreate') passwords.add((call[1] as { password: string }).password)
      }
      said.push(w.logs, result.ok ? [] : result)
    }
    expect(passwords.size).toBeGreaterThan(0)
    const text = JSON.stringify(said)
    for (const password of passwords) expect(text).not.toContain(password)
    for (const secret of [TOKEN, 'p4ssw0rd-in-the-body', 'p4ss']) expect(text).not.toContain(secret)
    // The password is in the answer of a request that succeeded, and only in the field that carries it.
    for (const answer of answers) {
      if (answer.ok) expect(Object.keys(answer).sort()).toEqual('temp_password' in answer ? ['ok', 'temp_password', 'user'] : ['ok', 'user'])
    }
  })

  it('does not give a temporary password for a rename, a role or a block', async () => {
    const w = world()
    for (const body of [
      { action: 'rename', user_id: EMPLOYEE_ID, display_name: 'Eli Cohen' },
      { action: 'set_role', user_id: EMPLOYEE_ID, role: 'admin' },
      { action: 'set_active', user_id: EMPLOYEE_ID, is_active: false },
    ]) {
      expect(await ask(w, body)).not.toHaveProperty('temp_password')
    }
  })
})

describe('makeTempPassword', () => {
  const bytesFrom = (list: number[]) => {
    let at = 0
    return (n: number) => Uint8Array.from({ length: n }, () => list[at++ % list.length])
  }

  it('is 16 characters, all from an alphabet that has no look-alikes', () => {
    const password = makeTempPassword((n) => Uint8Array.from({ length: n }, (_, i) => i * 9))
    expect(password).toHaveLength(16)
    expect(TEMP_PASSWORD_LENGTH).toBe(16)
    expect([...password].every((c) => TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true)
    expect(TEMP_PASSWORD_ALPHABET).toHaveLength(56)
    expect(new Set(TEMP_PASSWORD_ALPHABET).size).toBe(56)
    for (const confusing of ['I', 'l', 'O', '0', '1', 'o']) expect(TEMP_PASSWORD_ALPHABET).not.toContain(confusing)
    // Letters of both cases and digits are all in it, so that a form that wants each of them is satisfied.
    expect(TEMP_PASSWORD_ALPHABET).toMatch(/[a-z]/)
    expect(TEMP_PASSWORD_ALPHABET).toMatch(/[A-Z]/)
    expect(TEMP_PASSWORD_ALPHABET).toMatch(/[2-9]/)
  })

  it('is the same for the same bytes and different for different ones', () => {
    const one = makeTempPassword(bytesFrom([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(makeTempPassword(bytesFrom([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(one)
    expect(makeTempPassword(bytesFrom([9, 8, 7, 6, 5, 4, 3, 2]))).not.toBe(one)
  })

  it('takes the bytes below 224 as they are, modulo the length of the alphabet, and skips the others (no modulo bias)', () => {
    // 255 and 224 would favour the first characters of the alphabet: they are not used.
    const list = [255, 224, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    expect(makeTempPassword(bytesFrom(list))).toBe([...TEMP_PASSWORD_ALPHABET].slice(0, 16).join(''))
    expect(makeTempPassword(bytesFrom([223, 57, 56, 0, 111, 112, 168, 167, 1, 2, 3, 4, 5, 6, 7, 8]))).toBe(
      [55, 1, 0, 0, 55, 0, 0, 55, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => TEMP_PASSWORD_ALPHABET[i]).join(''),
    )
  })

  it('asks for more bytes when many are skipped', () => {
    const asked: number[] = []
    const source = (n: number) => {
      asked.push(n)
      // Two rounds in which nothing can be used, and then a round that can.
      return Uint8Array.from({ length: n }, () => (asked.length < 3 ? 250 : 7))
    }
    expect(makeTempPassword(source)).toBe(TEMP_PASSWORD_ALPHABET[7].repeat(16))
    expect(asked.length).toBe(3)
  })

  it('gives up with an error when nothing that it is given can be used, and does not loop for ever', () => {
    let rounds = 0
    expect(() =>
      makeTempPassword((n) => {
        rounds += 1
        return Uint8Array.from({ length: n }, () => 255)
      }),
    ).toThrow()
    expect(rounds).toBeGreaterThan(1)
    expect(rounds).toBeLessThan(100)
  })

  it('does not give a password back that it was asked for before, when the bytes are another', () => {
    const first = makeTempPassword(bytesFrom([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160]))
    const second = makeTempPassword(bytesFrom([11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 111, 121, 131, 141, 151, 161]))
    expect(first).not.toBe(second)
  })
})
