import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { DANA } from '../../test/fakeGateway'
import { createSupabaseGateway } from './supabaseGateway'

type Listener = (event: string) => void

/** Just enough of the supabase-js surface for the gateway, with call recording. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  let listener: Listener | null = null
  const unsubscribe = vi.fn()
  const maybeSingle = vi.fn().mockResolvedValue({ data: DANA, error: null, status: 200 })
  const retry = vi.fn(() => ({ maybeSingle }))
  const eq = vi.fn(() => ({ retry, maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, status: 204 })
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: DANA.id } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: { id: DANA.id } }, error: null }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
  }
  const client = { auth, from, rpc, ...overrides } as unknown as SupabaseClient
  return { client, auth, from, rpc, select, eq, retry, maybeSingle, unsubscribe, emit: (e: string) => listener?.(e) }
}

describe('getStoredUserId', () => {
  it('is null when nothing is stored', async () => {
    const { client } = fakeClient()
    expect(await createSupabaseGateway(client).getStoredUserId()).toBeNull()
  })

  it('returns the id of the stored session', async () => {
    const f = fakeClient()
    f.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'abc' } } }, error: null })
    expect(await createSupabaseGateway(f.client).getStoredUserId()).toBe('abc')
  })

  it('rejects, instead of reporting "signed out", when the renewal failed because of the network', async () => {
    const f = fakeClient()
    const err = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' })
    f.auth.getSession.mockResolvedValue({ data: { session: null }, error: err })
    await expect(createSupabaseGateway(f.client).getStoredUserId()).rejects.toBe(err)
  })

  it('reports signed out when the session is genuinely gone', async () => {
    const f = fakeClient()
    f.auth.getSession.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found' } })
    expect(await createSupabaseGateway(f.client).getStoredUserId()).toBeNull()
  })
})

describe('signIn', () => {
  it('passes the credentials through and returns the user id', async () => {
    const f = fakeClient()
    expect(await createSupabaseGateway(f.client).signIn('a@b.co', 'pw')).toBe(DANA.id)
    expect(f.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw' })
  })

  it('rejects with the backend error untouched', async () => {
    const f = fakeClient()
    const err = { code: 'invalid_credentials' }
    f.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: err })
    await expect(createSupabaseGateway(f.client).signIn('a@b.co', 'pw')).rejects.toBe(err)
  })
})

describe('fetchProfile', () => {
  it("selects only the caller's own row by id", async () => {
    const f = fakeClient()
    expect(await createSupabaseGateway(f.client).fetchProfile('u1')).toEqual(DANA)
    expect(f.from).toHaveBeenCalledWith('profiles')
    expect(f.eq).toHaveBeenCalledWith('id', 'u1')
  })

  it('is null when no row is visible', async () => {
    const f = fakeClient()
    f.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 })
    expect(await createSupabaseGateway(f.client).fetchProfile('u1')).toBeNull()
  })

  it('does not retry on its own, so an unreachable server is reported at once', async () => {
    const f = fakeClient()
    await createSupabaseGateway(f.client).fetchProfile('u1')
    expect(f.retry).toHaveBeenCalledWith(false)
  })

  it('rejects with the backend error and the HTTP status the store needs to classify it', async () => {
    const f = fakeClient()
    f.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'JWT expired', code: 'PGRST301', details: '', hint: '' },
      status: 401,
    })
    await expect(createSupabaseGateway(f.client).fetchProfile('u1')).rejects.toMatchObject({
      message: 'JWT expired',
      code: 'PGRST301',
      status: 401,
    })
  })
})

describe('signOut', () => {
  it('ends only this device, not the user\'s sessions on every other device', async () => {
    const f = fakeClient()
    await createSupabaseGateway(f.client).signOut()
    expect(f.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('rejects when the backend reports an error', async () => {
    const f = fakeClient()
    f.auth.signOut.mockResolvedValue({ error: new Error('x') })
    await expect(createSupabaseGateway(f.client).signOut()).rejects.toThrow('x')
  })
})

describe('changePassword', () => {
  it('asks the auth service to change the password of the signed-in person, and sends nothing else', async () => {
    const f = fakeClient()
    await createSupabaseGateway(f.client).changePassword('a-password-of-my-own')
    expect(f.auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'a-password-of-my-own' })
  })

  it('rejects with the backend error untouched', async () => {
    const f = fakeClient()
    const err = { code: 'same_password', status: 422 }
    f.auth.updateUser.mockResolvedValue({ data: { user: null }, error: err })
    await expect(createSupabaseGateway(f.client).changePassword('a-password-of-my-own')).rejects.toBe(err)
  })
})

describe('clearMustChangePassword', () => {
  it('calls the function of the database that does it, with no arguments', async () => {
    const f = fakeClient()
    await createSupabaseGateway(f.client).clearMustChangePassword()
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('clear_must_change_password')
  })

  it('rejects with the message, the code and the status of the answer', async () => {
    const f = fakeClient()
    f.rpc.mockResolvedValue({ data: null, error: { message: 'JWT expired', code: 'PGRST301', details: '', hint: '' }, status: 401 })
    await expect(createSupabaseGateway(f.client).clearMustChangePassword()).rejects.toMatchObject({
      message: 'JWT expired',
      code: 'PGRST301',
      status: 401,
    })
  })
})

describe('updateMyProfile', () => {
  const INPUT = { display_name: 'דנה כהן', default_remind_min: 30 }

  function signedInClient() {
    const f = fakeClient()
    f.auth.getSession.mockResolvedValue({ data: { session: { user: { id: DANA.id } } }, error: null })
    return f
  }

  it('calls the function with the parameters it names, then reads the profile of the person and returns it', async () => {
    const f = signedInClient()
    f.maybeSingle.mockResolvedValue({ data: { ...DANA, ...INPUT }, error: null, status: 200 })
    expect(await createSupabaseGateway(f.client).updateMyProfile(INPUT)).toEqual({ ...DANA, ...INPUT })
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('update_my_profile', { p_display_name: 'דנה כהן', p_default_remind_min: 30 })
    expect(f.from).toHaveBeenCalledWith('profiles')
    expect(f.eq).toHaveBeenCalledWith('id', DANA.id)
    expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.maybeSingle.mock.invocationCallOrder[0])
  })

  it('rejects with the message, the code and the status when the function refuses, and reads nothing', async () => {
    const f = signedInClient()
    f.rpc.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "profiles_display_name_key"', code: '23505', details: '', hint: '' },
      status: 409,
    })
    await expect(createSupabaseGateway(f.client).updateMyProfile(INPUT)).rejects.toMatchObject({
      message: 'duplicate key value violates unique constraint "profiles_display_name_key"',
      code: '23505',
      status: 409,
    })
    expect(f.maybeSingle).not.toHaveBeenCalled()
  })

  it('rejects as a session that is not there when nobody is signed in, and calls nothing', async () => {
    const f = fakeClient()
    await expect(createSupabaseGateway(f.client).updateMyProfile(INPUT)).rejects.toMatchObject({ status: 401 })
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('rejects with the network error of a session that could not be renewed', async () => {
    const f = fakeClient()
    const err = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' })
    f.auth.getSession.mockResolvedValue({ data: { session: null }, error: err })
    await expect(createSupabaseGateway(f.client).updateMyProfile(INPUT)).rejects.toBe(err)
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it('rejects, rather than return nothing, when the profile cannot be seen afterwards', async () => {
    const f = signedInClient()
    f.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 })
    await expect(createSupabaseGateway(f.client).updateMyProfile(INPUT)).rejects.toMatchObject({ status: 403 })
  })

  it('rejects with the error of the read when it fails', async () => {
    const f = signedInClient()
    f.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000', details: '', hint: '' }, status: 500 })
    await expect(createSupabaseGateway(f.client).updateMyProfile(INPUT)).rejects.toMatchObject({ code: 'XX000', status: 500 })
  })
})

describe('onSessionEnded', () => {
  it('fires only for SIGNED_OUT and can be unsubscribed', () => {
    const f = fakeClient()
    const cb = vi.fn()
    const off = createSupabaseGateway(f.client).onSessionEnded(cb)
    f.emit('TOKEN_REFRESHED')
    f.emit('SIGNED_IN')
    expect(cb).not.toHaveBeenCalled()
    f.emit('SIGNED_OUT')
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
