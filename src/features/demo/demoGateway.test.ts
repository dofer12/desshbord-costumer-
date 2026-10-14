import { describe, expect, it, vi } from 'vitest'
import { createAuthStore } from '../auth/authStore'
import { createDemoGateway, DEMO_PROFILE } from './demoGateway'

describe('demo gateway', () => {
  it('starts signed in as the demo user, so the app opens straight on the home screen', async () => {
    const gateway = createDemoGateway()
    expect(await gateway.getStoredUserId()).toBe(DEMO_PROFILE.id)
    expect(await gateway.fetchProfile(DEMO_PROFILE.id)).toEqual(DEMO_PROFILE)
  })

  it('uses an active admin that is never asked to change a password, with an address that cannot exist', () => {
    expect(DEMO_PROFILE).toMatchObject({ role: 'admin', is_active: true, must_change_password: false })
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
