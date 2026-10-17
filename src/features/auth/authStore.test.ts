import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import { createAuthStore, SLOW_START_MS } from './authStore'
import { AUTH_MESSAGES, PASSWORD_MESSAGES, PROFILE_MESSAGES } from './errors'
import type { Profile } from './types'

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

describe('recheck', () => {
  async function signedIn() {
    const t = setup()
    t.fake.getStoredUserId.mockResolvedValue(DANA.id)
    await t.state().init()
    expect(t.state().status).toBe('signedIn')
    t.fake.fetchProfile.mockClear()
    return t
  }
  const failure = (status: number) => Object.assign(new Error(`status ${status}`), { status })

  it('asks for the profile of the signed-in user and keeps what it learns', async () => {
    const t = await signedIn()
    t.fake.fetchProfile.mockResolvedValue({ ...DANA, display_name: 'דנה כהן', role: 'admin' })
    await t.state().recheck()
    expect(t.fake.fetchProfile).toHaveBeenCalledWith(DANA.id)
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: { display_name: 'דנה כהן', role: 'admin' } })
  })

  it('signs the user out, and says why, when the profile has been deactivated', async () => {
    const t = await signedIn()
    t.fake.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    await t.state().recheck()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.notMember })
    expect(t.fake.signOut).toHaveBeenCalledTimes(1)
  })

  it('does the same when the profile is gone', async () => {
    const t = await signedIn()
    t.fake.fetchProfile.mockResolvedValue(null)
    await t.state().recheck()
    expect(t.state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
  })

  it('treats a missing table or grant like a missing profile', async () => {
    for (const status of [403, 404]) {
      const t = await signedIn()
      t.fake.fetchProfile.mockRejectedValue(failure(status))
      await t.state().recheck()
      expect(t.state(), String(status)).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.notMember })
    }
  })

  it('signs the user out with "the session ended" when the server rejects the token', async () => {
    const t = await signedIn()
    t.fake.fetchProfile.mockRejectedValue(failure(401))
    await t.state().recheck()
    expect(t.state()).toMatchObject({ status: 'signedOut', error: AUTH_MESSAGES.sessionEnded })
  })

  it('changes nothing when the server cannot be reached, or has trouble, or fails in a way nobody can classify', async () => {
    for (const error of [new TypeError('Failed to fetch'), failure(0), failure(503), failure(400)]) {
      const t = await signedIn()
      t.fake.fetchProfile.mockRejectedValue(error)
      await t.state().recheck()
      expect(t.state(), String(error)).toMatchObject({ status: 'signedIn', profile: DANA })
      expect(t.fake.signOut).not.toHaveBeenCalled()
    }
  })

  it('does nothing when nobody is signed in', async () => {
    const t = setup()
    await t.state().init()
    await t.state().recheck()
    expect(t.fake.fetchProfile).not.toHaveBeenCalled()
    expect(t.state().status).toBe('signedOut')
  })

  it('does not bring back a user who signed out while the answer was on its way', async () => {
    const t = await signedIn()
    let answer: (profile: typeof DANA) => void = () => undefined
    t.fake.fetchProfile.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const checking = t.state().recheck()
    await t.state().signOut()
    answer(DANA)
    await checking
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
  })

  it('does not sign out a user who signed in again while the answer was on its way', async () => {
    const t = await signedIn()
    let answer: (profile: null) => void = () => undefined
    t.fake.fetchProfile.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const checking = t.state().recheck()
    await t.state().signOut()
    t.fake.fetchProfile.mockResolvedValue(DANA)
    await t.state().signIn('dana@example.com', 'secret-pass')
    answer(null) // the old answer says "no profile"
    await checking
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: DANA })
  })

  it('shows at once a profile that has been asked to choose a new password, so that the app is held back', async () => {
    const t = await signedIn()
    t.fake.fetchProfile.mockResolvedValue({ ...DANA, must_change_password: true })
    await t.state().recheck()
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: { must_change_password: true } })
  })
})

// The password that a person chooses for themselves. The server has two steps for it (the password, then
// the word that the person has chosen one), and either can fail without the other, so the store has to
// cope with the half that was done.

const NEW_PASSWORD = 'a-password-of-my-own'
const MUST_CHANGE: Profile = { ...DANA, must_change_password: true }
const failure = (fields: object) => Object.assign(new Error('the server said no'), fields)
const SAME = failure({ name: 'AuthApiError', code: 'same_password', status: 422 })

/** Signed in as somebody who has to choose a password. */
async function signedInWithTemporaryPassword() {
  const t = setup()
  t.fake.getStoredUserId.mockResolvedValue(DANA.id)
  t.fake.fetchProfile.mockResolvedValue(MUST_CHANGE)
  await t.state().init()
  expect(t.state()).toMatchObject({ status: 'signedIn', profile: MUST_CHANGE })
  return t
}

async function signedInAsUsual() {
  const t = setup()
  t.fake.getStoredUserId.mockResolvedValue(DANA.id)
  await t.state().init()
  return t
}

describe('changePassword', () => {
  it('sets the password, then says that the person has one of their own, and the profile no longer asks', async () => {
    const t = await signedInWithTemporaryPassword()
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
    expect(t.fake.changePassword).toHaveBeenCalledExactlyOnceWith(NEW_PASSWORD)
    expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
    expect(t.fake.changePassword.mock.invocationCallOrder[0]).toBeLessThan(t.fake.clearMustChangePassword.mock.invocationCallOrder[0])
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: { ...DANA, must_change_password: false } })
  })

  it('does not say it for a person who was never asked: the profile page changes a password the same way', async () => {
    const t = await signedInAsUsual()
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
    expect(t.fake.changePassword).toHaveBeenCalledExactlyOnceWith(NEW_PASSWORD)
    expect(t.fake.clearMustChangePassword).not.toHaveBeenCalled()
    expect(t.state().profile).toEqual(DANA)
  })

  it.each([
    ['the temporary password typed again', SAME, PASSWORD_MESSAGES.same_password],
    ['a weak password', failure({ name: 'AuthWeakPasswordError', code: 'weak_password', status: 422 }), PASSWORD_MESSAGES.weak_password],
    ['a session that has ended', failure({ name: 'AuthSessionMissingError', status: 400 }), PASSWORD_MESSAGES.session],
    ['a server that cannot be reached', new TypeError('Failed to fetch'), PASSWORD_MESSAGES.network],
    ['a failure that nobody foresaw', failure({ status: 400 }), PASSWORD_MESSAGES.generic],
  ])('answers with a sentence, and changes nothing, after %s', async (_what, error, sentence) => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockRejectedValue(error)
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(sentence)
    expect(t.fake.clearMustChangePassword).not.toHaveBeenCalled()
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: MUST_CHANGE })
    expect(t.fake.signOut).not.toHaveBeenCalled()
  })

  describe('when the password was set and the word about it was not', () => {
    async function halfDone() {
      const t = await signedInWithTemporaryPassword()
      t.fake.clearMustChangePassword.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.incomplete)
      expect(t.state().profile).toEqual(MUST_CHANGE)
      // From now on the server has this password, and says so to the same one.
      t.fake.changePassword.mockRejectedValue(SAME)
      return t
    }

    it('tells the person to try again, and the second try with the same password finishes the work', async () => {
      const t = await halfDone()
      expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
      expect(t.fake.changePassword).toHaveBeenCalledTimes(2)
      expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(2)
      expect(t.state().profile).toEqual({ ...DANA, must_change_password: false })
    })

    it('keeps telling the person to try again as long as the word does not get through', async () => {
      const t = await halfDone()
      t.fake.clearMustChangePassword.mockRejectedValueOnce(failure({ status: 503 }))
      expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.incomplete)
      expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
      expect(t.state().profile?.must_change_password).toBe(false)
    })

    it('sets another password when the person types another one, and then finishes', async () => {
      const t = await halfDone()
      t.fake.changePassword.mockResolvedValue(undefined)
      expect(await t.state().changePassword('another-one-of-mine')).toBeNull()
      expect(t.fake.changePassword).toHaveBeenLastCalledWith('another-one-of-mine')
      expect(t.state().profile?.must_change_password).toBe(false)
    })

    it('finishes the work only for "the same", and for no other refusal', async () => {
      const t = await halfDone()
      t.fake.changePassword.mockRejectedValue(failure({ name: 'AuthWeakPasswordError', code: 'weak_password', status: 422 }))
      expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.weak_password)
      t.fake.changePassword.mockRejectedValue(new TypeError('Failed to fetch'))
      expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.network)
      expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
      expect(t.state().profile).toEqual(MUST_CHANGE)
    })

    it('does not take "the same" for done once the person has signed out and in again: that is the old password typed again', async () => {
      const t = await halfDone()
      await t.state().signOut()
      await t.state().signIn('dana@example.com', 'the-temporary-one')
      expect(t.state().profile).toEqual(MUST_CHANGE)
      expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.same_password)
      expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
      expect(t.state().profile).toEqual(MUST_CHANGE)
    })
  })

  it('does not take "the same" for done when this app never set a password: the temporary one typed again must not open the app', async () => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockRejectedValue(SAME)
    expect(await t.state().changePassword('the-temporary-one')).toBe(PASSWORD_MESSAGES.same_password)
    expect(await t.state().changePassword('the-temporary-one')).toBe(PASSWORD_MESSAGES.same_password)
    expect(t.fake.clearMustChangePassword).not.toHaveBeenCalled()
    expect(t.state().profile).toEqual(MUST_CHANGE)
  })

  it('does not take "the same" for done after a failure that was not a yes: the server may or may not have applied it', async () => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.network)
    t.fake.changePassword.mockRejectedValue(SAME)
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.same_password)
    expect(t.fake.clearMustChangePassword).not.toHaveBeenCalled()
  })

  it('does not finish anything for a person whose flag is already off: "the same" is just an answer', async () => {
    const t = await signedInWithTemporaryPassword()
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
    // Later, from the profile page (the flag is off), the server says "the same": there is no step to finish.
    t.fake.changePassword.mockRejectedValue(SAME)
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.same_password)
    expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
  })

  it('does not carry a yes from one request for a password to the next: after a reset, the new temporary password typed again is refused', async () => {
    const t = await signedInWithTemporaryPassword()
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
    expect(t.state().profile?.must_change_password).toBe(false)

    // An administrator resets the password: the profile asks again, in the same session of the app.
    t.fake.fetchProfile.mockResolvedValue(MUST_CHANGE)
    await t.state().recheck()
    expect(t.state().profile?.must_change_password).toBe(true)

    t.fake.changePassword.mockRejectedValue(SAME)
    expect(await t.state().changePassword('the-new-temporary-one')).toBe(PASSWORD_MESSAGES.same_password)
    expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
    expect(t.state().profile?.must_change_password).toBe(true)
  })

  it('does nothing, and says the session is over, when nobody is signed in', async () => {
    const t = setup()
    await t.state().init()
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.session)
    expect(t.fake.changePassword).not.toHaveBeenCalled()
  })

  it('sends one request for a second call that comes while the first is on its way, and gives both the same answer', async () => {
    const t = await signedInWithTemporaryPassword()
    let release: () => void = () => undefined
    t.fake.changePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const first = t.state().changePassword(NEW_PASSWORD)
    const second = t.state().changePassword(NEW_PASSWORD)
    release()
    expect(await Promise.all([first, second])).toEqual([null, null])
    expect(t.fake.changePassword).toHaveBeenCalledTimes(1)
    expect(t.fake.clearMustChangePassword).toHaveBeenCalledTimes(1)
  })

  it('takes a new call once the last one is over, whether it worked or not', async () => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockRejectedValueOnce(failure({ status: 400 }))
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.generic)
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
    expect(t.fake.changePassword).toHaveBeenCalledTimes(2)
  })

  it('takes a new call after a gateway that throws at once, without a promise', async () => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockImplementationOnce(() => {
      throw failure({ status: 400 })
    })
    expect(await t.state().changePassword(NEW_PASSWORD)).toBe(PASSWORD_MESSAGES.generic)
    expect(await t.state().changePassword(NEW_PASSWORD)).toBeNull()
  })

  it('does not bring back a person who signed out while the password was on its way, and does not send the word about it', async () => {
    const t = await signedInWithTemporaryPassword()
    let release: () => void = () => undefined
    t.fake.changePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const changing = t.state().changePassword(NEW_PASSWORD)
    await t.state().signOut()
    release()
    expect(await changing).toBeNull()
    expect(t.fake.clearMustChangePassword).not.toHaveBeenCalled()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
  })

  it('does not put the profile of a person back after they signed out while the word about the password was on its way', async () => {
    const t = await signedInWithTemporaryPassword()
    let release: () => void = () => undefined
    t.fake.clearMustChangePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const changing = t.state().changePassword(NEW_PASSWORD)
    await vi.waitFor(() => expect(t.fake.clearMustChangePassword).toHaveBeenCalled())
    await t.state().signOut()
    release()
    expect(await changing).toBeNull()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
  })

  it('does not turn off the question of another person who signed in while the word about the password was on its way', async () => {
    const t = await signedInWithTemporaryPassword()
    let release: () => void = () => undefined
    t.fake.clearMustChangePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const changing = t.state().changePassword(NEW_PASSWORD)
    await vi.waitFor(() => expect(t.fake.clearMustChangePassword).toHaveBeenCalled())
    await t.state().signOut()
    const other = { ...MUST_CHANGE, id: 'u-other', email: 'other@example.com' }
    t.fake.fetchProfile.mockResolvedValue(other)
    await t.state().signIn('other@example.com', 'the-temporary-one')
    release()
    await changing
    expect(t.state().profile).toEqual(other)
  })

  it('keeps the profile that a re-check brought in the meantime, and only turns the question off', async () => {
    const t = await signedInWithTemporaryPassword()
    let release: () => void = () => undefined
    t.fake.clearMustChangePassword.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const changing = t.state().changePassword(NEW_PASSWORD)
    await vi.waitFor(() => expect(t.fake.clearMustChangePassword).toHaveBeenCalled())
    t.fake.fetchProfile.mockResolvedValue({ ...MUST_CHANGE, display_name: 'דנה כהן' })
    await t.state().recheck()
    release()
    await changing
    expect(t.state().profile).toEqual({ ...DANA, display_name: 'דנה כהן', must_change_password: false })
  })

  it('keeps no password in its state, whether the change worked or not', async () => {
    const t = await signedInWithTemporaryPassword()
    t.fake.changePassword.mockRejectedValueOnce(failure({ status: 400, message: NEW_PASSWORD }))
    await t.state().changePassword(NEW_PASSWORD)
    expect(JSON.stringify(t.state())).not.toContain(NEW_PASSWORD)
    await t.state().changePassword(NEW_PASSWORD)
    expect(JSON.stringify(t.state())).not.toContain(NEW_PASSWORD)
  })
})

describe('saveProfile', () => {
  const INPUT = { display_name: 'דנה כהן', default_remind_min: 30 }

  it('sends the two fields, and the profile becomes what the server says it now is', async () => {
    const t = await signedInAsUsual()
    t.fake.updateMyProfile.mockResolvedValue({ ...DANA, display_name: 'דנה כהן (המוקד)', default_remind_min: 30 })
    expect(await t.state().saveProfile(INPUT)).toBeNull()
    expect(t.fake.updateMyProfile).toHaveBeenCalledExactlyOnceWith(INPUT)
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: { display_name: 'דנה כהן (המוקד)', default_remind_min: 30 } })
  })

  it.each([
    ['a name that a colleague has', failure({ code: '23505', status: 409, message: 'duplicate key value violates unique constraint "profiles_display_name_key"' }), PROFILE_MESSAGES.name_taken],
    ['a refusal of the database', failure({ code: '22023', status: 400 }), PROFILE_MESSAGES.invalid],
    ['a session that has ended', failure({ code: 'PGRST301', status: 401 }), PROFILE_MESSAGES.session],
    ['a server that cannot be reached', new TypeError('Failed to fetch'), PROFILE_MESSAGES.network],
    ['a failure that nobody foresaw', failure({ status: 400 }), PROFILE_MESSAGES.generic],
  ])('answers with a sentence, and changes nothing, after %s', async (_what, error, sentence) => {
    const t = await signedInAsUsual()
    t.fake.updateMyProfile.mockRejectedValue(error)
    expect(await t.state().saveProfile(INPUT)).toBe(sentence)
    expect(t.state()).toMatchObject({ status: 'signedIn', profile: DANA })
    expect(t.fake.signOut).not.toHaveBeenCalled()
  })

  it('does nothing, and says the session is over, when nobody is signed in', async () => {
    const t = setup()
    await t.state().init()
    expect(await t.state().saveProfile(INPUT)).toBe(PROFILE_MESSAGES.session)
    expect(t.fake.updateMyProfile).not.toHaveBeenCalled()
  })

  it('does not bring back a person who signed out while the profile was on its way', async () => {
    const t = await signedInAsUsual()
    let release: (profile: Profile) => void = () => undefined
    t.fake.updateMyProfile.mockReturnValue(new Promise<Profile>((resolve) => (release = resolve)))
    const saving = t.state().saveProfile(INPUT)
    await t.state().signOut()
    release({ ...DANA, ...INPUT })
    expect(await saving).toBeNull()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
  })

  it('does not bring back the profile of a person whose session the server ended while it was on its way', async () => {
    const t = await signedInAsUsual()
    let release: (profile: Profile) => void = () => undefined
    t.fake.updateMyProfile.mockReturnValue(new Promise<Profile>((resolve) => (release = resolve)))
    const saving = t.state().saveProfile(INPUT)
    t.fake.endSessionFromServer()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
    release({ ...DANA, ...INPUT })
    expect(await saving).toBeNull()
    expect(t.state()).toMatchObject({ status: 'signedOut', profile: null })
  })

  it('does not put the profile of one person on another who signed in meanwhile', async () => {
    const t = await signedInAsUsual()
    let release: (profile: Profile) => void = () => undefined
    t.fake.updateMyProfile.mockReturnValue(new Promise<Profile>((resolve) => (release = resolve)))
    const saving = t.state().saveProfile(INPUT)
    await t.state().signOut()
    t.fake.fetchProfile.mockResolvedValue(OWNER)
    await t.state().signIn('owner@example.com', 'secret-pass')
    release({ ...DANA, ...INPUT })
    await saving
    expect(t.state().profile).toEqual(OWNER)
  })
})
