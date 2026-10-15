import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createIdbOutboxStorage, createMemoryOutboxStorage, type OutboxEntry } from './outbox'

const entry = (id: string, patch: OutboxEntry['patch'] = { title: id }, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id,
  patch,
  queuedAt: 1_000,
  attempts: 0,
  ...extra,
})

describe.each([
  ['memory', () => createMemoryOutboxStorage()],
  ['IndexedDB', () => createIdbOutboxStorage(`test-${crypto.randomUUID()}`)],
])('the %s outbox storage', (_name, make) => {
  it('is empty at first', async () => {
    expect(await make().load()).toEqual([])
  })

  it('gives back what was saved, in the same order and with every field', async () => {
    const storage = make()
    const saved = [
      entry('a', { title: 'x', assignee_id: null, notes: '' }, { isNew: true, attempts: 2 }),
      entry('b', { done_at: '2026-10-15T09:00:00.000Z' }, { failure: 'השרת סירב' }),
    ]
    await storage.save(saved)
    expect(await storage.load()).toEqual(saved)
  })

  it('replaces the whole list on every save', async () => {
    const storage = make()
    await storage.save([entry('a'), entry('b')])
    await storage.save([entry('c')])
    expect((await storage.load()).map((e) => e.id)).toEqual(['c'])
    await storage.save([])
    expect(await storage.load()).toEqual([])
  })

  it('keeps what was saved even when the caller changes its own list afterwards', async () => {
    const storage = make()
    const list = [entry('a', { title: 'before' })]
    await storage.save(list)
    list[0].patch.title = 'after'
    list.push(entry('b'))
    expect(await storage.load()).toEqual([entry('a', { title: 'before' })])
  })

  it('hands out a copy, so that changing what was loaded changes nothing that is stored', async () => {
    const storage = make()
    await storage.save([entry('a', { title: 'kept' })])
    const loaded = await storage.load()
    loaded[0].patch.title = 'changed'
    expect((await storage.load())[0].patch.title).toBe('kept')
  })
})

describe('the IndexedDB outbox storage', () => {
  it('is what a restart finds: a new object for the same key sees the saved entries', async () => {
    const key = `test-${crypto.randomUUID()}`
    await createIdbOutboxStorage(key).save([entry('a')])
    expect((await createIdbOutboxStorage(key).load()).map((e) => e.id)).toEqual(['a'])
  })

  it('keeps the entries of different keys apart, as the entries of two users must be', async () => {
    const [one, two] = [`test-${crypto.randomUUID()}`, `test-${crypto.randomUUID()}`]
    await createIdbOutboxStorage(one).save([entry('mine')])
    expect(await createIdbOutboxStorage(two).load()).toEqual([])
  })
})
