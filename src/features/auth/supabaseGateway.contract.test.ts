// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthStore, SLOW_START_MS } from './authStore'
import { AUTH_MESSAGES, PASSWORD_MESSAGES, PROFILE_MESSAGES } from './errors'
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
  /** What was sent, when it was text (the requests of the auth service and the database API are JSON). */
  body: string
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
        const request = { method: init?.method ?? 'GET', url: new URL(String(input)), body: typeof init?.body === 'string' ? init.body : '' }
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

// Choosing a password is two requests: the auth service sets it, and a function of the database says that the
// person has chosen one. These run the real client against the answers that the services really give.

const AUTH_USER = '/auth/v1/user'
const CLEAR = '/rest/v1/rpc/clear_must_change_password'
const UPDATE_PROFILE = '/rest/v1/rpc/update_my_profile'
const NEW_PASSWORD = 'a-password-of-my-own'
const ASKED_TO_CHOOSE = {
  id: USER.id,
  email: USER.email,
  display_name: 'דנה',
  role: 'employee',
  is_active: true,
  must_change_password: true,
  default_remind_min: 15,
}

/** The services as they are when all is well, except for the paths that the test names. */
function world(answers: Record<string, () => Response>, profile: object = ASKED_TO_CHOOSE) {
  return (sent: Sent): Response => {
    const answer = answers[sent.url.pathname]
    if (answer) return answer()
    if (sent.url.pathname === PROFILES) return json(200, profile)
    if (sent.url.pathname === AUTH_USER) return json(200, USER)
    return noContent()
  }
}

describe('choosing a password', () => {
  it('sends the new password to the auth service as an update of the user, and nothing of the person with it', async () => {
    const h = harness(world({}))
    await h.gateway.changePassword(NEW_PASSWORD)
    const update = h.sent.find((request) => request.url.pathname === AUTH_USER)
    expect(update?.method).toBe('PUT')
    // The two nulls are the library's own (the fields of PKCE); the e-mail and the id of the person are not sent.
    expect(JSON.parse(update?.body ?? '')).toEqual({ password: NEW_PASSWORD, code_challenge: null, code_challenge_method: null })
  })

  it('sets the password, then says it with the function of the database, and the app opens', async () => {
    const h = harness(world({}))
    await h.store.getState().init()
    expect(h.store.getState().profile?.must_change_password).toBe(true)

    expect(await h.store.getState().changePassword(NEW_PASSWORD)).toBeNull()

    const steps = h.sent.filter((request) => request.url.pathname === AUTH_USER || request.url.pathname === CLEAR)
    expect(steps.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([`PUT ${AUTH_USER}`, `POST ${CLEAR}`])
    expect(h.store.getState()).toMatchObject({ status: 'signedIn', profile: { ...ASKED_TO_CHOOSE, must_change_password: false } })
  })

  it('does not say it again for a person who was not asked, and sends no more than the password', async () => {
    const h = harness(world({}, { ...ASKED_TO_CHOOSE, must_change_password: false }))
    await h.store.getState().init()
    expect(await h.store.getState().changePassword(NEW_PASSWORD)).toBeNull()
    expect(h.count(CLEAR)).toBe(0)
    expect(h.count(AUTH_USER)).toBe(1)
  })

  it.each([
    [
      'the password that the person already has',
      () => json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }),
      PASSWORD_MESSAGES.same_password,
    ],
    [
      'a password that is too short',
      () => json(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 10 characters.', weak_password: { reasons: ['length'] } }),
      PASSWORD_MESSAGES.weak_password,
    ],
    [
      'a password that is too long',
      () => json(400, { code: 400, error_code: 'validation_failed', msg: 'Password cannot be longer than 72 characters' }),
      PASSWORD_MESSAGES.generic,
    ],
    ['a token that the server rejects', () => json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' }), PASSWORD_MESSAGES.session],
    [
      'a session that the server no longer has',
      () => json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }),
      PASSWORD_MESSAGES.session,
    ],
    ['a server in trouble', () => json(500, { code: 500, error_code: 'unexpected_failure', msg: 'boom' }), PASSWORD_MESSAGES.network],
    ['a proxy that answers with a page', () => new Response('<html>Bad gateway</html>', { status: 502 }), PASSWORD_MESSAGES.network],
    ['no connection at all', offline, PASSWORD_MESSAGES.network],
  ])('tells the person, in a sentence of ours, about %s', async (_what, answer, sentence) => {
    const h = harness(world({ [AUTH_USER]: answer }))
    await h.store.getState().init()
    expect(await h.store.getState().changePassword(NEW_PASSWORD)).toBe(sentence)
    // Nothing was said to the database, and the person is where they were.
    expect(h.count(CLEAR)).toBe(0)
    expect(h.store.getState()).toMatchObject({ status: 'signedIn', profile: ASKED_TO_CHOOSE })
  })

  it('tells the person that there is no session, when the stored one is gone', async () => {
    const h = harness(world({}), { withSession: false })
    await expect(h.gateway.changePassword(NEW_PASSWORD)).rejects.toMatchObject({ name: 'AuthSessionMissingError' })
    expect(h.count(AUTH_USER)).toBe(0)
  })

  it('tells the person to try again when the word about it does not get through, and the second try finishes the work', async () => {
    let words = 0
    let sets = 0
    const h = harness(
      world({
        [CLEAR]: () => (++words === 1 ? json(503, { message: 'server in trouble' }) : noContent()),
        // The first time the password is new. The second time it is the one that the server has, and it says so.
        [AUTH_USER]: () =>
          ++sets === 1 ? json(200, USER) : json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }),
      }),
    )
    await h.store.getState().init()

    expect(await h.store.getState().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.incomplete)
    expect(h.store.getState().profile?.must_change_password).toBe(true)

    expect(await h.store.getState().changePassword(NEW_PASSWORD)).toBeNull()
    expect(h.store.getState().profile?.must_change_password).toBe(false)
    expect(h.count(CLEAR)).toBe(2)
  })

  it('does not open the app for the temporary password typed again', async () => {
    const h = harness(
      world({ [AUTH_USER]: () => json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' }) }),
    )
    await h.store.getState().init()
    expect(await h.store.getState().changePassword('the-temporary-one')).toBe(PASSWORD_MESSAGES.same_password)
    expect(h.count(CLEAR)).toBe(0)
    expect(h.store.getState().profile?.must_change_password).toBe(true)
  })
})

describe('saving the profile', () => {
  const INPUT = { display_name: 'דנה כהן', default_remind_min: 30 }
  const SAVED = { ...ASKED_TO_CHOOSE, must_change_password: false, ...INPUT }

  it('calls the function with the parameters it names, reads the row, and the store shows what is there', async () => {
    const h = harness(world({}, SAVED))
    await h.store.getState().init()
    expect(await h.store.getState().saveProfile(INPUT)).toBeNull()

    const call = h.sent.find((request) => request.url.pathname === UPDATE_PROFILE)
    expect(call?.method).toBe('POST')
    expect(JSON.parse(call?.body ?? '')).toEqual({ p_display_name: 'דנה כהן', p_default_remind_min: 30 })
    expect(h.sent.filter((request) => request.url.pathname === PROFILES).at(-1)?.url.searchParams.get('id')).toBe(`eq.${USER.id}`)
    expect(h.store.getState().profile).toEqual(SAVED)
  })

  it('says that the name is taken for the answer that the database really gives, and changes nothing', async () => {
    const h = harness(
      world({
        [UPDATE_PROFILE]: () =>
          json(409, {
            code: '23505',
            details: 'Key (lower(display_name::text))=(דנה כהן) already exists.',
            hint: null,
            message: 'duplicate key value violates unique constraint "profiles_display_name_key"',
          }),
      }),
    )
    await h.store.getState().init()
    expect(await h.store.getState().saveProfile(INPUT)).toBe(PROFILE_MESSAGES.name_taken)
    expect(h.store.getState().profile).toEqual(ASKED_TO_CHOOSE)
  })

  it.each([
    ['a token that expired', () => json(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }), PROFILE_MESSAGES.session],
    [
      'a person who is no longer a member',
      () => json(403, { code: '42501', details: null, hint: null, message: 'only an active member can change their profile' }),
      PROFILE_MESSAGES.session,
    ],
    ['a value that the database refuses', () => json(400, { code: '22023', details: null, hint: null, message: 'the display name cannot be empty' }), PROFILE_MESSAGES.invalid],
    ['a server in trouble', () => json(500, { code: 'XX000', details: null, hint: null, message: 'boom' }), PROFILE_MESSAGES.network],
    ['no connection at all', offline, PROFILE_MESSAGES.network],
  ])('tells the person about %s', async (_what, answer, sentence) => {
    const h = harness(world({ [UPDATE_PROFILE]: answer }))
    await h.store.getState().init()
    expect(await h.store.getState().saveProfile(INPUT)).toBe(sentence)
    expect(h.store.getState().profile).toEqual(ASKED_TO_CHOOSE)
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
