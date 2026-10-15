import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/types'
import type { TaskChangeEvent } from './gateways'
import { createMemoryAttachments, createMemoryDirectory, createMemoryTasks } from './memoryGateways'
import { newTask, type Task } from './model'

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

function tasksFor(options: { tasks?: Task[]; echo?: boolean; live?: boolean } = {}) {
  return createMemoryTasks({ userId: 'me', now: () => NOW, ...options })
}

describe('the in-memory tasks gateway', () => {
  describe('upsert', () => {
    it('merges the fields of a patch into the row with the same id and keeps the others', async () => {
      const memory = tasksFor({ tasks: [task('a', { notes: 'keep me' })] })
      const saved = await memory.gateway.upsert('a', { title: 'new title' })
      expect(saved).toMatchObject({ id: 'a', title: 'new title', notes: 'keep me' })
      expect(memory.rows.size).toBe(1)
    })

    it('creates a task that does not exist, as the signed-in user, with the defaults of the database', async () => {
      const memory = tasksFor()
      const saved = await memory.gateway.upsert('new', { title: 'fresh' })
      expect(saved).toMatchObject({ id: 'new', title: 'fresh', created_by: 'me', kind: 'general', status_key: 'processing' })
    })

    it('does the same when the same upsert is sent again', async () => {
      const memory = tasksFor()
      await memory.gateway.upsert('a', { title: 'x', priority: 'high' })
      await memory.gateway.upsert('a', { title: 'x', priority: 'high' })
      expect(memory.rows.size).toBe(1)
      expect(memory.events.map((e) => e.type)).toEqual(['created'])
    })

    it('stamps the time, the person who finished the task and the phone digits, as the database does', async () => {
      const memory = tasksFor()
      await memory.gateway.upsert('a', { title: 'x', customer_phone: '050-123 4567' })
      const done = await memory.gateway.upsert('a', { done_at: '2026-10-15T09:59:00.000Z' })
      expect(done).toMatchObject({ done_by: 'me', updated_at: NOW.toISOString(), customer_phone_digits: '0501234567' })
      expect((await memory.gateway.upsert('a', { done_at: null })).done_by).toBeNull()
    })

    it('keeps the person who finished a task when somebody else edits it', async () => {
      const memory = tasksFor({ tasks: [task('a', { done_at: '2026-10-10T10:00:00.000Z', done_by: 'someone-else' })] })
      const saved = await memory.gateway.upsert('a', { notes: 'edited later' })
      expect(saved.done_by).toBe('someone-else')
    })

    it('never lets a patch set a field that the server keeps', async () => {
      const memory = tasksFor()
      await memory.gateway.upsert('a', { title: 'x', created_by: 'somebody' } as never)
      expect(memory.rows.get('a')?.created_by).toBe('me')
    })

    it('hands out copies, so that changing an answer changes nothing on the pretend server', async () => {
      const memory = tasksFor()
      const saved = await memory.gateway.upsert('a', { title: 'x' })
      saved.title = 'changed by the caller'
      expect(memory.rows.get('a')?.title).toBe('x')
    })
  })

  describe('the history it writes', () => {
    const types = (memory: ReturnType<typeof tasksFor>) => memory.events.map((e) => e.type)

    it('writes "created" for a new task, by the signed-in user', async () => {
      const memory = tasksFor()
      await memory.gateway.upsert('a', { title: 'x' })
      expect(memory.events).toMatchObject([{ task_id: 'a', actor_id: 'me', type: 'created', changes: {} }])
    })

    it('writes one "updated" event with the old and the new value of each changed field', async () => {
      const memory = tasksFor({ tasks: [task('a', { title: 'old', notes: 'a' })] })
      await memory.gateway.upsert('a', { title: 'new', notes: 'b' })
      expect(memory.events).toHaveLength(1)
      expect(memory.events[0]).toMatchObject({ type: 'updated', changes: { title: ['old', 'new'], notes: ['a', 'b'] } })
    })

    it('names a status change, an assignment, done and reopened, deleted and restored', async () => {
      const memory = tasksFor({ tasks: [task('a')] })
      await memory.gateway.upsert('a', { status_key: 'cargo' })
      await memory.gateway.upsert('a', { assignee_id: 'dana' })
      await memory.gateway.upsert('a', { done_at: '2026-10-15T09:00:00.000Z' })
      await memory.gateway.upsert('a', { done_at: null })
      await memory.gateway.upsert('a', { deleted_at: '2026-10-15T09:00:00.000Z' })
      await memory.gateway.upsert('a', { deleted_at: null })
      expect(types(memory)).toEqual(['status', 'assigned', 'done', 'reopened', 'deleted', 'restored'])
      expect(memory.events[0].changes).toEqual({ status_key: ['processing', 'cargo'] })
      expect(memory.events[1].changes).toEqual({ assignee_id: [null, 'dana'] })
    })

    it('writes one event for each kind of change when an update mixes them', async () => {
      const memory = tasksFor({ tasks: [task('a')] })
      await memory.gateway.upsert('a', { notes: 'sent', status_key: 'cargo' })
      expect(types(memory)).toEqual(['status', 'updated'])
      expect(memory.events[1].changes).toEqual({ notes: ['', 'sent'] })
    })

    it('writes nothing for an upsert that changes nothing, and never lists what the server keeps itself', async () => {
      const memory = tasksFor({ tasks: [task('a', { customer_phone: '050-111' })] })
      await memory.gateway.upsert('a', { title: 'task a' })
      await memory.gateway.upsert('a', { customer_phone: '050-222' })
      expect(types(memory)).toEqual(['updated'])
      expect(Object.keys(memory.events[0].changes)).toEqual(['customer_phone'])
    })

    it('shows the history of one task, newest first', async () => {
      const memory = tasksFor()
      await memory.gateway.upsert('a', { title: 'x' })
      await memory.gateway.upsert('b', { title: 'y' })
      await memory.gateway.upsert('a', { notes: 'z' })
      expect((await memory.gateway.loadHistory('a')).map((e) => e.type)).toEqual(['updated', 'created'])
    })
  })

  describe('loadInitial and search', () => {
    it('loads the open tasks and those done in the last 30 days, and not the deleted ones', async () => {
      const memory = tasksFor({
        tasks: [
          task('open'),
          task('done-recently', { done_at: '2026-10-01T10:00:00.000Z' }),
          task('done-long-ago', { done_at: '2026-08-01T10:00:00.000Z' }),
          task('deleted', { deleted_at: '2026-10-10T10:00:00.000Z' }),
        ],
      })
      expect((await memory.gateway.loadInitial(NOW)).map((t) => t.id).sort()).toEqual(['done-recently', 'open'])
    })

    it('searches the titles and customers, and the phone by its digits, newest change first', async () => {
      const memory = tasksFor({
        tasks: [
          { ...task('a', { title: 'לחזור אל דנה' }), updated_at: '2026-10-01T00:00:00Z' },
          { ...task('b', { title: 'לחזור אל דנה גם כאן' }), updated_at: '2026-10-05T00:00:00Z' },
          { ...task('c', { customer_phone: '050-123 4567', customer_phone_digits: '0501234567' }), updated_at: '2026-10-02T00:00:00Z' },
          task('d', { title: 'לחזור אל דנה', deleted_at: '2026-10-10T00:00:00Z' }),
        ],
      })
      expect((await memory.gateway.search('דנה')).map((t) => t.id)).toEqual(['b', 'a'])
      expect((await memory.gateway.search('+972 50 123 4567')).map((t) => t.id)).toEqual(['c'])
      expect(await memory.gateway.search('   ')).toEqual([])
    })

    it('gives at most 200 results', async () => {
      const many = Array.from({ length: 250 }, (_, i) => task(`t${i}`, { title: 'same words' }))
      expect(await tasksFor({ tasks: many }).gateway.search('same')).toHaveLength(200)
    })
  })

  describe('subscribe', () => {
    it('delivers a pushed row to the subscribers and stores it, and stops after the unsubscribe', () => {
      const memory = tasksFor()
      const events: TaskChangeEvent[] = []
      const onState = vi.fn()
      const stop = memory.gateway.subscribe((event) => events.push(event), onState)
      expect(memory.subscribers).toBe(1)

      memory.push(task('a'))
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'upsert', task: { id: 'a' } })
      expect(memory.rows.has('a')).toBe(true)

      memory.setLive(true)
      memory.setLive(false)
      expect(onState.mock.calls.map((call) => call[0])).toEqual([true, false])

      stop()
      memory.push(task('b'))
      expect(events).toHaveLength(1)
      expect(memory.subscribers).toBe(0)
    })

    it('says nothing about the connection at first, unless it was made to be up; then it tells each new subscriber', () => {
      const quiet = vi.fn()
      tasksFor().gateway.subscribe(vi.fn(), quiet)
      expect(quiet).not.toHaveBeenCalled()

      const up = tasksFor({ live: true })
      const first = vi.fn()
      up.gateway.subscribe(vi.fn(), first)
      expect(first.mock.calls).toEqual([[true]])

      // A connection that went down is down for the next subscriber too, and a return is told to all.
      up.setLive(false)
      const second = vi.fn()
      up.gateway.subscribe(vi.fn(), second)
      expect(second).not.toHaveBeenCalled()
      up.setLive(true)
      expect(first.mock.calls).toEqual([[true], [false], [true]])
      expect(second.mock.calls).toEqual([[true]])
    })

    it('does not echo its own upserts unless asked to, as a live connection does', async () => {
      const quiet = tasksFor()
      const heardQuiet: TaskChangeEvent[] = []
      quiet.gateway.subscribe((e) => heardQuiet.push(e), vi.fn())
      await quiet.gateway.upsert('a', { title: 'x' })
      expect(heardQuiet).toEqual([])

      const echoing = tasksFor({ echo: true })
      const heard: TaskChangeEvent[] = []
      echoing.gateway.subscribe((e) => heard.push(e), vi.fn())
      await echoing.gateway.upsert('a', { title: 'x' })
      expect(heard).toHaveLength(1)
      expect(heard[0].task).toMatchObject({ id: 'a', title: 'x' })
    })
  })
})

describe('the in-memory directory gateway', () => {
  const profile = (id: string): Profile => ({
    id,
    email: `${id}@example.com`,
    display_name: id,
    role: 'employee',
    is_active: true,
    must_change_password: false,
  })

  it('returns copies of the statuses, the people and the settings, and fills in default settings', async () => {
    const memory = createMemoryDirectory({
      statuses: [{ key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1, is_active: true }],
      profiles: [profile('dana')],
    })
    const loaded = await memory.gateway.load()
    expect(loaded.statuses).toHaveLength(1)
    expect(loaded.profiles.map((p) => p.id)).toEqual(['dana'])
    expect(loaded.settings).toEqual({ glassix_url_template: '', ship_methods: ['איסוף עצמי', 'משלוח עד הבית', 'נקודת איסוף', 'CARGO'], last_backup_at: null })
    loaded.statuses.length = 0
    expect((await memory.gateway.load()).statuses).toHaveLength(1)
    expect(memory.loads).toBe(2)
  })

  it('takes the settings that it is given, and tells its subscribers about a change until they leave', async () => {
    const memory = createMemoryDirectory({
      statuses: [],
      profiles: [],
      settings: { glassix_url_template: 'https://glassix.example/c/{id}' },
    })
    expect((await memory.gateway.load()).settings.glassix_url_template).toBe('https://glassix.example/c/{id}')
    const onChange = vi.fn()
    expect(memory.subscribers).toBe(0)
    const stop = memory.gateway.subscribe(onChange)
    expect(memory.subscribers).toBe(1)
    memory.changed()
    stop()
    expect(memory.subscribers).toBe(0)
    memory.changed()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('the in-memory attachments gateway', () => {
  const files = (kind: 'image' | 'product' = 'image') => ({
    full: new Blob(['x'.repeat(100)]),
    thumb: new Blob(['x']),
    kind,
    width: 800,
    height: 600,
  })

  it('adds, lists and removes attachments, and keeps the pictures while the attachment exists', async () => {
    const memory = createMemoryAttachments({ userId: 'me', now: () => NOW })
    const first = await memory.gateway.add('task-1', files('product'))
    await memory.gateway.add('task-2', files())
    expect(first).toMatchObject({ task_id: 'task-1', bytes: 100, uploaded_by: 'me', kind: 'product', width: 800, height: 600 })
    expect(first.storage_path).toBe(`task-1/${first.id}.jpg`)
    expect(first.thumb_path).toBe(`task-1/${first.id}_t.jpg`)
    expect(memory.blobs.has(first.storage_path)).toBe(true)
    expect((await memory.gateway.list('task-1')).map((a) => a.id)).toEqual([first.id])

    await memory.gateway.remove(first)
    expect(await memory.gateway.list('task-1')).toEqual([])
    expect(memory.blobs.has(first.storage_path)).toBe(false)
    expect(memory.removedFiles).toEqual([first.storage_path, first.thumb_path])
  })

  it('lists the attachments of a task oldest first', async () => {
    let tick = 0
    const memory = createMemoryAttachments({ userId: 'me', now: () => new Date(NOW.getTime() + ++tick * 1000) })
    const a = await memory.gateway.add('task-1', files())
    const b = await memory.gateway.add('task-1', files())
    expect((await memory.gateway.list('task-1')).map((x) => x.id)).toEqual([a.id, b.id])
  })

  it('gives an address for a picture, which the caller may replace', async () => {
    const plain = createMemoryAttachments({ userId: 'me' })
    expect(await plain.gateway.signedUrl('a/b.jpg')).toContain('a/b.jpg')

    const custom = createMemoryAttachments({ userId: 'me', signedUrl: (path, blob) => `blob:${path}:${blob?.size ?? 'none'}` })
    const added = await custom.gateway.add('task-1', files())
    expect(await custom.gateway.signedUrl(added.storage_path)).toBe(`blob:${added.storage_path}:100`)
    expect(await custom.gateway.signedUrl('missing.jpg')).toBe('blob:missing.jpg:none')
  })

  it('makes its ids with the function that it is given', async () => {
    let n = 0
    const memory = createMemoryAttachments({ userId: 'me', newId: () => `id-${++n}` })
    expect((await memory.gateway.add('task-1', files())).id).toBe('id-1')
    expect((await memory.gateway.add('task-1', files())).id).toBe('id-2')
  })
})
