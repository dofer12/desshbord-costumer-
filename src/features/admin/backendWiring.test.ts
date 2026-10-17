import { describe, expect, it, vi } from 'vitest'
import { createDemoBackend, demoColleagues } from '../demo/demoBackend'
import { DEMO_USER_ID } from '../demo/demoGateway'
import { createSupabaseBackend } from '../tasks/supabaseBackend'
import { createFakeBackend } from '../../test/fakeBackend'
import { DANA, OWNER } from '../../test/fakeGateway'

// The administrator tools are part of every backend: the real one, the one of the demo and the one that
// the tests are made from. These tests only check that each of them has them, and that they work on the
// people that the directory of that backend shows.

describe('the backend of the real app', () => {
  it('has the tools of the administrator, which call the function of the project', () => {
    const backend = createSupabaseBackend({} as never)
    expect(Object.keys(backend.admin.users).sort()).toEqual(['create', 'rename', 'resetPassword', 'setActive', 'setRole'])
  })
})

describe('the backend of the tests', () => {
  it('acts for the owner, who is an administrator, and changes the people that its directory shows', async () => {
    const fake = createFakeBackend()
    const heard = vi.fn()
    fake.backend.directory.subscribe(heard)
    expect(await fake.backend.admin.users.setRole(DANA.id, 'admin')).toMatchObject({ ok: true, user: { id: DANA.id, role: 'admin' } })
    expect(fake.directory.profiles.find((p) => p.id === DANA.id)?.role).toBe('admin')
    expect((await fake.backend.directory.load()).profiles.find((p) => p.id === DANA.id)?.role).toBe('admin')
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('acts for whoever the test says, and an employee or nobody is refused', async () => {
    const fake = createFakeBackend()
    fake.actAs(DANA.id)
    expect(await fake.backend.admin.users.setRole(DANA.id, 'admin')).toEqual({ ok: false, code: 'forbidden' })
    fake.actAs(null)
    expect(await fake.backend.admin.users.setRole(DANA.id, 'admin')).toEqual({ ok: false, code: 'unauthenticated' })
    fake.actAs(OWNER.id)
    expect((await fake.backend.admin.users.setRole(DANA.id, 'admin')).ok).toBe(true)
  })
})

describe('the backend of the demo', () => {
  it('lets the user of the demo, who is an administrator, make a person, who then shows in the directory', async () => {
    const backend = createDemoBackend()
    const before = (await backend.directory.load()).profiles
    expect(before.map((p) => p.id)).toEqual([DEMO_USER_ID, ...demoColleagues().map((p) => p.id)])
    const made = await backend.admin.users.create({ email: 'new@moked.invalid', display_name: 'עובד חדש', role: 'employee' })
    expect(made).toMatchObject({ ok: true, user: { display_name: 'עובד חדש', must_change_password: true }, tempPassword: expect.stringMatching(/^[A-Za-z2-9]{16}$/) })
    expect((await backend.directory.load()).profiles).toHaveLength(before.length + 1)
  })

  it('does not let the user of the demo block themselves or leave the team without an administrator', async () => {
    const backend = createDemoBackend()
    expect(await backend.admin.users.setActive(DEMO_USER_ID, false)).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(await backend.admin.users.setRole(DEMO_USER_ID, 'employee')).toEqual({ ok: false, code: 'last_admin' })
  })

  it('has its own people in every demo that is made', async () => {
    const one = createDemoBackend()
    const two = createDemoBackend()
    await one.admin.users.create({ email: 'new@moked.invalid', display_name: 'עובד חדש', role: 'employee' })
    expect((await two.directory.load()).profiles).toHaveLength(4)
  })
})
