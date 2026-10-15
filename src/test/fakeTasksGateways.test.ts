import { describe, expect, it, vi } from 'vitest'
import { isRetryable } from '../features/tasks/errors'
import type { TaskChangeEvent } from '../features/tasks/gateways'
import { newTask, type Task } from '../features/tasks/model'
import { DANA } from './fakeGateway'
import {
  createFakeAttachments,
  createFakeDirectory,
  createFakeTasks,
  networkError,
  refusal,
} from './fakeTasksGateways'

// The stores are tested against these fakes, so the fakes are held to the contract that the real
// gateways keep (supabaseGateways.contract.test.ts).

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  ...newTask('user-1', id),
  no_glassix: true,
  title: `task ${id}`,
  ...patch,
})

describe('the fake tasks gateway', () => {
  it('merges the fields of a patch into the row with the same id, and keeps the others', async () => {
    const fake = createFakeTasks({ tasks: [task('a', { notes: 'keep me' })] })
    const saved = await fake.gateway.upsert('a', { title: 'new title' })
    expect(saved).toMatchObject({ id: 'a', title: 'new title', notes: 'keep me' })
    expect(fake.rows.size).toBe(1)
  })

  it('creates a task that does not exist yet, as the signed-in user', async () => {
    const fake = createFakeTasks()
    const saved = await fake.gateway.upsert('new-id', { title: 'fresh' })
    expect(saved).toMatchObject({ id: 'new-id', title: 'fresh', created_by: DANA.id, kind: 'general' })
  })

  it('does the same when the same upsert is sent again', async () => {
    const fake = createFakeTasks()
    await fake.gateway.upsert('a', { title: 'x', priority: 'high' })
    const once = structuredClone(fake.rows.get('a'))
    await fake.gateway.upsert('a', { title: 'x', priority: 'high' })
    expect(fake.rows.size).toBe(1)
    expect({ ...fake.rows.get('a'), updated_at: '' }).toEqual({ ...once, updated_at: '' })
    expect(fake.upserts).toHaveLength(2)
  })

  it('stamps the time and the person who finished the task, as the triggers do', async () => {
    const fake = createFakeTasks({ now: () => new Date('2026-10-15T10:00:00.000Z') })
    await fake.gateway.upsert('a', { title: 'x' })
    const done = await fake.gateway.upsert('a', { done_at: '2026-10-15T09:59:00.000Z' })
    expect(done).toMatchObject({ done_by: DANA.id, updated_at: '2026-10-15T10:00:00.000Z' })
    const reopened = await fake.gateway.upsert('a', { done_at: null })
    expect(reopened.done_by).toBeNull()
  })

  it('never lets a patch set a field that the server keeps', async () => {
    const fake = createFakeTasks()
    await fake.gateway.upsert('a', { title: 'x', created_by: 'somebody' } as never)
    expect(fake.rows.get('a')?.created_by).toBe(DANA.id)
  })

  it('loads the open tasks and those done in the last 30 days, and not the deleted ones', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z')
    const fake = createFakeTasks({
      tasks: [
        task('open'),
        task('done-recently', { done_at: '2026-10-01T10:00:00.000Z' }),
        task('done-long-ago', { done_at: '2026-08-01T10:00:00.000Z' }),
        task('deleted', { deleted_at: '2026-10-10T10:00:00.000Z' }),
      ],
    })
    expect((await fake.gateway.loadInitial(now)).map((t) => t.id).sort()).toEqual(['done-recently', 'open'])
  })

  it('searches the titles and customers, and the phone by its digits', async () => {
    const fake = createFakeTasks({
      tasks: [
        { ...task('a', { title: 'לחזור אל דנה' }), updated_at: '2026-10-01T00:00:00Z' },
        { ...task('b', { customer_phone: '050-123 4567', customer_phone_digits: '0501234567' }), updated_at: '2026-10-02T00:00:00Z' },
        task('c', { title: 'something else', deleted_at: '2026-10-10T00:00:00Z' }),
      ],
    })
    expect((await fake.gateway.search('דנה')).map((t) => t.id)).toEqual(['a'])
    expect((await fake.gateway.search('+972 50 123 4567')).map((t) => t.id)).toEqual(['b'])
    expect(await fake.gateway.search('  ')).toEqual([])
    expect(await fake.gateway.search('something')).toEqual([])
  })

  it('fails only the next call when told to, with the error it was given', async () => {
    const fake = createFakeTasks()
    const error = refusal(400, 'no', '23514')
    fake.failNext(error)
    await expect(fake.gateway.upsert('a', { title: 'x' })).rejects.toBe(error)
    expect(fake.rows.size).toBe(0)
    await expect(fake.gateway.upsert('a', { title: 'x' })).resolves.toMatchObject({ id: 'a' })
  })

  it('applies an upsert whose answer is lost, so that a resend has to be harmless', async () => {
    const fake = createFakeTasks()
    fake.loseNextAnswer()
    const error = await fake.gateway.upsert('a', { title: 'x' }).catch((e: unknown) => e)
    expect(isRetryable(error)).toBe(true)
    expect(fake.rows.get('a')).toMatchObject({ title: 'x' })
    await fake.gateway.upsert('a', { title: 'x' })
    expect(fake.rows.size).toBe(1)
  })

  it('fails every call while it is offline, with an error the store reads as retryable', async () => {
    const fake = createFakeTasks()
    fake.setOffline(true)
    const error = await fake.gateway.loadInitial(new Date()).catch((e: unknown) => e)
    expect(isRetryable(error)).toBe(true)
    expect(isRetryable(networkError())).toBe(true)
    expect(isRetryable(refusal())).toBe(false)
    fake.setOffline(false)
    await expect(fake.gateway.loadInitial(new Date())).resolves.toEqual([])
  })

  it('delivers a pushed row to the subscribers, stores it, and stops after the unsubscribe', () => {
    const fake = createFakeTasks()
    const events: TaskChangeEvent[] = []
    const onState = vi.fn()
    const stop = fake.gateway.subscribe((event) => events.push(event), onState)
    expect(fake.subscribers).toBe(1)

    fake.pushRemote(task('a'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'upsert', task: { id: 'a' } })
    expect(fake.rows.has('a')).toBe(true)

    fake.setLive(true)
    fake.setLive(false)
    expect(onState.mock.calls.map((call) => call[0])).toEqual([true, false])

    stop()
    fake.pushRemote(task('b'))
    expect(events).toHaveLength(1)
    expect(fake.subscribers).toBe(0)
  })

  it('returns the history of one task, newest first', async () => {
    const fake = createFakeTasks()
    fake.events.push(
      { id: 1, task_id: 'a', actor_id: null, type: 'created', changes: {}, at: '2026-10-01T00:00:00Z' },
      { id: 2, task_id: 'b', actor_id: null, type: 'created', changes: {}, at: '2026-10-01T00:00:00Z' },
      { id: 3, task_id: 'a', actor_id: null, type: 'done', changes: {}, at: '2026-10-02T00:00:00Z' },
    )
    expect((await fake.gateway.loadHistory('a')).map((e) => e.id)).toEqual([3, 1])
  })
})

describe('the fake directory gateway', () => {
  it('returns copies of statuses, profiles and settings, and counts the loads', async () => {
    const fake = createFakeDirectory()
    const loaded = await fake.gateway.load()
    expect(loaded.statuses.length).toBeGreaterThan(0)
    expect(loaded.profiles.map((p) => p.id)).toContain(DANA.id)
    expect(loaded.settings.ship_methods).toContain('CARGO')
    loaded.statuses.length = 0
    expect((await fake.gateway.load()).statuses.length).toBeGreaterThan(0)
    expect(fake.loads).toBe(2)
  })

  it('tells its subscribers about a change, until they unsubscribe', () => {
    const fake = createFakeDirectory()
    const onChange = vi.fn()
    const stop = fake.gateway.subscribe(onChange)
    fake.changed()
    stop()
    fake.changed()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('can be made to fail', async () => {
    const fake = createFakeDirectory()
    fake.failNext(networkError())
    await expect(fake.gateway.load()).rejects.toMatchObject({ status: 0 })
    await expect(fake.gateway.load()).resolves.toBeDefined()
  })
})

describe('the fake attachments gateway', () => {
  const files = { full: new Blob(['x'.repeat(100)]), thumb: new Blob(['x']), kind: 'image' as const, width: 800, height: 600 }

  it('adds, lists and removes attachments, and remembers which files went away', async () => {
    const fake = createFakeAttachments()
    const first = await fake.gateway.add('task-1', files)
    await fake.gateway.add('task-2', files)
    expect(first).toMatchObject({ task_id: 'task-1', bytes: 100, uploaded_by: DANA.id, kind: 'image' })
    expect((await fake.gateway.list('task-1')).map((a) => a.id)).toEqual([first.id])

    await fake.gateway.remove(first)
    expect(await fake.gateway.list('task-1')).toEqual([])
    expect(fake.removedFiles).toEqual([first.storage_path, first.thumb_path])
  })

  it('gives a signed address, and can be made to fail', async () => {
    const fake = createFakeAttachments()
    expect(await fake.gateway.signedUrl('a/b.jpg')).toContain('a/b.jpg')
    fake.failNext(refusal(413))
    await expect(fake.gateway.add('task-1', files)).rejects.toMatchObject({ status: 413 })
    expect(fake.items).toHaveLength(0)
  })
})
