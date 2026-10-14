import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeGateway, DANA } from '../../test/fakeGateway'
import { createAuthStore, SLOW_START_MS } from './authStore'
import { AUTH_MESSAGES } from './errors'

function setup() {
  const fake = createFakeGateway()
  const store = createAuthStore(fake.gateway)
  return { fake, store, state: () => store.getState() }
}

const networkError = () => Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' })

describe('init', () => {
  it('starts in the loading state', () => {
    expect(setup().state().status).toBe('loading')
  })

  it('becomes signed out when there is no stored session', async () => {
    const { state } = setup()
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: null })
  })

  it('restores a stored session together with the profile', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    await state().init()
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
    expect(fake.fetchProfile).toHaveBeenCalledWith(DANA.id)
  })

  it('signs out a stored session whose profile is missing, and explains why', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockResolvedValue(null)
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.notMember })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out a stored session whose profile is deactivated', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
  })

  it('keeps the stored session and reports "unreachable" when the profile cannot be fetched offline', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await state().init()
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('keeps the stored session when an expired token cannot be renewed offline', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockRejectedValue(networkError())
    await state().init()
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('falls back to signed out on any other start-up failure', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockRejectedValue(new Error('storage corrupted'))
    await state().init()
    expect(state().status).toBe('signedOut')
  })

  it('keeps the stored session when the profile request meets server trouble, however it is reported', async () => {
    for (const status of [500, 502, 503]) {
      const { fake, state } = setup()
      fake.getStoredUserId.mockResolvedValue(DANA.id)
      fake.fetchProfile.mockRejectedValue(Object.assign(new Error('server trouble'), { status }))
      await state().init()
      expect(state().status, String(status)).toBe('unreachable')
      expect(fake.signOut, String(status)).not.toHaveBeenCalled()
    }
  })

  it('returns to the login screen with an explanation when the server rejects the token', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValue(Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 }))
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.sessionEnded })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('treats a missing profiles table or grant like a missing profile', async () => {
    for (const status of [403, 404]) {
      const { fake, state } = setup()
      fake.getStoredUserId.mockResolvedValue(DANA.id)
      fake.fetchProfile.mockRejectedValue(Object.assign(new Error('not set up'), { status }))
      await state().init()
      expect(state(), String(status)).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
    }
  })

  it('shows the generic message for a failure nobody can classify', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }))
    await state().init()
    expect(state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.generic })
  })
})

describe('slow start-up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers a retry instead of an endless "loading" when the stored session cannot be checked in time', async () => {
    const { fake, state } = setup()
    let answer: (id: string | null) => void = () => {}
    fake.getStoredUserId.mockImplementation(() => new Promise<string | null>((resolve) => (answer = resolve)))

    const started = state().init()
    await vi.advanceTimersByTimeAsync(SLOW_START_MS - 1)
    expect(state().status).toBe('loading')

    await vi.advanceTimersByTimeAsync(1)
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()

    // The slow answer is not thrown away: the user lands in the app without pressing anything.
    answer(DANA.id)
    await started
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })

  it('stays quiet when start-up finishes in time', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    await state().init()
    await vi.advanceTimersByTimeAsync(SLOW_START_MS * 2)
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })

  it('drops the late result of an earlier start-up once the user pressed retry', async () => {
    const { fake, state } = setup()
    let answerFirst: (id: string | null) => void = () => {}
    fake.getStoredUserId.mockImplementationOnce(() => new Promise<string | null>((resolve) => (answerFirst = resolve)))
    fake.getStoredUserId.mockResolvedValue(DANA.id)

    const first = state().init()
    await vi.advanceTimersByTimeAsync(SLOW_START_MS)
    expect(state().status).toBe('unreachable')

    await state().retry()
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })

    // The first attempt finally answers "no session". It must not sign anyone out now.
    answerFirst(null)
    await first
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })
})

describe('retry', () => {
  it('recovers from "unreachable" once the server answers', async () => {
    const { fake, state } = setup()
    fake.getStoredUserId.mockResolvedValue(DANA.id)
    fake.fetchProfile.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await state().init()
    expect(state().status).toBe('unreachable')

    await state().retry()
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })
})

describe('signIn', () => {
  it('trims and lowercases the email before sending it', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('  Dana@Example.COM ', 'secret pass ')
    expect(fake.signIn).toHaveBeenCalledWith('dana@example.com', 'secret pass ')
  })

  it('signs in and loads the profile', async () => {
    const { state } = setup()
    await state().init()
    const ok = await state().signIn('dana@example.com', 'secret')
    expect(ok).toBe(true)
    expect(state()).toMatchObject({ status: 'signedIn', profile: DANA, error: null, busy: false })
  })

  it('shows a Hebrew message for wrong credentials and stays signed out', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValue({ code: 'invalid_credentials', message: 'Invalid login credentials' })
    const ok = await state().signIn('dana@example.com', 'wrong')
    expect(ok).toBe(false)
    expect(state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.invalidCredentials, busy: false })
  })

  it('tells a deactivated user so, using the backend ban code', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValue({ code: 'user_banned', message: 'User is banned' })
    await state().signIn('dana@example.com', 'secret')
    expect(state().error).toBe(AUTH_MESSAGES.banned)
  })

  it('signs the user straight back out when they have no active profile', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    const ok = await state().signIn('dana@example.com', 'secret')
    expect(ok).toBe(false)
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.notMember })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('reports "unreachable" when the profile cannot be fetched right after signing in', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    await state().signIn('dana@example.com', 'secret')
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('reports "unreachable" when the server has trouble answering right after signing in', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.fetchProfile.mockRejectedValue(Object.assign(new Error('server trouble'), { status: 503 }))
    await state().signIn('dana@example.com', 'secret')
    expect(state().status).toBe('unreachable')
    expect(fake.signOut).not.toHaveBeenCalled()
  })

  it('ignores a second submit while the first is still in flight', async () => {
    const { fake, state } = setup()
    await state().init()
    let release: (id: string) => void = () => {}
    fake.signIn.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)))

    const first = state().signIn('dana@example.com', 'secret')
    const second = await state().signIn('dana@example.com', 'secret')
    expect(second).toBe(false)
    expect(state().busy).toBe(true)

    release(DANA.id)
    await first
    expect(fake.signIn).toHaveBeenCalledTimes(1)
    expect(state().busy).toBe(false)
  })

  it('clears an earlier error when a new attempt starts', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.signIn.mockRejectedValueOnce({ code: 'invalid_credentials' })
    await state().signIn('dana@example.com', 'wrong')
    expect(state().error).not.toBeNull()

    await state().signIn('dana@example.com', 'right')
    expect(state().error).toBeNull()
  })
})

describe('signOut', () => {
  it('clears the profile and calls the backend', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    await state().signOut()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: null })
    expect(fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('still ends locally when the backend call fails', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    fake.signOut.mockRejectedValue(new Error('offline'))
    await state().signOut()
    expect(state().status).toBe('signedOut')
  })

  it('does not show "session ended" for the sign-out event that the user caused', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    await state().signOut()
    fake.endSessionFromServer()
    expect(state().error).toBeNull()
  })
})

describe('session ended by the server', () => {
  it('returns a signed-in user to the login screen with an explanation', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    fake.endSessionFromServer()
    expect(state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.sessionEnded })
  })

  it('is ignored when nobody is signed in', async () => {
    const { fake, state } = setup()
    await state().init()
    fake.endSessionFromServer()
    expect(state()).toMatchObject({ status: 'signedOut', error: null })
  })
})

describe('dispose', () => {
  it('stops listening for server-side session ends', async () => {
    const { fake, state } = setup()
    await state().init()
    await state().signIn('dana@example.com', 'secret')
    state().dispose()
    fake.endSessionFromServer()
    expect(state().status).toBe('signedIn')
  })
})
