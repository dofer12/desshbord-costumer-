import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/types'
import { createMemoryDirectory } from '../tasks/memoryGateways'
import { DANA, OWNER } from '../../test/fakeGateway'
import { TEMP_PASSWORD_ALPHABET } from '../../../supabase/functions/admin-users/logic'
import { createMemoryAdminGateway } from './memoryAdminGateway'
import type { UserOutcome } from './gateways'

// The pretend server of the administrator tools, for the demo and the tests of the screens. It is the
// rules of the real function (supabase/functions/admin-users/logic.ts) over the profiles of a memory
// directory, so that what it answers is what the real one answers; the rules themselves are tested there.

const SECOND_ADMIN: Profile = { ...OWNER, id: 'u-second', email: 'second@example.com', display_name: 'מנהל שני' }

function setup(options: { profiles?: Profile[]; as?: string | null; random?: (n: number) => Uint8Array } = {}) {
  const directory = createMemoryDirectory({ statuses: [], profiles: options.profiles ?? [OWNER, DANA] })
  const gateway = createMemoryAdminGateway({ directory, currentUserId: options.as === undefined ? OWNER.id : options.as, randomBytes: options.random })
  const heard = vi.fn()
  directory.gateway.subscribe(heard)
  const profile = (id: string) => directory.profiles.find((p) => p.id === id)
  return { directory, gateway, heard, profile, users: gateway.users }
}

const failure = (outcome: UserOutcome) => {
  expect(outcome.ok).toBe(false)
  return outcome as Extract<UserOutcome, { ok: false }>
}
const success = (outcome: UserOutcome) => {
  expect(outcome).toMatchObject({ ok: true })
  return outcome as Extract<UserOutcome, { ok: true }>
}

describe('create', () => {
  it('makes an active profile that has to choose a password, puts it in the directory and tells the directory', async () => {
    const t = setup()
    const made = success(await t.users.create({ email: 'New@Example.com', display_name: ' דנה כהן ', role: 'employee' }))
    expect(made.user).toMatchObject({ email: 'new@example.com', display_name: 'דנה כהן', role: 'employee', is_active: true, must_change_password: true })
    expect(t.profile(made.user.id)).toEqual(made.user)
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('gives a temporary password of 16 characters, once, and keeps no copy of it', async () => {
    const t = setup()
    const made = success(await t.users.create({ email: 'a@b.co', display_name: 'A', role: 'employee' }))
    expect(made.tempPassword).toHaveLength(16)
    expect([...made.tempPassword!].every((c) => TEMP_PASSWORD_ALPHABET.includes(c))).toBe(true)
    expect(JSON.stringify(t.directory.profiles)).not.toContain(made.tempPassword)
    expect(JSON.stringify(await t.directory.gateway.load())).not.toContain(made.tempPassword)
  })

  it('makes an administrator when it is asked to', async () => {
    const t = setup()
    expect(success(await t.users.create({ email: 'a@b.co', display_name: 'A', role: 'admin' })).user.role).toBe('admin')
  })

  it.each([
    ['a name that is taken, in another case', { email: 'new@example.com', display_name: 'דנה', role: 'employee' as const }, 'name_taken', 'display_name'],
    ['an e-mail that is taken, in another case', { email: 'DANA@example.com', display_name: 'Somebody', role: 'employee' as const }, 'email_taken', 'email'],
    ['an e-mail that is not one', { email: 'not an email', display_name: 'Somebody', role: 'employee' as const }, 'invalid', 'email'],
    ['a name that is empty', { email: 'new@example.com', display_name: '  ', role: 'employee' as const }, 'invalid', 'display_name'],
  ])('refuses %s, and adds nobody', async (_what, input, code, field) => {
    const t = setup()
    expect(failure(await t.users.create(input))).toEqual({ ok: false, code, field })
    expect(t.directory.profiles).toHaveLength(2)
    expect(t.heard).not.toHaveBeenCalled()
  })

  it('gives another password every time', async () => {
    const t = setup()
    const one = success(await t.users.create({ email: 'one@b.co', display_name: 'One', role: 'employee' }))
    const two = success(await t.users.create({ email: 'two@b.co', display_name: 'Two', role: 'employee' }))
    expect(one.tempPassword).not.toBe(two.tempPassword)
  })

  it('takes its randomness from where it is told to, so that a test knows the password', async () => {
    const t = setup({ random: (n) => new Uint8Array(n).fill(0) })
    expect(success(await t.users.create({ email: 'a@b.co', display_name: 'A', role: 'employee' })).tempPassword).toBe(TEMP_PASSWORD_ALPHABET[0].repeat(16))
  })

  it('gives each new person an id of their own', async () => {
    const t = setup()
    const one = success(await t.users.create({ email: 'one@b.co', display_name: 'One', role: 'employee' }))
    const two = success(await t.users.create({ email: 'two@b.co', display_name: 'Two', role: 'employee' }))
    expect(new Set([OWNER.id, DANA.id, one.user.id, two.user.id]).size).toBe(4)
  })
})

describe('resetPassword', () => {
  it('gives a new temporary password, makes the person choose their own, and tells the directory', async () => {
    const t = setup({ profiles: [OWNER, { ...DANA, must_change_password: false }] })
    const reset = success(await t.users.resetPassword(DANA.id))
    expect(reset.tempPassword).toHaveLength(16)
    expect(reset.user).toMatchObject({ id: DANA.id, must_change_password: true })
    expect(t.profile(DANA.id)?.must_change_password).toBe(true)
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('gives another password every time', async () => {
    const t = setup()
    const one = success(await t.users.resetPassword(DANA.id))
    const two = success(await t.users.resetPassword(DANA.id))
    expect(one.tempPassword).not.toBe(two.tempPassword)
  })

  it('refuses an administrator who resets themselves, and a person who is not there', async () => {
    const t = setup()
    expect(failure(await t.users.resetPassword(OWNER.id))).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(failure(await t.users.resetPassword('u-nobody'))).toEqual({ ok: false, code: 'not_found' })
    expect(failure(await t.users.resetPassword('77777777-7777-4777-8777-777777777777'))).toEqual({ ok: false, code: 'not_found' })
    expect(failure(await t.users.resetPassword('an id with spaces'))).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(t.heard).not.toHaveBeenCalled()
  })
})

describe('setActive', () => {
  it('blocks and unblocks, and tells the directory each time', async () => {
    const t = setup()
    expect(success(await t.users.setActive(DANA.id, false)).user).toMatchObject({ id: DANA.id, is_active: false })
    expect(t.profile(DANA.id)?.is_active).toBe(false)
    expect(success(await t.users.setActive(DANA.id, true)).user).toMatchObject({ id: DANA.id, is_active: true })
    expect(t.heard).toHaveBeenCalledTimes(2)
  })

  it('does not give a temporary password', async () => {
    const t = setup()
    expect(success(await t.users.setActive(DANA.id, false))).not.toHaveProperty('tempPassword')
  })

  it('refuses an administrator who blocks themselves', async () => {
    const t = setup()
    expect(failure(await t.users.setActive(OWNER.id, false))).toEqual({ ok: false, code: 'invalid', field: 'user_id' })
    expect(t.profile(OWNER.id)?.is_active).toBe(true)
  })

  it('lets one administrator block another, who is then not served, and cannot be blocked by the one who stays', async () => {
    const t = setup({ profiles: [OWNER, SECOND_ADMIN, DANA] })
    success(await t.users.setActive(SECOND_ADMIN.id, false))
    const second = createMemoryAdminGateway({ directory: t.directory, currentUserId: SECOND_ADMIN.id })
    expect(failure(await second.users.setActive(OWNER.id, false))).toEqual({ ok: false, code: 'forbidden' })
    expect(t.profile(OWNER.id)?.is_active).toBe(true)
  })
})

describe('setRole', () => {
  it('changes the role', async () => {
    const t = setup()
    expect(success(await t.users.setRole(DANA.id, 'admin')).user).toMatchObject({ id: DANA.id, role: 'admin' })
    expect(t.profile(DANA.id)?.role).toBe('admin')
  })

  it('keeps the last active administrator: nobody demotes them, themselves included', async () => {
    const t = setup()
    expect(failure(await t.users.setRole(OWNER.id, 'employee'))).toEqual({ ok: false, code: 'last_admin' })
    expect(t.profile(OWNER.id)?.role).toBe('admin')
    expect(t.heard).not.toHaveBeenCalled()
  })

  it('lets an administrator demote themselves while another one is active, and then the other cannot', async () => {
    const t = setup({ profiles: [OWNER, SECOND_ADMIN, DANA] })
    success(await t.users.setRole(OWNER.id, 'employee'))
    const second = createMemoryAdminGateway({ directory: t.directory, currentUserId: SECOND_ADMIN.id })
    expect(failure(await second.users.setRole(SECOND_ADMIN.id, 'employee'))).toEqual({ ok: false, code: 'last_admin' })
  })

  it('does not count an administrator who is blocked', async () => {
    const t = setup({ profiles: [OWNER, { ...SECOND_ADMIN, is_active: false }, DANA] })
    expect(failure(await t.users.setRole(OWNER.id, 'employee'))).toEqual({ ok: false, code: 'last_admin' })
  })

  it('does not change anything, and says so by succeeding, when the role is the one that the person has', async () => {
    const t = setup()
    success(await t.users.setRole(DANA.id, 'employee'))
    expect(t.heard).not.toHaveBeenCalled()
  })
})

describe('rename', () => {
  it('changes the name, and tells the directory', async () => {
    const t = setup()
    expect(success(await t.users.rename(DANA.id, ' דנה לוי ')).user).toMatchObject({ id: DANA.id, display_name: 'דנה לוי' })
    expect(t.profile(DANA.id)?.display_name).toBe('דנה לוי')
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('refuses a name that somebody else has, in any case, and lets a person change the case of their own', async () => {
    const t = setup({ profiles: [OWNER, { ...DANA, display_name: 'Dana' }, { ...SECOND_ADMIN, display_name: 'Omer' }] })
    expect(failure(await t.users.rename(DANA.id, 'OMER'))).toEqual({ ok: false, code: 'name_taken', field: 'display_name' })
    expect(success(await t.users.rename(DANA.id, 'DANA')).user.display_name).toBe('DANA')
  })
})

describe('who is acting', () => {
  it('serves only an active administrator, and changes nothing for anybody else', async () => {
    for (const as of [DANA.id, 'u-nobody']) {
      const t = setup({ as })
      expect(failure(await t.users.setRole(DANA.id, 'admin'))).toEqual({ ok: false, code: 'forbidden' })
      expect(t.profile(DANA.id)?.role).toBe('employee')
      expect(t.heard).not.toHaveBeenCalled()
    }
    const blocked = setup({ profiles: [{ ...OWNER, is_active: false }, DANA] })
    expect(failure(await blocked.users.rename(DANA.id, 'x'))).toEqual({ ok: false, code: 'forbidden' })
  })

  it('serves nobody when nobody is signed in', async () => {
    const t = setup({ as: null })
    expect(failure(await t.users.rename(DANA.id, 'x'))).toEqual({ ok: false, code: 'unauthenticated' })
    expect(t.profile(DANA.id)?.display_name).toBe(DANA.display_name)
  })

  it('does not mix up the people that it keeps with the ones that it was given', async () => {
    const given = [OWNER, DANA]
    const t = setup({ profiles: given })
    success(await t.users.setRole(DANA.id, 'admin'))
    expect(given[1].role).toBe('employee')
  })
})
