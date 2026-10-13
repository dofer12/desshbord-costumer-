import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { DANA } from '../../test/fakeGateway'
import { createSupabaseGateway } from './supabaseGateway'

type Listener = (event: string) => void

/** Just enough of the supabase-js surface for the gateway, with call recording. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  let listener: Listener | null = null
  const unsubscribe = vi.fn()
  const maybeSingle = vi.fn().mockResolvedValue({ data: DANA, error: null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: DANA.id } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb
      return { data: { subscription: { unsubscribe } } }
    }),
  }
  const client = { auth, from, ...overrides } as unknown as SupabaseClient
  return { client, auth, from, select, eq, maybeSingle, unsubscribe, emit: (e: string) => listener?.(e) }
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
    f.maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await createSupabaseGateway(f.client).fetchProfile('u1')).toBeNull()
  })

  it('rejects with the backend error', async () => {
    const f = fakeClient()
    const err = { message: 'TypeError: Failed to fetch' }
    f.maybeSingle.mockResolvedValue({ data: null, error: err })
    await expect(createSupabaseGateway(f.client).fetchProfile('u1')).rejects.toBe(err)
  })
})

describe('signOut', () => {
  it('rejects when the backend reports an error', async () => {
    const f = fakeClient()
    f.auth.signOut.mockResolvedValue({ error: new Error('x') })
    await expect(createSupabaseGateway(f.client).signOut()).rejects.toThrow('x')
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
