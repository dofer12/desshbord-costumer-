// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseDeps, readSecretKey } from '../functions/admin-users/supabaseDeps'
import type { ProfileRow } from '../functions/admin-users/logic'

// The services of the administrator function over the Supabase client: which table, which call, which
// arguments, and how an error of the library becomes one of the words that logic.ts understands. The client is
// pretended with a recorder; adminUsers.db.test.ts shows the rules over the real SQL, and the live check
// of the project (npm run security-check) is what runs the deployed function.

const COLUMNS = 'id, email, display_name, role, is_active, must_change_password, default_remind_min'
const ID = '33333333-3333-4333-8333-333333333333'
const row = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  id: ID,
  email: 'eli@example.com',
  display_name: 'Eli Employee',
  role: 'employee',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
  ...over,
})

type Reply = { data?: unknown; error?: { code?: string; message?: string; status?: number; name?: string } | null }

/** A recorder in the place of the client: every call is written down, and the answers are those that the test gives. */
function fakeClient(answers: Partial<Record<'select' | 'update' | 'getUser' | 'createUser' | 'updateUserById' | 'deleteUser' | 'rpc', Reply>> = {}) {
  const calls: Array<[string, ...unknown[]]> = []
  const reply = (key: keyof typeof answers, fallback: Reply = { data: null, error: null }) => answers[key] ?? fallback
  const from = (table: string) => {
    const state: { op: 'select' | 'update'; table: string; patch?: unknown; columns?: string; filters: unknown[] } = { op: 'select', table, filters: [] }
    const settle = () => {
      calls.push([state.op, state.table, ...(state.op === 'update' ? [state.patch] : []), state.columns, ...state.filters])
      return Promise.resolve(reply(state.op))
    }
    const chain: Record<string, unknown> = {
      select(columns: string) {
        state.columns = columns
        return chain
      },
      update(patch: unknown) {
        state.op = 'update'
        state.patch = patch
        return chain
      },
      eq(column: string, value: unknown) {
        state.filters.push(['eq', column, value])
        return chain
      },
      maybeSingle() {
        return settle().then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null) }))
      },
      then(resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) {
        return settle().then(resolve, reject)
      },
    }
    return chain
  }
  const client = {
    from,
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push(['rpc', name, args])
      return reply('rpc')
    }),
    auth: {
      getUser: vi.fn(async (token: string) => {
        calls.push(['getUser', token])
        return reply('getUser')
      }),
      admin: {
        createUser: vi.fn(async (input: unknown) => {
          calls.push(['createUser', input])
          return reply('createUser')
        }),
        updateUserById: vi.fn(async (id: string, attributes: unknown) => {
          calls.push(['updateUserById', id, attributes])
          return reply('updateUserById')
        }),
        deleteUser: vi.fn(async (id: string) => {
          calls.push(['deleteUser', id])
          return reply('deleteUser')
        }),
      },
    },
  }
  return { client, calls }
}

function setup(answers: Parameters<typeof fakeClient>[0] = {}) {
  const { client, calls } = fakeClient(answers)
  const lines: Array<Record<string, unknown>> = []
  const deps = createSupabaseDeps(client as never, { randomBytes: (n) => new Uint8Array(n).fill(7), log: (line) => void lines.push(line) })
  return { deps, calls, lines }
}

describe('the secret key', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name]

  it('is the "default" key of SUPABASE_SECRET_KEYS, which is where the platform puts the new keys', () => {
    expect(readSecretKey(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_new', other: 'x' }), SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('sb_secret_new')
  })

  it('is the service role key when there is no list, or the list has no default, or it cannot be read', () => {
    expect(readSecretKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('legacy')
    expect(readSecretKey(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: 'x' }), SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('legacy')
    expect(readSecretKey(env({ SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('legacy')
    expect(readSecretKey(env({ SUPABASE_SECRET_KEYS: '', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('legacy')
  })

  it('is not guessed: with no key at all it throws, and the message holds no key', () => {
    expect(() => readSecretKey(env({}))).toThrow()
    try {
      readSecretKey(env({ SUPABASE_SECRET_KEYS: '{"default": "", "other": "sb_secret_of_another_name"}' }))
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toMatch(/sb_secret|other/)
    }
  })
})

describe('who a token belongs to', () => {
  it('is the user that the auth service finds for it', async () => {
    const { deps, calls } = setup({ getUser: { data: { user: { id: ID } }, error: null } })
    expect(await deps.identify('the-token')).toBe(ID)
    expect(calls).toEqual([['getUser', 'the-token']])
  })

  it('is nobody when the auth service finds no user', async () => {
    expect(await setup({ getUser: { data: { user: null }, error: null } }).deps.identify('x')).toBeNull()
  })

  it.each([
    ['401', { message: 'invalid JWT', status: 401 }],
    ['403', { message: 'expired', status: 403 }],
    ['422', { message: 'bad request', status: 422 }],
    ['an error with no status', { message: 'invalid JWT' }],
  ])('is nobody when the auth service refuses the token (%s)', async (_what, error) => {
    expect(await setup({ getUser: { data: { user: null }, error } }).deps.identify('x')).toBeNull()
  })

  it.each([
    ['500', { message: 'unexpected failure', status: 500 }],
    ['502', { message: 'bad gateway', status: 502 }],
    ['no answer', { message: 'fetch failed', status: 0 }],
    ['an error that says that it may be tried again', { name: 'AuthRetryableFetchError', message: 'fetch failed' }],
  ])('is a failure, and not "nobody", when the auth service itself is down (%s), so that nobody is told that they are signed out', async (_what, error) => {
    await expect(setup({ getUser: { data: { user: null }, error } }).deps.identify('x')).rejects.toThrow()
  })
})

describe('the profiles', () => {
  it('reads one by its id, with the columns that the app knows and no others', async () => {
    const { deps, calls } = setup({ select: { data: [row()], error: null } })
    expect(await deps.profile(ID)).toEqual(row())
    expect(calls).toEqual([['select', 'profiles', COLUMNS, ['eq', 'id', ID]]])
  })

  it('says null for a profile that is not there', async () => {
    expect(await setup({ select: { data: [], error: null } }).deps.profile(ID)).toBeNull()
  })

  it('finds a profile by its name in any case, and the whole name only', async () => {
    const people = [row({ id: 'a', display_name: 'Eli' }), row({ id: 'b', display_name: 'Eli Cohen' }), row({ id: 'c', display_name: 'דנה כהן' }), row({ id: 'd', display_name: 'a*b' })]
    const { deps } = setup({ select: { data: people, error: null } })
    expect((await deps.profileByName('eLI'))?.id).toBe('a')
    expect((await deps.profileByName('ELI COHEN'))?.id).toBe('b')
    expect((await deps.profileByName('דנה כהן'))?.id).toBe('c')
    expect((await deps.profileByName('a*b'))?.id).toBe('d')
    expect(await deps.profileByName('Eli C')).toBeNull()
    expect(await deps.profileByName('%')).toBeNull()
    expect(await deps.profileByName('a_b')).toBeNull()
  })

  it('finds a profile by its e-mail in any case, and the whole e-mail only', async () => {
    const people = [row({ id: 'a', email: 'Eli@Example.com' }), row({ id: 'b', email: 'eli@example.com.il' })]
    const { deps } = setup({ select: { data: people, error: null } })
    expect((await deps.profileByEmail('eli@example.com'))?.id).toBe('a')
    expect((await deps.profileByEmail('ELI@Example.COM'))?.id).toBe('a')
    expect(await deps.profileByEmail('eli@example')).toBeNull()
  })

  it('throws when the table cannot be read, so that a broken database is never taken for "nobody"', async () => {
    const { deps } = setup({ select: { data: null, error: { code: '42501', message: 'permission denied for table profiles' } } })
    await expect(deps.profile(ID)).rejects.toThrow()
    await expect(deps.profileByName('x')).rejects.toThrow()
    await expect(deps.profileByEmail('x')).rejects.toThrow()
  })
})

describe('the users of the auth service', () => {
  it('makes a user with the e-mail confirmed, the role where only the secret key can write it, and the name', async () => {
    const { deps, calls } = setup({ createUser: { data: { user: { id: ID } }, error: null } })
    expect(await deps.authCreate({ email: 'new@example.com', password: 'Pw-Pw-Pw-Pw-1234', role: 'admin', display_name: 'New Person' })).toEqual({ id: ID })
    expect(calls).toEqual([
      [
        'createUser',
        {
          email: 'new@example.com',
          password: 'Pw-Pw-Pw-Pw-1234',
          email_confirm: true,
          app_metadata: { role: 'admin' },
          user_metadata: { display_name: 'New Person' },
        },
      ],
    ])
  })

  it.each([
    ['the code email_exists', { code: 'email_exists', message: 'Unprocessable', status: 422 }],
    ['the code user_already_exists', { code: 'user_already_exists', message: 'Unprocessable', status: 422 }],
    ['a message and no code', { message: 'A user with this email address has already been registered', status: 422 }],
  ])('says "email_taken" for %s', async (_what, error) => {
    expect(await setup({ createUser: { data: { user: null }, error } }).deps.authCreate({ email: 'a@b.co', password: 'x', role: 'employee', display_name: 'A' })).toEqual({ error: 'email_taken' })
  })

  it('says "failed" for any other error, and for an answer with no user', async () => {
    const input = { email: 'a@b.co', password: 'x', role: 'employee' as const, display_name: 'A' }
    expect(await setup({ createUser: { data: { user: null }, error: { code: 'unexpected_failure', message: 'database error', status: 500 } } }).deps.authCreate(input)).toEqual({ error: 'failed' })
    expect(await setup({ createUser: { data: { user: null }, error: null } }).deps.authCreate(input)).toEqual({ error: 'failed' })
  })

  it('sets a password, and only the password', async () => {
    const { deps, calls } = setup({ updateUserById: { data: {}, error: null } })
    expect(await deps.authSetPassword(ID, 'Pw-Pw-Pw-Pw-1234')).toBe(true)
    expect(calls).toEqual([['updateUserById', ID, { password: 'Pw-Pw-Pw-Pw-1234' }]])
  })

  it('bans for as long as can be said, and lifts the ban with "none"', async () => {
    const { deps, calls } = setup({ updateUserById: { data: {}, error: null } })
    expect(await deps.authBan(ID, true)).toBe(true)
    expect(await deps.authBan(ID, false)).toBe(true)
    expect(calls).toEqual([
      ['updateUserById', ID, { ban_duration: '876000h' }],
      ['updateUserById', ID, { ban_duration: 'none' }],
    ])
  })

  it('says false when the auth service refuses a password or a ban', async () => {
    const { deps } = setup({ updateUserById: { data: null, error: { message: 'User not found', status: 404 } } })
    expect(await deps.authSetPassword(ID, 'x')).toBe(false)
    expect(await deps.authBan(ID, true)).toBe(false)
  })

  it('takes a user away', async () => {
    const { deps, calls } = setup({ deleteUser: { data: {}, error: null } })
    await deps.authDelete(ID)
    expect(calls).toEqual([['deleteUser', ID]])
  })

  it('ends the sessions through the function of the database, and says false when that fails', async () => {
    const ok = setup({ rpc: { data: null, error: null } })
    expect(await ok.deps.revokeSessions(ID)).toBe(true)
    expect(ok.calls).toEqual([['rpc', 'revoke_user_sessions', { p_user_id: ID }]])
    expect(await setup({ rpc: { data: null, error: { message: 'permission denied for function revoke_user_sessions', code: '42501' } } }).deps.revokeSessions(ID)).toBe(false)
  })
})

describe('a change of a profile', () => {
  it('updates the row of that user, returns it, and sends only the fields that it was given', async () => {
    const { deps, calls } = setup({ update: { data: [row({ is_active: false })], error: null } })
    expect(await deps.updateProfile(ID, { is_active: false })).toEqual(row({ is_active: false }))
    expect(calls).toEqual([['update', 'profiles', { is_active: false }, COLUMNS, ['eq', 'id', ID]]])
  })

  it('says "not_found" when no row was changed', async () => {
    expect(await setup({ update: { data: [], error: null } }).deps.updateProfile(ID, { role: 'admin' })).toEqual({ error: 'not_found' })
  })

  it('says "last_admin" for the guard of the database, which raises a check violation by that name', async () => {
    const error = { code: '23514', message: 'profiles_last_admin' }
    expect(await setup({ update: { data: null, error } }).deps.updateProfile(ID, { is_active: false })).toEqual({ error: 'last_admin' })
  })

  it('says "name_taken" for the unique index of the names, and nothing else gets that word', async () => {
    const taken = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_display_name_key"' }
    expect(await setup({ update: { data: null, error: taken } }).deps.updateProfile(ID, { display_name: 'x' })).toEqual({ error: 'name_taken' })
    const other = { code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' }
    expect(await setup({ update: { data: null, error: other } }).deps.updateProfile(ID, { display_name: 'x' })).toEqual({ error: 'failed' })
    const check = { code: '23514', message: 'new row violates check constraint "profiles_role_check"' }
    expect(await setup({ update: { data: null, error: check } }).deps.updateProfile(ID, { role: 'admin' })).toEqual({ error: 'failed' })
  })

  it('says "failed" for any other error', async () => {
    expect(await setup({ update: { data: null, error: { code: '42501', message: 'permission denied' } } }).deps.updateProfile(ID, { role: 'admin' })).toEqual({ error: 'failed' })
  })
})

describe('what it hands to the function', () => {
  it('gives the random bytes and the log that it was given', () => {
    const { deps, lines } = setup()
    expect(Array.from(deps.randomBytes(3))).toEqual([7, 7, 7])
    deps.log({ code: 'ok' })
    expect(lines).toEqual([{ code: 'ok' }])
  })
})
