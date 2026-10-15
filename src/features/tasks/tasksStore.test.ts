import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeTasks, networkError, refusal, type FakeTasks } from '../../test/fakeTasksGateways'
import { SYNC_MESSAGES } from './errors'
import { newTask, taskToPatch, type Task } from './model'
import { createMemoryOutboxStorage, type OutboxEntry, type OutboxStorage } from './outbox'
import { createTasksStore } from './tasksStore'

const NOW = new Date('2026-10-15T12:00:00.000Z')

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...newTask('user-1', id),
    no_glassix: true,
    title: `task ${id}`,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    ...patch,
  }
}

/** Lets everything that is waiting on a resolved promise, a storage write or a zero timer run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const started: Array<() => void> = []
afterEach(() => {
  for (const stop of started.splice(0)) stop()
  vi.useRealTimers()
})

function setup(options: { tasks?: Task[]; storage?: OutboxStorage; fake?: FakeTasks; clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => NOW)
  const fake = options.fake ?? createFakeTasks({ tasks: options.tasks ?? [], now: clock })
  const storage = options.storage ?? createMemoryOutboxStorage()
  const store = createTasksStore({ gateway: fake.gateway, storage, now: clock })
  started.push(() => store.getState().stop())
  return { fake, storage, store, get: () => store.getState() }
}

/** Makes `upsert` wait until released, to look at what happens while a send is on its way. */
function holdUpserts(fake: FakeTasks) {
  const upsert = fake.gateway.upsert
  let release: () => void = () => undefined
  let gate = Promise.resolve()
  fake.gateway.upsert = async (id, patch) => {
    await gate
    return upsert(id, patch)
  }
  return {
    hold() {
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
    },
    release: () => release(),
  }
}

describe('load', () => {
  it('puts the loaded rows in the state and becomes ready', async () => {
    const t = setup({ tasks: [task('a'), task('b')] })
    expect(t.get().status).toBe('idle')
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'ready', error: null, pending: 0 })
    expect(Object.keys(t.get().tasks).sort()).toEqual(['a', 'b'])
  })

  it('is loading while the answer is on its way', async () => {
    const t = setup({ tasks: [task('a')] })
    const inner = t.fake.gateway.loadInitial
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    t.fake.gateway.loadInitial = async (now) => {
      await gate
      return inner(now)
    }
    const loading = t.get().load()
    expect(t.get().status).toBe('loading')
    release()
    await loading
    expect(t.get().status).toBe('ready')
  })

  it('shows the changes that are still waiting on top of the rows that it loaded', async () => {
    const storage = createMemoryOutboxStorage()
    await storage.save([{ id: 'a', patch: { notes: 'waiting note' }, queuedAt: 1, attempts: 0 }])
    const t = setup({ tasks: [task('a', { notes: 'server note', title: 'server title' })], storage })
    await t.get().load()
    expect(t.get().tasks.a).toMatchObject({ notes: 'waiting note', title: 'server title' })
    expect(t.get().pending).toBe(1)
  })

  it('shows a missing table as "not set up"', async () => {
    const t = setup()
    t.fake.failNext(refusal(404, "Could not find the table 'public.tasks'", 'PGRST205'))
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'error', error: SYNC_MESSAGES.notSetUp })
  })

  it('shows trouble with the connection as a message that can be retried', async () => {
    const t = setup()
    t.fake.setOffline(true)
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'error', error: SYNC_MESSAGES.unreachable })
  })

  it('keeps what it had when a later load fails, and says so', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.fake.setOffline(true)
    await t.get().load()
    expect(t.get()).toMatchObject({ status: 'ready', error: SYNC_MESSAGES.unreachable })
    expect(Object.keys(t.get().tasks)).toEqual(['a'])
    t.fake.setOffline(false)
    await t.get().load()
    expect(t.get().error).toBeNull()
  })

  it('does not let a slow old answer overwrite a newer one', async () => {
    const t = setup({ tasks: [task('a')] })
    const inner = t.fake.gateway.loadInitial
    const releases: Array<() => void> = []
    let calls = 0
    t.fake.gateway.loadInitial = async (now) => {
      const mine = ++calls
      const rows = await inner(now)
      if (mine === 1) await new Promise<void>((resolve) => releases.push(resolve))
      return rows
    }
    const first = t.get().load()
    await tick()
    t.fake.rows.set('b', task('b'))
    await t.get().load()
    expect(Object.keys(t.get().tasks).sort()).toEqual(['a', 'b'])
    releases[0]()
    await first
    expect(Object.keys(t.get().tasks).sort()).toEqual(['a', 'b'])
  })

  it('drops a task that is no longer on the server, but keeps one that has a change waiting', async () => {
    const t = setup({ tasks: [task('gone'), task('edited')] })
    await t.get().load()
    t.fake.setOffline(true)
    t.get().update('edited', { notes: 'waiting' })
    await tick() // the send fails: the change stays waiting
    t.fake.rows.delete('gone')
    t.fake.rows.delete('edited')
    t.fake.setOffline(false)
    await t.get().load()
    expect(Object.keys(t.get().tasks)).toEqual(['edited'])
  })
})

describe('create and update', () => {
  it('shows a new task at once and queues it', () => {
    const t = setup()
    t.get().create(task('new', { title: 'brand new' }))
    expect(t.get().tasks.new).toMatchObject({ title: 'brand new', created_by: 'user-1' })
    expect(t.get().pending).toBe(1)
  })

  it('writes the change to the storage before it makes any request', async () => {
    const storage = createMemoryOutboxStorage()
    const t = setup({ storage })
    let stored: OutboxEntry[] = []
    const upsert = t.fake.gateway.upsert
    t.fake.gateway.upsert = async (id, patch) => {
      stored = await storage.load()
      return upsert(id, patch)
    }
    t.get().create(task('new'))
    await t.get().flush()
    expect(stored.map((entry) => entry.id)).toEqual(['new'])
  })

  it('sends a new task whole, so that it has everything that the database asks for', async () => {
    const t = setup()
    const created = task('new', { title: 'whole', order_number: '1234', priority: 'high' })
    t.get().create(created)
    await t.get().flush()
    expect(t.fake.upserts).toEqual([{ id: 'new', patch: taskToPatch(created) }])
    expect(t.fake.rows.get('new')).toMatchObject({ title: 'whole', order_number: '1234', priority: 'high' })
  })

  it('shows an update at once and sends only the fields that changed', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().update('a', { title: 'new title', priority: 'high' })
    expect(t.get().tasks.a).toMatchObject({ title: 'new title', priority: 'high' })
    expect(t.get().pending).toBe(1)
    await t.get().flush()
    expect(t.fake.upserts).toEqual([{ id: 'a', patch: { title: 'new title', priority: 'high' } }])
    expect(t.get().pending).toBe(0)
  })

  it('joins the updates of one task into one request, the last value of a field winning', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().update('a', { title: 'first', notes: 'kept' })
    t.get().update('a', { title: 'second' })
    expect(t.get().tasks.a).toMatchObject({ title: 'second', notes: 'kept' })
    await t.get().flush()
    expect(t.fake.upserts).toEqual([{ id: 'a', patch: { title: 'second', notes: 'kept' } }])
  })

  it('ignores an update of a task that it does not know, and an update of nothing', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().update('nobody', { title: 'x' })
    t.get().update('a', {})
    expect(t.get().pending).toBe(0)
    await t.get().flush()
    expect(t.fake.upserts).toEqual([])
  })

  it('marks a task done now, and open again', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().markDone('a', true)
    expect(t.get().tasks.a.done_at).toBe('2026-10-15T12:00:00.000Z')
    await t.get().flush()
    expect(t.fake.upserts.at(-1)).toEqual({ id: 'a', patch: { done_at: '2026-10-15T12:00:00.000Z' } })
    t.get().markDone('a', false)
    expect(t.get().tasks.a.done_at).toBeNull()
    await t.get().flush()
    expect(t.fake.upserts.at(-1)).toEqual({ id: 'a', patch: { done_at: null } })
  })

  it('marks a task deleted now, and brings it back', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().softDelete('a', true)
    expect(t.get().tasks.a.deleted_at).toBe('2026-10-15T12:00:00.000Z')
    await t.get().flush()
    expect(t.fake.rows.get('a')?.deleted_at).toBe('2026-10-15T12:00:00.000Z')
    t.get().softDelete('a', false)
    await t.get().flush()
    expect(t.fake.rows.get('a')?.deleted_at).toBeNull()
  })

  it('shows what the server answered, not only what was sent', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().markDone('a', true)
    await t.get().flush()
    // The pretend server stamps the person who finished the task, as the database does.
    expect(t.get().tasks.a.done_by).toBe('u-dana')
    expect(t.get().tasks.a.updated_at).toBe('2026-10-15T12:00:00.000Z')
  })
})

describe('flush', () => {
  it('empties the queue when everything was sent, in the order it was queued', async () => {
    const t = setup({ tasks: [task('a'), task('b')] })
    await t.get().load()
    t.get().update('b', { notes: 'b first' })
    t.get().update('a', { notes: 'a second' })
    await t.get().flush()
    expect(t.fake.upserts.map((u) => u.id)).toEqual(['b', 'a'])
    expect(t.get().pending).toBe(0)
    expect(await t.storage.load()).toEqual([])
  })

  it('keeps the changes and stops at the first network error, and sends them when the network is back', async () => {
    const t = setup({ tasks: [task('a'), task('b')] })
    await t.get().load()
    t.fake.setOffline(true)
    t.get().update('a', { notes: 'one' })
    t.get().update('b', { notes: 'two' })
    await t.get().flush()
    expect(t.get().pending).toBe(2)
    expect(t.fake.calls.upsert).toBe(1)
    expect((await t.storage.load()).map((e) => [e.id, e.attempts])).toEqual([
      ['a', 1],
      ['b', 0],
    ])

    t.fake.setOffline(false)
    await t.get().flush()
    expect(t.get().pending).toBe(0)
    expect(t.fake.upserts.map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('keeps the change after a server error as well', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.fake.failNext(refusal(503, 'busy'))
    t.get().update('a', { notes: 'x' })
    await t.get().flush()
    expect(t.get()).toMatchObject({ pending: 1, failed: [] })
  })

  it('puts a change that the server refuses aside with a message, and goes on with the next', async () => {
    const t = setup({ tasks: [task('a'), task('b')] })
    await t.get().load()
    t.fake.failNext(refusal(400, 'violates check constraint "tasks_glassix_rule"', '23514'))
    t.get().update('a', { notes: 'refused' })
    t.get().update('b', { notes: 'accepted' })
    await t.get().flush()
    expect(t.get().failed).toEqual([{ id: 'a', message: SYNC_MESSAGES.glassixRule }])
    expect(t.get().pending).toBe(0)
    expect(t.fake.rows.get('b')?.notes).toBe('accepted')
    // What the person typed stays on the screen.
    expect(t.get().tasks.a.notes).toBe('refused')
  })

  it('does not send a refused change again by itself', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.fake.failNext(refusal(400, 'no'))
    t.get().update('a', { notes: 'refused' })
    await t.get().flush()
    const calls = t.fake.calls.upsert
    await t.get().flush()
    await t.get().flush()
    expect(t.fake.calls.upsert).toBe(calls)
  })

  it('queues a refused task again when the person changes it, and clears the message', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.fake.failNext(refusal(400, 'no'))
    t.get().update('a', { notes: 'refused' })
    await t.get().flush()
    expect(t.get().failed).toHaveLength(1)

    t.get().update('a', { title: 'fixed' })
    await t.get().flush()
    expect(t.get().failed).toEqual([])
    expect(t.fake.rows.get('a')).toMatchObject({ title: 'fixed', notes: 'refused' })
  })

  it('queues the refused changes again on request, and can drop one and show the server row again', async () => {
    const t = setup({ tasks: [task('a', { notes: 'server' }), task('b', { notes: 'server' })] })
    await t.get().load()
    t.fake.failNext(refusal(400, 'no'))
    t.fake.failNext(refusal(400, 'no'))
    t.get().update('a', { notes: 'mine' })
    t.get().update('b', { notes: 'mine' })
    await t.get().flush()
    expect(t.get().failed.map((f) => f.id).sort()).toEqual(['a', 'b'])

    t.get().discardFailed('b')
    expect(t.get().tasks.b.notes).toBe('server')
    expect(t.get().failed.map((f) => f.id)).toEqual(['a'])

    t.get().retryFailed()
    await t.get().flush()
    expect(t.get().failed).toEqual([])
    expect(t.fake.rows.get('a')?.notes).toBe('mine')
    expect(t.fake.rows.get('b')?.notes).toBe('server')
  })

  it('removes a new task that was refused and dropped', async () => {
    const t = setup()
    t.fake.failNext(refusal(400, 'no'))
    t.get().create(task('new'))
    await t.get().flush()
    expect(t.get().tasks.new).toBeDefined()
    t.get().discardFailed('new')
    expect(t.get().tasks.new).toBeUndefined()
    expect(t.get().failed).toEqual([])
  })

  it('does not lose a change that is made while a send is on its way, and does not send the first one twice', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    const gate = holdUpserts(t.fake)
    gate.hold()
    t.get().update('a', { title: 'sent first' })
    await tick()
    t.get().update('a', { notes: 'made meanwhile' })
    gate.release()
    await t.get().flush()
    expect(t.fake.upserts).toEqual([
      { id: 'a', patch: { title: 'sent first' } },
      { id: 'a', patch: { notes: 'made meanwhile' } },
    ])
    expect(t.get().pending).toBe(0)
    expect(t.fake.rows.get('a')).toMatchObject({ title: 'sent first', notes: 'made meanwhile' })
  })

  it('sends a field again when the person changes it while it is being sent', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    const gate = holdUpserts(t.fake)
    gate.hold()
    t.get().update('a', { title: 'one' })
    await tick()
    t.get().update('a', { title: 'two' })
    gate.release()
    await t.get().flush()
    expect(t.fake.upserts.map((u) => u.patch)).toEqual([{ title: 'one' }, { title: 'two' }])
    expect(t.fake.rows.get('a')?.title).toBe('two')
    expect(t.get().tasks.a.title).toBe('two')
  })

  it('sends one change once when flush is called while another flush is still running', async () => {
    const t = setup({ tasks: [task('a'), task('b')] })
    await t.get().load()
    t.get().update('a', { notes: 'x' })
    t.get().update('b', { notes: 'y' })
    await Promise.all([t.get().flush(), t.get().flush(), t.get().flush()])
    expect(t.fake.upserts.map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('makes one task, with the same id, when the answer to its first send is lost', async () => {
    const t = setup()
    t.fake.loseNextAnswer()
    t.get().create(task('new', { title: 'only once' }))
    await t.get().flush()
    // The server has it, but the app did not hear: the change is still waiting.
    expect(t.get().pending).toBe(1)
    expect(t.fake.rows.size).toBe(1)

    await t.get().flush()
    expect(t.get().pending).toBe(0)
    expect(t.fake.rows.size).toBe(1)
    expect([...t.fake.rows.keys()]).toEqual(['new'])
    expect(t.fake.upserts.map((u) => u.id)).toEqual(['new', 'new'])
    expect(t.get().tasks.new).toMatchObject({ title: 'only once' })
  })

  it('keeps working when the storage cannot be written', async () => {
    const storage: OutboxStorage = {
      load: async () => [],
      save: async () => {
        throw new Error('The disk is full')
      },
    }
    const t = setup({ storage, tasks: [task('a')] })
    await t.get().load()
    t.get().update('a', { notes: 'still sent' })
    await t.get().flush()
    expect(t.fake.rows.get('a')?.notes).toBe('still sent')
    expect(t.get().pending).toBe(0)
  })
})

describe('a restart', () => {
  it('sends again what was waiting, from the storage', async () => {
    const storage = createMemoryOutboxStorage()
    const first = setup({ storage, tasks: [task('a')] })
    await first.get().load()
    first.fake.setOffline(true)
    first.get().update('a', { notes: 'waiting' })
    first.get().create(task('new', { title: 'also waiting' }))
    await first.get().flush()
    expect(first.get().pending).toBe(2)

    // The app is closed and opened again, with the network back.
    const second = setup({ storage, fake: createFakeTasks({ tasks: [task('a')], now: () => NOW }) })
    await second.get().load()
    await second.get().flush()
    expect(second.fake.rows.get('a')?.notes).toBe('waiting')
    expect(second.fake.rows.get('new')).toMatchObject({ title: 'also waiting' })
    expect(second.get().pending).toBe(0)
    expect(await storage.load()).toEqual([])
  })

  it('shows a new task that was only queued, even before the server can be reached', async () => {
    const storage = createMemoryOutboxStorage()
    const first = setup({ storage })
    first.fake.setOffline(true)
    first.get().create(task('new', { title: 'queued offline', customer_phone: '050-123 4567' }))
    await first.get().flush()

    const second = setup({ storage })
    second.fake.setOffline(true)
    await second.get().load()
    expect(second.get().status).toBe('error')
    expect(second.get().tasks.new).toMatchObject({ id: 'new', title: 'queued offline', customer_phone_digits: '0501234567' })
    expect(second.get().pending).toBe(1)
  })

  it('keeps a refused change aside, with its message, and does not send it again', async () => {
    const storage = createMemoryOutboxStorage()
    const first = setup({ storage, tasks: [task('a')] })
    await first.get().load()
    first.fake.failNext(refusal(403, 'permission denied', '42501'))
    first.get().update('a', { notes: 'refused' })
    await first.get().flush()

    const second = setup({ storage, tasks: [task('a')] })
    await second.get().load()
    await second.get().flush()
    expect(second.get().failed).toEqual([{ id: 'a', message: SYNC_MESSAGES.notAllowed }])
    expect(second.fake.calls.upsert).toBe(0)
  })

  it('does not lose the stored changes when a change is made before they have been read', async () => {
    const storage = createMemoryOutboxStorage()
    await storage.save([{ id: 'old', patch: { notes: 'from before' }, queuedAt: 1, attempts: 0 }])
    const slow: OutboxStorage = {
      load: async () => {
        await tick()
        return storage.load()
      },
      save: (entries) => storage.save(entries),
    }
    const t = setup({ storage: slow, tasks: [task('old')] })
    t.get().create(task('brand-new')) // the stored changes are still being read
    await t.get().flush()
    expect(t.fake.rows.get('old')?.notes).toBe('from before')
    expect(t.fake.rows.has('brand-new')).toBe(true)
    expect(t.get().pending).toBe(0)
    expect(await storage.load()).toEqual([])
  })

  it('prefers a change made here to one that was stored for the same task', async () => {
    const storage = createMemoryOutboxStorage()
    await storage.save([
      { id: 'a', patch: { title: 'stored title', notes: 'stored notes' }, queuedAt: 1, attempts: 0, isNew: true },
    ])
    const slow: OutboxStorage = {
      load: async () => {
        await tick()
        return storage.load()
      },
      save: (entries) => storage.save(entries),
    }
    const t = setup({ storage: slow })
    t.get().create(task('a', { title: 'made just now', notes: 'made just now' }))
    await t.get().flush()
    expect(t.fake.rows.get('a')).toMatchObject({ title: 'made just now', notes: 'made just now' })
    expect(t.fake.upserts).toHaveLength(1)
  })

  it('starts empty when the storage cannot be read', async () => {
    const broken: OutboxStorage = {
      load: async () => {
        throw new Error('IndexedDB is not available')
      },
      save: async () => undefined,
    }
    const t = setup({ storage: broken, tasks: [task('a')] })
    await t.get().load()
    expect(t.get().status).toBe('ready')
    t.get().update('a', { notes: 'works' })
    await t.get().flush()
    expect(t.fake.rows.get('a')?.notes).toBe('works')
  })
})

describe('applyRemote', () => {
  it('replaces a task with the row of the server', async () => {
    const t = setup({ tasks: [task('a', { title: 'old' })] })
    await t.get().load()
    t.get().applyRemote(task('a', { title: 'new', updated_at: '2026-10-09T00:00:00.000Z' }))
    expect(t.get().tasks.a.title).toBe('new')
  })

  it('keeps a change that is still waiting on top of the row, and shows the other fields from the server', async () => {
    const t = setup({ tasks: [task('a', { title: 'server title', notes: 'server notes' })] })
    await t.get().load()
    t.fake.setOffline(true)
    t.get().update('a', { title: 'typed by me' })
    t.get().applyRemote(task('a', { title: 'their title', notes: 'their notes', updated_at: '2026-10-09T00:00:00.000Z' }))
    expect(t.get().tasks.a).toMatchObject({ title: 'typed by me', notes: 'their notes' })
    expect(t.get().pending).toBe(1)
  })

  it('ignores a row that is older than the one it has', async () => {
    const t = setup({ tasks: [task('a', { title: 'current', updated_at: '2026-10-05T00:00:00.000Z' })] })
    await t.get().load()
    t.get().applyRemote(task('a', { title: 'stale', updated_at: '2026-10-01T00:00:00.000Z' }))
    expect(t.get().tasks.a.title).toBe('current')
  })

  it('shows a task that it did not know, a deleted one included', () => {
    const t = setup()
    t.get().applyRemote(task('x', { title: 'from another device' }))
    t.get().applyRemote(task('y', { deleted_at: '2026-10-10T00:00:00.000Z' }))
    expect(t.get().tasks.x.title).toBe('from another device')
    expect(t.get().tasks.y.deleted_at).toBe('2026-10-10T00:00:00.000Z')
  })

  it('leaves two people who change different fields of one task with both changes', async () => {
    let time = Date.parse('2026-10-15T10:00:00.000Z')
    const clock = () => new Date(time)
    const fake = createFakeTasks({ tasks: [task('t')], now: clock })
    const a = setup({ fake, clock })
    const b = setup({ fake, clock })
    await a.get().load()
    await b.get().load()
    a.get().start()
    b.get().start()

    a.get().update('t', { title: 'from A' })
    b.get().update('t', { notes: 'from B' })
    time += 1000
    await a.get().flush()
    time += 1000
    await b.get().flush()
    // The server has merged the two changes, and every device hears the row.
    fake.pushRemote(fake.rows.get('t')!)

    expect(fake.upserts.map((u) => u.patch)).toEqual([{ title: 'from A' }, { notes: 'from B' }])
    for (const side of [a, b]) {
      expect(side.get().tasks.t).toMatchObject({ title: 'from A', notes: 'from B' })
    }
  })
})

describe('start and stop', () => {
  it('applies the rows that arrive through realtime', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.pushRemote(task('a', { title: 'changed elsewhere', updated_at: '2026-10-09T00:00:00.000Z' }))
    t.fake.pushRemote(task('b', { title: 'created elsewhere' }))
    expect(t.get().tasks.a.title).toBe('changed elsewhere')
    expect(t.get().tasks.b.title).toBe('created elsewhere')
  })

  it('listens once however often it is started, and stops listening on stop', () => {
    const t = setup()
    t.get().start()
    t.get().start()
    expect(t.fake.subscribers).toBe(1)
    t.get().stop()
    expect(t.fake.subscribers).toBe(0)
    t.fake.pushRemote(task('late'))
    expect(t.get().tasks.late).toBeUndefined()
  })

  it('tells whether the connection is live', () => {
    const t = setup()
    t.get().start()
    expect(t.get().live).toBe(false)
    t.fake.setLive(true)
    expect(t.get().live).toBe(true)
    t.fake.setLive(false)
    expect(t.get().live).toBe(false)
  })

  it('reads everything again when the connection comes back, but not when it first comes up', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.setLive(true)
    await tick()
    expect(t.fake.calls.loadInitial).toBe(1)

    t.fake.setLive(false)
    t.fake.rows.set('b', task('b', { title: 'made while disconnected' }))
    t.fake.setLive(true)
    await tick()
    expect(t.fake.calls.loadInitial).toBe(2)
    expect(t.get().tasks.b?.title).toBe('made while disconnected')
  })

  it('sends what was waiting when it starts', async () => {
    const storage = createMemoryOutboxStorage()
    await storage.save([{ id: 'a', patch: { notes: 'left over' }, queuedAt: 1, attempts: 0 }])
    const t = setup({ storage, tasks: [task('a')] })
    t.get().start()
    await tick()
    await tick()
    expect(t.fake.rows.get('a')?.notes).toBe('left over')
  })

  it('sends what is waiting when the device says that it is online again', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.setOffline(true)
    t.get().update('a', { notes: 'waiting' })
    await tick()
    expect(t.get().pending).toBe(1)

    t.fake.setOffline(false)
    window.dispatchEvent(new Event('online'))
    await tick()
    await tick()
    expect(t.get().pending).toBe(0)
    expect(t.fake.rows.get('a')?.notes).toBe('waiting')
  })

  it('sends what is waiting when the app becomes visible again, and not when it is hidden', async () => {
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.setOffline(true)
    t.get().update('a', { notes: 'waiting' })
    await tick()
    t.fake.setOffline(false)

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    expect(t.get().pending).toBe(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await tick()
    await tick()
    expect(t.get().pending).toBe(0)
  })

  it('tries again every 30 seconds while it is started', async () => {
    vi.useFakeTimers()
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.setOffline(true)
    t.get().update('a', { notes: 'waiting' })
    await vi.advanceTimersByTimeAsync(0)
    const attempts = t.fake.calls.upsert

    t.fake.setOffline(false)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(t.fake.calls.upsert).toBe(attempts)
    await vi.advanceTimersByTimeAsync(1_500)
    expect(t.get().pending).toBe(0)
    expect(t.fake.rows.get('a')?.notes).toBe('waiting')
  })

  it('does nothing after stop: no timer, no listener', async () => {
    vi.useFakeTimers()
    const t = setup({ tasks: [task('a')] })
    await t.get().load()
    t.get().start()
    t.fake.setOffline(true)
    t.get().update('a', { notes: 'waiting' })
    await vi.advanceTimersByTimeAsync(0)
    t.get().stop()
    const attempts = t.fake.calls.upsert

    t.fake.setOffline(false)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(t.fake.calls.upsert).toBe(attempts)
    expect(t.get().pending).toBe(1)
  })
})

describe('search', () => {
  it('gives back what the server found and keeps it, so that it can be opened and changed', async () => {
    const t = setup({ tasks: [task('old', { title: 'לחזור אל דנה', done_at: '2026-01-01T00:00:00.000Z' })] })
    await t.get().load()
    expect(t.get().tasks.old).toBeUndefined() // done long ago: not part of the first load
    const found = await t.get().search('דנה')
    expect(found.map((task) => task.id)).toEqual(['old'])
    expect(t.get().tasks.old).toBeDefined()

    t.get().update('old', { notes: 'reopened from a search' })
    await t.get().flush()
    expect(t.fake.rows.get('old')?.notes).toBe('reopened from a search')
  })

  it('shows a found task with the changes that are still waiting', async () => {
    const t = setup({ tasks: [task('a', { title: 'findable' })] })
    await t.get().load()
    t.fake.failNext(networkError()) // the send of the change fails, so the change stays waiting
    t.get().update('a', { notes: 'waiting' })
    await tick()
    expect(t.get().pending).toBe(1)
    const found = await t.get().search('findable')
    expect(found[0]).toMatchObject({ id: 'a', notes: 'waiting' })
  })

  it('makes no request for an empty query', async () => {
    const t = setup({ tasks: [task('a')] })
    expect(await t.get().search('   ')).toEqual([])
    expect(t.fake.calls.search).toBe(0)
  })

  it('fails when the server cannot be reached, so that the screen can say so', async () => {
    const t = setup({ tasks: [task('a')] })
    t.fake.setOffline(true)
    await expect(t.get().search('x')).rejects.toMatchObject({ status: 0 })
  })
})
