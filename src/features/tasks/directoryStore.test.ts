import { describe, expect, it } from 'vitest'
import { DANA, OWNER } from '../../test/fakeGateway'
import { createFakeDirectory, networkError, refusal } from '../../test/fakeTasksGateways'
import { createDirectoryStore } from './directoryStore'
import { SYNC_MESSAGES } from './errors'
import { DEFAULT_SHIP_METHODS } from './model'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function setup() {
  const fake = createFakeDirectory()
  const store = createDirectoryStore(fake.gateway)
  return { fake, store, get: () => store.getState() }
}

describe('the directory store', () => {
  it('starts with no statuses or people and the default settings', () => {
    const t = setup()
    expect(t.get()).toMatchObject({ status: 'idle', error: null, statuses: [], profiles: [] })
    expect(t.get().settings).toEqual({ glassix_url_template: '', ship_methods: [...DEFAULT_SHIP_METHODS], last_backup_at: null })
  })

  it('loads the statuses, the people and the settings', async () => {
    const t = setup()
    t.fake.settings.glassix_url_template = 'https://glassix.example/c/{id}'
    await t.get().load()
    expect(t.get().status).toBe('ready')
    expect(t.get().statuses.map((s) => s.key)).toEqual(['processing', 'completed', 'cargo', 'abroad'])
    expect(t.get().profiles.map((p) => p.id).sort()).toEqual([DANA.id, OWNER.id].sort())
    expect(t.get().settings.glassix_url_template).toBe('https://glassix.example/c/{id}')
  })

  it('keeps the statuses in their order even if they arrive in another one', async () => {
    const t = setup()
    t.fake.statuses.reverse()
    await t.get().load()
    expect(t.get().statuses.map((s) => s.sort)).toEqual([1, 3, 8, 17])
  })

  it('is loading while the answer is on its way', async () => {
    const t = setup()
    const loading = t.get().load()
    expect(t.get().status).toBe('loading')
    await loading
  })

  it('shows a missing table as "not set up"', async () => {
    const t = setup()
    t.fake.failNext(refusal(404, "Could not find the table 'public.statuses'", 'PGRST205'))
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'error', error: SYNC_MESSAGES.notSetUp })
  })

  it('shows trouble with the connection as a message that can be retried', async () => {
    const t = setup()
    t.fake.failNext(networkError())
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'error', error: SYNC_MESSAGES.unreachable })
  })

  it('keeps what it had when a later load fails, and says so', async () => {
    const t = setup()
    await t.get().load()
    t.fake.failNext(networkError())
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'ready', error: SYNC_MESSAGES.unreachable })
    expect(t.get().statuses.length).toBe(4)
    await t.get().load()
    expect(t.get().error).toBeNull()
  })

  it('loads again when something changes, once started', async () => {
    const t = setup()
    await t.get().load()
    t.get().start()
    t.fake.statuses.push({ key: 'new', name_he: 'חדש', color: '#123456', sort: 20, is_active: true })
    t.fake.changed()
    await tick()
    expect(t.get().statuses.map((s) => s.key)).toContain('new')
    expect(t.fake.loads).toBe(2)
    t.get().stop()
  })

  it('listens once however often it is started, and stops listening on stop', async () => {
    const t = setup()
    t.get().start()
    t.get().start()
    t.fake.changed()
    await tick()
    expect(t.fake.loads).toBe(1)

    t.get().stop()
    t.fake.changed()
    await tick()
    expect(t.fake.loads).toBe(1)
  })

  it('does not let a slow old answer overwrite a newer one', async () => {
    const t = setup()
    const inner = t.fake.gateway.load
    const releases: Array<() => void> = []
    let calls = 0
    t.fake.gateway.load = async () => {
      const mine = ++calls
      const answer = await inner()
      if (mine === 1) await new Promise<void>((resolve) => releases.push(resolve))
      return answer
    }
    const first = t.get().load()
    await tick()
    t.fake.statuses.push({ key: 'newer', name_he: 'חדש', color: '#123456', sort: 20, is_active: true })
    await t.get().load()
    expect(t.get().statuses.map((s) => s.key)).toContain('newer')
    releases[0]()
    await first
    expect(t.get().statuses.map((s) => s.key)).toContain('newer')
  })
})
