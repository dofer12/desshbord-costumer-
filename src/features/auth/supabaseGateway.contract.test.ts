// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthStore, SLOW_START_MS } from './authStore'
import { AUTH_MESSAGES } from './errors'
import { createSupabaseGateway } from './supabaseGateway'

// supabaseGateway.test.ts uses hand-made fakes of supabase-js, which can only confirm what the
// gateway asks of it. These tests run the real client against a stubbed network instead, so
// they pin what the library actually sends and what its errors really look like.

const PROJECT = 'https://probe.supabase.co'
const STORAGE_KEY = 'moked-contract-test'
const LOGOUT = '/auth/v1/logout'
const PROFILES = '/rest/v1/profiles'
const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'dana@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

const base64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeJwt = (payload: object) => `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.signature`

/** A stored session. By default its access token stays valid for another hour, so no renewal is needed. */
function storedSession(secondsValid = 3600) {
  const expiresAt = Math.floor(Date.now() / 1000) + secondsValid
  return {
    access_token: fakeJwt({ sub: USER.id, exp: expiresAt }),
    token_type: 'bearer',
    expires_in: secondsValid,
    expires_at: expiresAt,
    refresh_token: 'refresh-1',
    user: USER,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const noContent = () => new Response(null, { status: 204 })
const offline = (): never => {
  throw new TypeError('Failed to fetch')
}

interface Sent {
  method: string
  url: URL
}

/** The real client and store, wired to a network that answers however the test says. */
function harness(respond: (sent: Sent) => Response, options: { withSession?: boolean; secondsValid?: number } = {}) {
  const sent: Sent[] = []
  const values = new Map<string, string>()
  if (options.withSession ?? true) values.set(STORAGE_KEY, JSON.stringify(storedSession(options.secondsValid)))
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  const client = createClient(PROJECT, 'sb_publishable_test', {
    global: {
      fetch: async (input, init) => {
        const request = { method: init?.method ?? 'GET', url: new URL(String(input)) }
        sent.push(request)
        return respond(request)
      },
    },
    auth: { storage, storageKey: STORAGE_KEY, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const gateway = createSupabaseGateway(client)
  const store = createAuthStore(gateway)
  return {
    gateway,
    store,
    sent,
    count: (path: string) => sent.filter((request) => request.url.pathname === path).length,
    hasStoredSession: () => values.has(STORAGE_KEY),
  }
}

/** Answers the profile request with `profile`, and anything else (the logout) with "no content". */
const profileAnswers = (profile: () => Response) => (sent: Sent) =>
  sent.url.pathname === PROFILES ? profile() : noContent()

describe('signOut', () => {
  it("ends only this device, not the user's sessions on every other device", async () => {
    const h = harness(() => noContent())
    await h.gateway.signOut()
    const logout = h.sent.find((request) => request.url.pathname === LOGOUT)
    expect(logout?.method).toBe('POST')
    expect(logout?.url.searchParams.get('scope')).toBe('local')
  })
})

describe('start-up with a stored session', () => {
  it.each([
    ['a 500 from the database API', () => json(500, { message: 'boom' })],
    ['a 502 HTML page from a proxy', () => new Response('<html>Bad gateway</html>', { status: 502 })],
    ['no answer at all (offline)', offline],
  ])('keeps the session and offers a retry after %s', async (_name, fail) => {
    const h = harness(profileAnswers(fail))
    await h.store.getState().init()
    expect(h.store.getState().status).toBe('unreachable')
    expect(h.count(LOGOUT)).toBe(0)
    expect(h.hasStoredSession()).toBe(true)
    // Not retried behind the user's back: the library's own retries would add 7 seconds of "loading".
    expect(h.count(PROFILES)).toBe(1)
  })

  it('returns to the login screen with an explanation when the server rejects the token', async () => {
    const h = harness(profileAnswers(() => json(401, { code: 'PGRST301', message: 'JWT expired' })))
    await h.store.getState().init()
    expect(h.store.getState()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.sessionEnded })
    expect(h.sent.find((request) => request.url.pathname === LOGOUT)?.url.searchParams.get('scope')).toBe('local')
  })

  it.each([
    [
      'the profiles table is missing',
      () => json(404, { code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" }),
    ],
    ['the profiles grant is missing', () => json(403, { code: '42501', message: 'permission denied for table profiles' })],
  ])('says the user is not set up when %s', async (_name, fail) => {
    const h = harness(profileAnswers(fail))
    await h.store.getState().init()
    expect(h.store.getState()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
  })

  it('signs in when the profile is there and active', async () => {
    const profile = {
      id: USER.id,
      email: USER.email,
      display_name: 'דנה',
      role: 'employee',
      is_active: true,
      must_change_password: false,
      default_remind_min: 30,
    }
    const h = harness(profileAnswers(() => json(200, profile)))
    await h.store.getState().init()
    expect(h.store.getState()).toMatchObject({ status: 'signedIn', profile })
  })

  it('reads the default reminder of the person with the profile, because a new task starts with it', async () => {
    const h = harness(
      profileAnswers(() =>
        json(200, { id: USER.id, email: USER.email, display_name: 'דנה', role: 'employee', is_active: true, must_change_password: false, default_remind_min: 0 }),
      ),
    )
    await h.store.getState().init()
    const asked = h.sent.find((request) => request.url.pathname === PROFILES)
    expect(asked?.url.searchParams.get('select')).toBe('id,email,display_name,role,is_active,must_change_password,default_remind_min')
    expect(h.store.getState().profile?.default_remind_min).toBe(0)
  })
})

describe('start-up offline with an expired token', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // The usual way to open the app offline: the access token is an hour old, so the library tries
  // to renew it, and keeps trying for about 25 seconds before it gives up.
  it('offers a retry after a few seconds instead of 25 seconds of "loading", and still keeps the session', async () => {
    vi.useFakeTimers()
    const h = harness(offline, { secondsValid: -100 })
    const started = h.store.getState().init()

    await vi.advanceTimersByTimeAsync(SLOW_START_MS)
    expect(h.store.getState().status).toBe('unreachable')

    await vi.advanceTimersByTimeAsync(60_000) // the library finishes its own retries
    await started
    expect(h.store.getState().status).toBe('unreachable')
    expect(h.count(LOGOUT)).toBe(0)
    expect(h.hasStoredSession()).toBe(true)
  })
})

describe('sign-in', () => {
  const tokenAnswers = (answer: () => Response) => (sent: Sent) =>
    sent.url.pathname === '/auth/v1/token' ? answer() : noContent()

  it('shows the Hebrew wrong-password message for the real error the server sends', async () => {
    const h = harness(
      tokenAnswers(() => json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })),
      { withSession: false },
    )
    await h.store.getState().init()
    const ok = await h.store.getState().signIn('dana@example.com', 'wrong-password')
    expect(ok).toBe(false)
    expect(h.store.getState().error).toBe(AUTH_MESSAGES.invalidCredentials)
  })

  it('explains an account that was created without confirming its email', async () => {
    const h = harness(
      tokenAnswers(() => json(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' })),
      { withSession: false },
    )
    await h.store.getState().init()
    await h.store.getState().signIn('dana@example.com', 'secret-pass')
    expect(h.store.getState().error).toBe(AUTH_MESSAGES.emailNotConfirmed)
  })
})
