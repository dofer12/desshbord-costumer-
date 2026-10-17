import { afterEach, describe, expect, it, vi } from 'vitest'
import { DANA, OWNER } from '../../test/fakeGateway'
import type { Status } from '../tasks/gateways'
import { createMemoryDirectory } from '../tasks/memoryGateways'
import { createMemoryAdminGateway } from './memoryAdminGateway'

// The statuses of the pretend server of the administrator tools, for the demo and the tests of the screens:
// what the database does with them, as far as a screen can tell. The rules about what a status may be
// called are the screen's (statusRules.test.ts); the real thing is tried in supabaseStatuses.contract.test.ts.

const STATUSES: Status[] = [
  { key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1, is_active: true },
  { key: 'completed', name_he: 'הושלמו', color: '#7c9cc0', sort: 3, is_active: true },
  { key: 'cargo', name_he: 'Send to CARGO', color: '#1e88c9', sort: 8, is_active: false },
]

function setup(as: string | null = OWNER.id) {
  const directory = createMemoryDirectory({ statuses: STATUSES, profiles: [OWNER, DANA] })
  const gateway = createMemoryAdminGateway({ directory, currentUserId: as })
  const heard = vi.fn()
  directory.gateway.subscribe(heard)
  return { directory, statuses: gateway.statuses, heard }
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('has no way to delete a status', () => {
  expect(Object.keys(setup().statuses).sort()).toEqual(['add', 'reorder', 'update'])
})

describe('add', () => {
  it('makes an active status after the last, with a key of its own, a trimmed name and a colour in lower-case', async () => {
    const t = setup()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const made = await t.statuses.add({ name_he: '  ממתין ללקוח ', color: '#ABCDEF' })
    expect(made).toEqual({ key: 'custom-000000', name_he: 'ממתין ללקוח', color: '#abcdef', sort: 9, is_active: true })
    expect(t.directory.statuses.at(-1)).toEqual(made)
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('never makes a key that exists, and takes the first place when there is no status', async () => {
    const t = setup()
    t.directory.statuses = [{ key: 'custom-000000', name_he: 'א', color: '#000000', sort: 0, is_active: true }]
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const made = await t.statuses.add({ name_he: 'ב', color: '#000000' })
    expect(made.key).toBe('custom-000001')
    expect(made.sort).toBe(1)
  })

  it('gives back a copy: what the caller does to it is not done to the directory', async () => {
    const t = setup()
    const made = await t.statuses.add({ name_he: 'ב', color: '#000000' })
    made.name_he = 'changed'
    expect(t.directory.statuses.at(-1)?.name_he).toBe('ב')
  })

  it('does not use a key, a place or a state that it is handed', async () => {
    const t = setup()
    const made = await t.statuses.add({ name_he: 'ב', color: '#000000', key: 'processing', sort: 1, is_active: false } as never)
    expect(made.key).toMatch(/^custom-[a-z0-9]{6}$/)
    expect(made).toMatchObject({ sort: 9, is_active: true })
    expect(t.directory.statuses.filter((s) => s.key === 'processing')).toHaveLength(1)
  })
})

describe('update', () => {
  it('changes the columns that it is given and no others, and says what the status is now', async () => {
    const t = setup()
    const row = await t.statuses.update('processing', { name_he: ' בטיפול מיידי ', color: '#ABCDEF' })
    expect(row).toEqual({ key: 'processing', name_he: 'בטיפול מיידי', color: '#abcdef', sort: 1, is_active: true })
    expect(t.directory.statuses.find((s) => s.key === 'processing')).toEqual(row)
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('blocks and unblocks, and changes the place', async () => {
    const t = setup()
    expect((await t.statuses.update('processing', { is_active: false })).is_active).toBe(false)
    expect((await t.statuses.update('cargo', { is_active: true, sort: 2 })).sort).toBe(2)
  })

  it('does not change the key, whatever it is handed', async () => {
    const t = setup()
    const row = await t.statuses.update('processing', { name_he: 'חדש', key: 'other' } as never)
    expect(row.key).toBe('processing')
    expect(t.directory.statuses.map((s) => s.key)).toEqual(['processing', 'completed', 'cargo'])
  })

  it('says that there is no such status, as the database does, and tells nobody', async () => {
    const t = setup()
    await expect(t.statuses.update('gone', { name_he: 'x' })).rejects.toMatchObject({ code: 'PGRST116', status: 406 })
    expect(t.heard).not.toHaveBeenCalled()
  })

  it('does not accept a change that is nothing', async () => {
    const t = setup()
    await expect(t.statuses.update('processing', {})).rejects.toThrow(/nothing to change/i)
    expect(t.heard).not.toHaveBeenCalled()
  })

  it('gives back a copy', async () => {
    const t = setup()
    const row = await t.statuses.update('processing', { name_he: 'חדש' })
    row.name_he = 'changed'
    expect(t.directory.statuses.find((s) => s.key === 'processing')?.name_he).toBe('חדש')
  })
})

describe('reorder', () => {
  it('writes the places 1, 2, 3 for the keys that are given, in that order, and tells the directory once', async () => {
    const t = setup()
    await t.statuses.reorder(['cargo', 'processing', 'completed'])
    expect(Object.fromEntries(t.directory.statuses.map((s) => [s.key, s.sort]))).toEqual({ cargo: 1, processing: 2, completed: 3 })
    expect(t.heard).toHaveBeenCalledTimes(1)
  })

  it('leaves a status that is not on the list where it was, and does not make up one that does not exist', async () => {
    const t = setup()
    await t.statuses.reorder(['gone', 'cargo'])
    expect(t.directory.statuses.map((s) => [s.key, s.sort])).toEqual([
      ['processing', 1],
      ['completed', 3],
      ['cargo', 2],
    ])
    expect(t.directory.statuses).toHaveLength(3)
  })

  it('does nothing, and tells nobody, for a list with nothing in it', async () => {
    const t = setup()
    await t.statuses.reorder([])
    expect(t.heard).not.toHaveBeenCalled()
  })

  it('tells nobody when the order that it is given is the one that there is', async () => {
    const t = setup()
    t.directory.statuses = t.directory.statuses.map((s, i) => ({ ...s, sort: i + 1 }))
    await t.statuses.reorder(['processing', 'completed', 'cargo'])
    expect(t.heard).not.toHaveBeenCalled()
    await t.statuses.reorder(['processing', 'cargo'])
    expect(t.heard).toHaveBeenCalledTimes(1)
  })
})

describe('who may', () => {
  it('refuses everything to a person who is not an active administrator, as the policies of the database do, and changes nothing', async () => {
    for (const as of [DANA.id, 'u-nobody']) {
      const t = setup(as)
      const before = JSON.stringify(t.directory.statuses)
      await expect(t.statuses.add({ name_he: 'x', color: '#000000' })).rejects.toMatchObject({ code: '42501', status: 403 })
      await expect(t.statuses.update('processing', { name_he: 'x' })).rejects.toMatchObject({ code: '42501', status: 403 })
      await expect(t.statuses.reorder(['cargo'])).rejects.toMatchObject({ code: '42501', status: 403 })
      expect(JSON.stringify(t.directory.statuses)).toBe(before)
      expect(t.heard).not.toHaveBeenCalled()
    }
  })

  it('refuses an administrator who has been blocked', async () => {
    const directory = createMemoryDirectory({ statuses: STATUSES, profiles: [{ ...OWNER, is_active: false }, DANA] })
    const gateway = createMemoryAdminGateway({ directory, currentUserId: OWNER.id })
    await expect(gateway.statuses.update('processing', { name_he: 'x' })).rejects.toMatchObject({ code: '42501' })
  })

  it('says that the session is not there when nobody is signed in', async () => {
    const t = setup(null)
    await expect(t.statuses.add({ name_he: 'x', color: '#000000' })).rejects.toMatchObject({ code: 'PGRST301', status: 401 })
  })

  it('goes by who is acting at the moment of each request', async () => {
    let acting: string | null = DANA.id
    const directory = createMemoryDirectory({ statuses: STATUSES, profiles: [OWNER, DANA] })
    const gateway = createMemoryAdminGateway({ directory, currentUserId: () => acting })
    await expect(gateway.statuses.update('processing', { name_he: 'x' })).rejects.toMatchObject({ code: '42501' })
    acting = OWNER.id
    await expect(gateway.statuses.update('processing', { name_he: 'x' })).resolves.toMatchObject({ name_he: 'x' })
  })
})
