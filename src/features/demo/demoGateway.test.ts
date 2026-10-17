import { describe, expect, it, vi } from 'vitest'
import { createAuthStore } from '../auth/authStore'
import { PROFILE_MESSAGES } from '../auth/errors'
import { createMemoryDirectory } from '../tasks/memoryGateways'
import { createDemoGateway, DEMO_PROFILE } from './demoGateway'

describe('demo gateway', () => {
  it('starts signed in as the demo user, so the app opens straight on the home screen', async () => {
    const gateway = createDemoGateway()
    expect(await gateway.getStoredUserId()).toBe(DEMO_PROFILE.id)
    expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toEqual(DEMO_PROFILE)
  })

  it('uses an active admin that is never asked to change a password, with an address that cannot exist', () => {
    expect(DEMO_PROFILE).toMatchObject({ role: 'admin', is_active: true, must_change_password: false, default_remind_min: 15 })
    expect(DEMO_PROFILE.email).toMatch(/\.invalid$/)
  })

  it('forgets the session on sign-out, and signs in again with any email and password', async () => {
    const gateway = createDemoGateway()
    await gateway.signOut()
    expect(await gateway.getStoredUserId()).toBeNull()
    expect(await gateway.signIn('anyone@example.com', 'whatever')).toBe(DEMO_PROFILE.id)
    expect(await gateway.getStoredUserId()).toBe(DEMO_PROFILE.id)
  })

  it('gives every gateway its own session', async () => {
    const first = createDemoGateway()
    const second = createDemoGateway()
    await first.signOut()
    expect(await second.getStoredUserId()).toBe(DEMO_PROFILE.id)
  })

  it('never reports a session ended by a server, and can be unsubscribed', () => {
    const callback = vi.fn()
    const off = createDemoGateway().onSessionEnded(callback)
    off()
    expect(callback).not.toHaveBeenCalled()
  })

  it('gives a copy of the profile, so that nobody changes the demo user by changing what they were given', async () => {
    const gateway = createDemoGateway()
    const given = await gateway.fetchProfile(DEMO_PROFILE.id)
    given!.display_name = 'מישהו אחר'
    expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toEqual(DEMO_PROFILE)
    expect(DEMO_PROFILE.display_name).toBe('משתמש הדגמה')
  })

  it('knows nobody but the demo user', async () => {
    expect(await createDemoGateway().fetchProfile('somebody-else')).toBeNull()
  })

  describe('the profile', () => {
    const INPUT = { display_name: 'דנה כהן-לוי', default_remind_min: 30 }
    const refusal = (code: string) => expect.objectContaining({ code })

    it('is changed in memory, trimmed, and is what the gateway then says it is', async () => {
      const gateway = createDemoGateway()
      const saved = await gateway.updateMyProfile({ display_name: '  דנה כהן-לוי ', default_remind_min: 30 })
      expect(saved).toEqual({ ...DEMO_PROFILE, ...INPUT })
      expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toEqual({ ...DEMO_PROFILE, ...INPUT })
      // The constant that the other tests read is not touched, and another gateway starts from it.
      expect(DEMO_PROFILE.display_name).toBe('משתמש הדגמה')
      expect(await createDemoGateway().fetchProfile(DEMO_PROFILE.id)).toEqual(DEMO_PROFILE)
    })

    it('gives back a copy of the profile that it saved, as it does for every other answer', async () => {
      const gateway = createDemoGateway()
      const saved = await gateway.updateMyProfile(INPUT)
      saved.display_name = 'מישהו אחר'
      expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toMatchObject(INPUT)
    })

    it('refuses what the database refuses, with the codes that the database uses', async () => {
      const gateway = createDemoGateway()
      await expect(gateway.updateMyProfile({ display_name: '   ', default_remind_min: 15 })).rejects.toEqual(refusal('22023'))
      await expect(gateway.updateMyProfile({ display_name: 'דנה', default_remind_min: -1 })).rejects.toEqual(refusal('22023'))
      await expect(gateway.updateMyProfile({ display_name: 'דנה', default_remind_min: 1.5 })).rejects.toEqual(refusal('22023'))
      expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toEqual(DEMO_PROFILE)
    })

    it('forgets the question about the password once it is answered, and takes any new password without keeping it', async () => {
      const directory = createMemoryDirectory({ statuses: [], profiles: [{ ...DEMO_PROFILE, must_change_password: true }] })
      const gateway = createDemoGateway(directory)
      await gateway.changePassword('a-password-of-my-own')
      expect((await gateway.fetchProfile(DEMO_PROFILE.id))?.must_change_password).toBe(true)
      await gateway.clearMustChangePassword()
      expect((await gateway.fetchProfile(DEMO_PROFILE.id))?.must_change_password).toBe(false)
      expect(JSON.stringify(directory.profiles)).not.toContain('a-password-of-my-own')
    })

    it('is the same person as the one in the directory of the team, when it is given that', async () => {
      const colleague = { ...DEMO_PROFILE, id: 'demo-avi', email: 'avi@moked.invalid', display_name: 'אבי לוי', role: 'employee' as const }
      const directory = createMemoryDirectory({ statuses: [], profiles: [DEMO_PROFILE, colleague] })
      const told = vi.fn()
      directory.gateway.subscribe(told)
      const gateway = createDemoGateway(directory)

      await gateway.updateMyProfile(INPUT)
      expect(directory.profiles.find((p) => p.id === DEMO_PROFILE.id)).toMatchObject(INPUT)
      expect(told).toHaveBeenCalledTimes(1)

      // And the other way round: what the team's screens do to the person is seen by the person.
      directory.profiles.find((p) => p.id === DEMO_PROFILE.id)!.display_name = 'שם חדש'
      expect((await gateway.fetchProfile(DEMO_PROFILE.id))?.display_name).toBe('שם חדש')
      expect(await gateway.fetchProfile('demo-avi')).toMatchObject({ display_name: 'אבי לוי' })
    })

    it('does not take the name of a colleague, whatever the case of the letters, but may keep its own', async () => {
      const colleague = { ...DEMO_PROFILE, id: 'demo-avi', email: 'avi@moked.invalid', display_name: 'Avi Levi', role: 'employee' as const }
      const directory = createMemoryDirectory({ statuses: [], profiles: [DEMO_PROFILE, colleague] })
      const gateway = createDemoGateway(directory)
      await expect(gateway.updateMyProfile({ display_name: ' avi LEVI ', default_remind_min: 15 })).rejects.toMatchObject({
        code: '23505',
        status: 409,
        message: expect.stringContaining('profiles_display_name_key'),
      })
      expect(directory.profiles.find((p) => p.id === DEMO_PROFILE.id)?.display_name).toBe(DEMO_PROFILE.display_name)
      await expect(gateway.updateMyProfile({ display_name: DEMO_PROFILE.display_name.toUpperCase(), default_remind_min: 20 })).resolves.toBeDefined()
    })

    it('is not told about a request that changes nothing', async () => {
      const directory = createMemoryDirectory({ statuses: [], profiles: [{ ...DEMO_PROFILE }] })
      const told = vi.fn()
      directory.gateway.subscribe(told)
      const gateway = createDemoGateway(directory)
      await gateway.clearMustChangePassword()
      await gateway.updateMyProfile({ display_name: DEMO_PROFILE.display_name, default_remind_min: DEMO_PROFILE.default_remind_min })
      expect(told).not.toHaveBeenCalled()
    })

    it('works with the real auth store', async () => {
      const store = createAuthStore(createDemoGateway())
      await store.getState().init()
      expect(await store.getState().saveProfile(INPUT)).toBeNull()
      expect(store.getState().profile).toMatchObject(INPUT)
      expect(await store.getState().changePassword('a-password-of-my-own')).toBeNull()
      expect(await store.getState().saveProfile({ display_name: '', default_remind_min: 15 })).toBe(PROFILE_MESSAGES.invalid)
    })
  })

  it('works with the real auth store: open, sign out, sign in again', async () => {
    const store = createAuthStore(createDemoGateway())
    await store.getState().init()
    expect(store.getState()).toMatchObject({ status: 'signedIn', profile: DEMO_PROFILE })

    await store.getState().signOut()
    expect(store.getState().status).toBe('signedOut')

    expect(await store.getState().signIn('dana@example.com', 'secret')).toBe(true)
    expect(store.getState()).toMatchObject({ status: 'signedIn', profile: DEMO_PROFILE })
  })
})
