// @vitest-environment node
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/types'
import type { Attachment, TaskChangeEvent } from './gateways'
import { isRetryable } from './errors'
import { DEFAULT_SHIP_METHODS, newTask, type Task, type TaskPatch } from './model'
import { buildSearchFilter } from './search'
import {
  MAX_PAGES,
  PAGE_SIZE,
  createSupabaseAttachmentsGateway,
  createSupabaseDirectoryGateway,
  createSupabaseTasksGateway,
} from './supabaseGateways'

// These tests run the real supabase-js client against a stubbed network, so they pin what the
// library really sends (the URLs, the headers, the bodies) and what its errors really look like.
// The realtime socket cannot be stubbed over HTTP, so there the channel is replaced.

const PROJECT = 'https://probe.supabase.co'

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: string
  /** The signal that the library gave to `fetch`: the way to stop the request. */
  signal: AbortSignal | null
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const offline = (): never => {
  throw new TypeError('Failed to fetch')
}

function harness(respond: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const client = createClient(PROJECT, 'sb_publishable_test', {
    global: {
      fetch: async (input, init) => {
        const body = init?.body
        const request: Sent = {
          method: init?.method ?? 'GET',
          url: new URL(String(input)),
          headers: new Headers(init?.headers),
          body: typeof body === 'string' ? body : body ? '[binary]' : '',
          signal: init?.signal ?? null,
        }
        sent.push(request)
        return respond(request)
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return {
    client,
    sent,
    tasks: createSupabaseTasksGateway(client),
    directory: createSupabaseDirectoryGateway(client),
    attachments: createSupabaseAttachmentsGateway(client),
  }
}

const row = (n: number, patch: Partial<Task> = {}): Task => ({ ...newTask('user-1', `task-${n}`), no_glassix: true, ...patch })

/** A realtime channel that records what the gateway asks of it, in place of the real socket. */
function fakeRealtime(client: SupabaseClient) {
  const handlers: Array<{ filter: Record<string, unknown>; callback: (payload: unknown) => void }> = []
  let report: ((status: string) => void) | undefined
  const channel = {
    on: vi.fn((_type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void) => {
      handlers.push({ filter, callback })
      return channel
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      report = callback
      return channel
    }),
  }
  vi.spyOn(client, 'channel').mockReturnValue(channel as unknown as RealtimeChannel)
  const removeChannel = vi.spyOn(client, 'removeChannel').mockResolvedValue('ok')
  return { handlers, channel, removeChannel, status: (value: string) => report?.(value) }
}

describe('loadInitial', () => {
  const now = new Date('2026-10-15T12:00:00.000Z')
  const since = '2026-09-15T12:00:00.000Z'

  /** A server that holds `total` tasks and answers the page that was asked for. */
  const server = (total: number) => (sent: Sent) => {
    const offset = Number(sent.url.searchParams.get('offset') ?? 0)
    const limit = Number(sent.url.searchParams.get('limit') ?? PAGE_SIZE)
    const count = Math.max(0, Math.min(limit, total - offset))
    return json(200, Array.from({ length: count }, (_, i) => row(offset + i)))
  }

  it('asks for the open tasks and for those done in the last 30 days, never for deleted ones', async () => {
    const h = harness(server(3))
    await h.tasks.loadInitial(now)
    const request = h.sent[0]
    expect(request.method).toBe('GET')
    expect(request.url.pathname).toBe('/rest/v1/tasks')
    expect(request.url.searchParams.get('select')).toBe('*')
    expect(request.url.searchParams.get('deleted_at')).toBe('is.null')
    expect(request.url.searchParams.get('or')).toBe(`(done_at.is.null,done_at.gte.${since})`)
  })

  it('reads in a fixed order, so that the pages do not overlap', async () => {
    const h = harness(server(3))
    await h.tasks.loadInitial(now)
    expect(h.sent[0].url.searchParams.get('order')).toBe('created_at.asc,id.asc')
  })

  it('makes one request when the list is shorter than a page', async () => {
    const h = harness(server(5))
    const tasks = await h.tasks.loadInitial(now)
    expect(tasks).toHaveLength(5)
    expect(h.sent).toHaveLength(1)
  })

  it('goes on page after page until a page is short, and joins them in order', async () => {
    const h = harness(server(2300))
    const tasks = await h.tasks.loadInitial(now)
    expect(h.sent.map((r) => [r.url.searchParams.get('offset'), r.url.searchParams.get('limit')])).toEqual([
      ['0', '1000'],
      ['1000', '1000'],
      ['2000', '1000'],
    ])
    expect(tasks).toHaveLength(2300)
    expect(tasks.map((t) => t.id)).toEqual(Array.from({ length: 2300 }, (_, i) => `task-${i}`))
  })

  it('stops after a page that is full and the empty one that follows it', async () => {
    const h = harness(server(2000))
    expect(await h.tasks.loadInitial(now)).toHaveLength(2000)
    expect(h.sent).toHaveLength(3)
  })

  it('gives up with an error when the server never ends the list', async () => {
    // A server or a proxy that ignores the offset would otherwise keep the app reading for ever.
    const h = harness(() => json(200, Array.from({ length: PAGE_SIZE }, (_, i) => row(i))))
    const tasks = createSupabaseTasksGateway(h.client, { maxPages: 4 })
    await expect(tasks.loadInitial(now)).rejects.toThrow(/too many tasks/i)
    expect(h.sent).toHaveLength(4)
  })

  it('allows plenty of pages by default', () => {
    expect(MAX_PAGES * PAGE_SIZE).toBeGreaterThanOrEqual(100_000)
  })

  it('fails with the status of the page that failed, and does not retry behind the back of the store', async () => {
    const h = harness((sent) => (sent.url.searchParams.get('offset') === '1000' ? json(503, { message: 'busy' }) : server(5000)(sent)))
    const error = await h.tasks.loadInitial(now).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 503 })
    expect(isRetryable(error)).toBe(true)
    expect(h.sent).toHaveLength(2)
  })
})

describe('search', () => {
  it('makes no request for an empty query', async () => {
    const h = harness(() => json(200, []))
    expect(await h.tasks.search('   ')).toEqual([])
    expect(h.sent).toHaveLength(0)
  })

  it('asks the server for at most 200 undeleted tasks that match, the newest change first', async () => {
    const h = harness(() => json(200, [row(1), row(2)]))
    const found = await h.tasks.search('דנה כהן')
    expect(found.map((t) => t.id)).toEqual(['task-1', 'task-2'])
    const url = h.sent[0].url
    expect(url.pathname).toBe('/rest/v1/tasks')
    expect(url.searchParams.get('or')).toBe(`(${buildSearchFilter('דנה כהן')})`)
    expect(url.searchParams.get('deleted_at')).toBe('is.null')
    expect(url.searchParams.get('limit')).toBe('200')
    expect(url.searchParams.get('order')).toBe('updated_at.desc')
  })

  it('sends text with a comma, a quote and a percent sign as one value', async () => {
    const h = harness(() => json(200, []))
    await h.tasks.search('50%, "x"')
    expect(h.sent[0].url.searchParams.get('or')).toBe(`(${buildSearchFilter('50%, "x"')})`)
  })
})

describe('upsert', () => {
  const echo = (sent: Sent) => json(201, row(1, JSON.parse(sent.body) as Partial<Task>))

  it('sends a POST that merges into the row with the same id', async () => {
    const h = harness(echo)
    await h.tasks.upsert('task-1', { title: 'new' })
    const request = h.sent[0]
    expect(request.method).toBe('POST')
    expect(request.url.pathname).toBe('/rest/v1/tasks')
    expect(request.url.searchParams.get('on_conflict')).toBe('id')
    expect(request.headers.get('prefer')).toContain('resolution=merge-duplicates')
    expect(request.headers.get('prefer')).toContain('return=representation')
  })

  it('sends the id and exactly the fields of the patch', async () => {
    const h = harness(echo)
    await h.tasks.upsert('task-1', { title: 'new', priority: 'high' })
    expect(JSON.parse(h.sent[0].body)).toEqual({ id: 'task-1', title: 'new', priority: 'high' })
  })

  it('sends null when a field is cleared, and nothing for a field that is undefined', async () => {
    const h = harness(echo)
    await h.tasks.upsert('task-1', { assignee_id: null, due_at: null, notes: undefined })
    expect(JSON.parse(h.sent[0].body)).toEqual({ id: 'task-1', assignee_id: null, due_at: null })
  })

  it('never sends a field that the database keeps itself, not even by mistake', async () => {
    const h = harness(echo)
    const stray = {
      title: 'x',
      id: 'another-task',
      created_by: 'somebody',
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
      done_by: 'somebody',
      customer_phone_digits: '0501234567',
    } as unknown as TaskPatch
    await h.tasks.upsert('task-1', stray)
    expect(JSON.parse(h.sent[0].body)).toEqual({ id: 'task-1', title: 'x' })
  })

  it('sends the same request every time, so that a resend is harmless', async () => {
    const h = harness(echo)
    await h.tasks.upsert('task-1', { title: 'new', done_at: '2026-10-15T09:00:00.000Z' })
    await h.tasks.upsert('task-1', { title: 'new', done_at: '2026-10-15T09:00:00.000Z' })
    expect(h.sent[1].body).toBe(h.sent[0].body)
    expect(h.sent[1].url.href).toBe(h.sent[0].url.href)
  })

  it('returns the row that the server answered with', async () => {
    const h = harness(() => json(201, row(1, { title: 'saved by the server', updated_at: '2026-10-15T10:00:00+00:00' })))
    const saved = await h.tasks.upsert('task-1', { title: 'new' })
    expect(saved).toMatchObject({ id: 'task-1', title: 'saved by the server', updated_at: '2026-10-15T10:00:00+00:00' })
  })

  it('asks for the row as one object, not a list', async () => {
    const h = harness(echo)
    await h.tasks.upsert('task-1', { title: 'new' })
    expect(h.sent[0].headers.get('accept')).toBe('application/vnd.pgrst.object+json')
  })

  describe('a request that is told to stop', () => {
    /** A server that never answers: the request ends only when the signal of the request says so. */
    const silent = (sent: Sent) =>
      new Promise<Response>((_resolve, reject) => {
        sent.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')))
      })

    it('stops when the signal that it was given is aborted, and reads as a request that did not get to the server', async () => {
      const h = harness(silent)
      const controller = new AbortController()
      const saving = h.tasks.upsert('task-1', { title: 'new' }, { signal: controller.signal }).catch((e: unknown) => e)
      await vi.waitFor(() => expect(h.sent).toHaveLength(1))
      controller.abort()
      const error = await saving
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ status: 0 })
      expect(isRetryable(error)).toBe(true)
    })

    it('sends the same request with or without a signal', async () => {
      const h = harness(echo)
      await h.tasks.upsert('task-1', { title: 'new' })
      await h.tasks.upsert('task-1', { title: 'new' }, { signal: new AbortController().signal })
      expect(h.sent[1].body).toBe(h.sent[0].body)
      expect(h.sent[1].url.href).toBe(h.sent[0].url.href)
    })
  })
})

describe('errors', () => {
  it.each([
    ['a 500 from the database API', () => json(500, { message: 'boom' }), 500],
    ['a 502 HTML page from a proxy', () => new Response('<html>Bad gateway</html>', { status: 502 }), 502],
    ['no answer at all (offline)', offline, 0],
  ])('are retryable after %s', async (_name, fail, status) => {
    const h = harness(fail)
    const error = await h.tasks.upsert('task-1', { title: 'new' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ status })
    expect(isRetryable(error)).toBe(true)
  })

  it('are not retryable when the database refuses the change, and keep the code of the rule', async () => {
    const h = harness(() =>
      json(400, {
        code: '23514',
        message: 'new row for relation "tasks" violates check constraint "tasks_glassix_rule"',
      }),
    )
    const error = await h.tasks.upsert('task-1', { title: 'new' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 400, code: '23514' })
    expect((error as Error).message).toContain('tasks_glassix_rule')
    expect(isRetryable(error)).toBe(false)
  })

  it.each([
    ['an expired login', json(401, { code: 'PGRST301', message: 'JWT expired' }), 401],
    ['a duplicate key', json(409, { code: '23505', message: 'duplicate key value' }), 409],
    ['a missing permission', json(403, { code: '42501', message: 'permission denied for table tasks' }), 403],
  ])('are not retryable after %s', async (_name, response, status) => {
    const h = harness(() => response.clone())
    const error = await h.tasks.upsert('task-1', { title: 'new' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ status })
    expect(isRetryable(error)).toBe(false)
  })

  it('also reach the caller from a read that could not reach the server', async () => {
    const h = harness(offline)
    const error = await h.tasks.loadHistory('task-1').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0 })
    expect(isRetryable(error)).toBe(true)
    expect(h.sent).toHaveLength(1)
  })
})

describe('subscribe', () => {
  const task = row(1, { title: 'from another device' })

  it('listens to every change of the tasks table', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    h.tasks.subscribe(vi.fn(), vi.fn())
    expect(realtime.handlers.map((handler) => handler.filter)).toEqual([{ event: '*', schema: 'public', table: 'tasks' }])
    expect(realtime.channel.subscribe).toHaveBeenCalledTimes(1)
  })

  it('turns a new or a changed row into an upsert event', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    const events: TaskChangeEvent[] = []
    h.tasks.subscribe((event) => events.push(event), vi.fn())
    realtime.handlers[0].callback({ eventType: 'INSERT', new: task, old: {} })
    realtime.handlers[0].callback({ eventType: 'UPDATE', new: { ...task, title: 'edited' }, old: { id: task.id } })
    expect(events).toEqual([
      { type: 'upsert', task },
      { type: 'upsert', task: { ...task, title: 'edited' } },
    ])
  })

  it('ignores a delete, which the app never does (it marks a task deleted instead)', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    const onEvent = vi.fn()
    h.tasks.subscribe(onEvent, vi.fn())
    realtime.handlers[0].callback({ eventType: 'DELETE', new: {}, old: { id: task.id } })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('reports whether the connection is live', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    const onState = vi.fn()
    h.tasks.subscribe(vi.fn(), onState)
    realtime.status('SUBSCRIBED')
    realtime.status('CHANNEL_ERROR')
    realtime.status('SUBSCRIBED')
    realtime.status('TIMED_OUT')
    realtime.status('CLOSED')
    expect(onState.mock.calls.map((call) => call[0])).toEqual([true, false, true, false, false])
  })

  it('removes the channel when the returned function is called', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    const stop = h.tasks.subscribe(vi.fn(), vi.fn())
    expect(realtime.removeChannel).not.toHaveBeenCalled()
    stop()
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel)
  })
})

describe('history', () => {
  it("asks for the events of the task, newest first, and returns them as they come", async () => {
    const events = [
      { id: 12, task_id: 'task-1', actor_id: 'u1', type: 'done', changes: { done_at: [null, '2026-10-15T10:00:00+00:00'] }, at: '2026-10-15T10:00:00+00:00' },
      { id: 7, task_id: 'task-1', actor_id: 'u1', type: 'created', changes: {}, at: '2026-10-14T08:00:00+00:00' },
    ]
    const h = harness(() => json(200, events))
    expect(await h.tasks.loadHistory('task-1')).toEqual(events)
    const url = h.sent[0].url
    expect(url.pathname).toBe('/rest/v1/task_events')
    expect(url.searchParams.get('task_id')).toBe('eq.task-1')
    expect(url.searchParams.get('order')).toBe('at.desc,id.desc')
  })
})

describe('directory', () => {
  const profile = (patch: Partial<Profile> = {}): Profile => ({
    id: 'u1',
    email: 'dana@example.com',
    display_name: 'דנה',
    role: 'employee',
    is_active: true,
    must_change_password: false,
    default_remind_min: 15,
    ...patch,
  })
  const status = (key: string, sort: number) => ({ key, name_he: key, color: '#000000', sort, is_active: true })

  const answers = (settings: unknown[], statuses: unknown[] = [status('processing', 1)], profiles: unknown[] = [profile()]) =>
    (sent: Sent) => {
      switch (sent.url.pathname) {
        case '/rest/v1/statuses':
          return json(200, statuses)
        case '/rest/v1/profiles':
          return json(200, profiles)
        case '/rest/v1/app_settings':
          return json(200, settings)
        default:
          return json(404, { message: 'unexpected request' })
      }
    }

  it('asks for the statuses in their order, the profiles by name and the settings', async () => {
    const h = harness(answers([]))
    await h.directory.load()
    const requests = Object.fromEntries(h.sent.map((r) => [r.url.pathname, r.url]))
    expect(requests['/rest/v1/statuses'].searchParams.get('order')).toBe('sort.asc')
    expect(requests['/rest/v1/statuses'].searchParams.get('select')).toBe('key,name_he,color,sort,is_active')
    expect(requests['/rest/v1/profiles'].searchParams.get('order')).toBe('display_name.asc')
    expect(requests['/rest/v1/profiles'].searchParams.get('select')).toBe(
      'id,email,display_name,role,is_active,must_change_password,default_remind_min',
    )
    expect(requests['/rest/v1/app_settings'].searchParams.get('select')).toBe('key,value')
  })

  it('returns the statuses and the profiles as they come', async () => {
    const statuses = [status('processing', 1), status('cargo', 8)]
    const profiles = [profile(), profile({ id: 'u2', display_name: 'אבי', role: 'admin' })]
    const h = harness(answers([], statuses, profiles))
    const loaded = await h.directory.load()
    expect(loaded.statuses).toEqual(statuses)
    expect(loaded.profiles).toEqual(profiles)
  })

  it('turns the settings rows into one typed object', async () => {
    const h = harness(
      answers([
        { key: 'glassix_url_template', value: 'https://app.example/c/{id}' },
        { key: 'ship_methods', value: ['איסוף עצמי', 'CARGO'] },
        { key: 'last_backup_at', value: '2026-10-10T08:00:00+00:00' },
      ]),
    )
    expect((await h.directory.load()).settings).toEqual({
      glassix_url_template: 'https://app.example/c/{id}',
      ship_methods: ['איסוף עצמי', 'CARGO'],
      last_backup_at: '2026-10-10T08:00:00+00:00',
    })
  })

  it('fills in defaults for a setting that is missing', async () => {
    const h = harness(answers([]))
    expect((await h.directory.load()).settings).toEqual({
      glassix_url_template: '',
      ship_methods: [...DEFAULT_SHIP_METHODS],
      last_backup_at: null,
    })
  })

  it('uses the defaults for a setting that has the wrong shape', async () => {
    const h = harness(
      answers([
        { key: 'glassix_url_template', value: 42 },
        { key: 'ship_methods', value: ['ok', 7] },
        { key: 'last_backup_at', value: { when: 'yesterday' } },
      ]),
    )
    expect((await h.directory.load()).settings).toEqual({
      glassix_url_template: '',
      ship_methods: [...DEFAULT_SHIP_METHODS],
      last_backup_at: null,
    })
  })

  it('fails with the status of whichever request failed', async () => {
    const h = harness((sent) => (sent.url.pathname === '/rest/v1/profiles' ? json(500, { message: 'boom' }) : answers([])(sent)))
    const error = await h.directory.load().catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 500 })
    expect(isRetryable(error)).toBe(true)
  })

  it('listens to the statuses, the settings and the profiles, and reports any change', () => {
    const h = harness(() => json(200, []))
    const realtime = fakeRealtime(h.client)
    const onChange = vi.fn()
    const stop = h.directory.subscribe(onChange)
    expect(realtime.handlers.map((handler) => handler.filter)).toEqual([
      { event: '*', schema: 'public', table: 'statuses' },
      { event: '*', schema: 'public', table: 'app_settings' },
      { event: '*', schema: 'public', table: 'profiles' },
    ])
    for (const handler of realtime.handlers) handler.callback({ eventType: 'UPDATE', new: {}, old: {} })
    expect(onChange).toHaveBeenCalledTimes(3)
    stop()
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel)
  })
})

describe('attachments', () => {
  const TASK = '3f2b8a52-6c1e-4d52-9d07-0d3a1f0e9a11'
  const files = (kind: 'image' | 'product' = 'image') => ({
    full: new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
    kind,
    width: 1600,
    height: 1200,
  })
  const stored = (patch: Partial<Attachment> = {}): Attachment => ({
    id: 'a-1',
    task_id: TASK,
    storage_path: `${TASK}/a-1.jpg`,
    thumb_path: `${TASK}/a-1_t.jpg`,
    kind: 'image',
    width: 1600,
    height: 1200,
    bytes: 2048,
    uploaded_by: 'user-1',
    created_at: '2026-10-15T10:00:00+00:00',
    ...patch,
  })
  const isUpload = (sent: Sent) => sent.method === 'POST' && sent.url.pathname.startsWith('/storage/v1/object/task-files/')
  const isStorageRemove = (sent: Sent) => sent.method === 'DELETE' && sent.url.pathname === '/storage/v1/object/task-files'
  const removedPaths = (sent: Sent) => (JSON.parse(sent.body) as { prefixes: string[] }).prefixes

  describe('add', () => {
    it('uploads the picture and the thumbnail, then adds the row last', async () => {
      const h = harness((sent) => {
        if (isUpload(sent)) return json(200, { Id: 'x', Key: 'task-files/x' })
        if (sent.url.pathname === '/rest/v1/attachments') return json(201, stored())
        return json(404, { message: 'unexpected' })
      })
      const added = await h.attachments.add(TASK, files('product'))

      expect(h.sent.map((r) => `${r.method} ${r.url.pathname.startsWith('/storage') ? 'storage' : 'rest'}`)).toEqual([
        'POST storage',
        'POST storage',
        'POST rest',
      ])
      const [fullUpload, thumbUpload, insert] = h.sent
      const fullPath = decodeURIComponent(fullUpload.url.pathname.replace('/storage/v1/object/task-files/', ''))
      const thumbPath = decodeURIComponent(thumbUpload.url.pathname.replace('/storage/v1/object/task-files/', ''))
      expect(fullPath).toMatch(new RegExp(`^${TASK}/[0-9a-f-]{36}\\.jpg$`))
      expect(thumbPath).toBe(fullPath.replace(/\.jpg$/, '_t.jpg'))

      const body = JSON.parse(insert.body) as Record<string, unknown>
      expect(body).toEqual({
        id: fullPath.split('/')[1].replace('.jpg', ''),
        task_id: TASK,
        storage_path: fullPath,
        thumb_path: thumbPath,
        kind: 'product',
        width: 1600,
        height: 1200,
        bytes: 2048,
      })
      expect(added).toEqual(stored())
    })

    it('leaves the uploader to the database, which fills in the signed-in user', async () => {
      const h = harness((sent) => (isUpload(sent) ? json(200, {}) : json(201, stored())))
      await h.attachments.add(TASK, files())
      expect(JSON.parse(h.sent[2].body)).not.toHaveProperty('uploaded_by')
    })

    it('removes both pictures again when the row is refused, and reports the refusal', async () => {
      const h = harness((sent) => {
        if (isUpload(sent)) return json(200, {})
        if (sent.url.pathname === '/rest/v1/attachments') {
          return json(403, { code: '42501', message: 'new row violates row-level security policy for table "attachments"' })
        }
        if (isStorageRemove(sent)) return json(200, [])
        return json(404, { message: 'unexpected' })
      })
      const error = await h.attachments.add(TASK, files()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 403, code: '42501' })
      const cleanup = h.sent.find(isStorageRemove)
      expect(cleanup).toBeDefined()
      const uploaded = h.sent.filter(isUpload).map((r) => decodeURIComponent(r.url.pathname.replace('/storage/v1/object/task-files/', '')))
      expect(removedPaths(cleanup!).sort()).toEqual([...uploaded].sort())
    })

    it('removes the first picture when the thumbnail cannot be uploaded, and adds no row', async () => {
      let uploads = 0
      const h = harness((sent) => {
        if (isUpload(sent)) return ++uploads === 1 ? json(200, {}) : json(500, { message: 'storage is down', statusCode: '500' })
        if (isStorageRemove(sent)) return json(200, [])
        return json(404, { message: 'unexpected' })
      })
      const error = await h.attachments.add(TASK, files()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 500 })
      expect(isRetryable(error)).toBe(true)
      expect(h.sent.some((r) => r.url.pathname === '/rest/v1/attachments')).toBe(false)
      const firstPath = decodeURIComponent(h.sent[0].url.pathname.replace('/storage/v1/object/task-files/', ''))
      expect(removedPaths(h.sent.find(isStorageRemove)!)).toEqual([firstPath])
    })

    it('does nothing more when the first upload fails', async () => {
      const h = harness(() => json(413, { message: 'The object exceeded the maximum allowed size', statusCode: '413' }))
      const error = await h.attachments.add(TASK, files()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 413 })
      expect(isRetryable(error)).toBe(false)
      expect(h.sent).toHaveLength(1)
    })

    it('reports a connection that is down as a retryable error, with nothing left behind', async () => {
      const h = harness(offline)
      const error = await h.attachments.add(TASK, files()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 0 })
      expect(isRetryable(error)).toBe(true)
    })
  })

  describe('remove', () => {
    it('deletes the row first and the two files after it', async () => {
      const h = harness((sent) => {
        if (sent.url.pathname === '/rest/v1/attachments') return json(200, [{ id: 'a-1' }])
        if (isStorageRemove(sent)) return json(200, [])
        return json(404, { message: 'unexpected' })
      })
      await h.attachments.remove(stored())
      expect(h.sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
        'DELETE /rest/v1/attachments',
        'DELETE /storage/v1/object/task-files',
      ])
      expect(h.sent[0].url.searchParams.get('id')).toBe('eq.a-1')
      expect(removedPaths(h.sent[1]).sort()).toEqual([`${TASK}/a-1.jpg`, `${TASK}/a-1_t.jpg`])
    })

    it('does not mind a file that cannot be removed', async () => {
      const h = harness((sent) =>
        sent.url.pathname === '/rest/v1/attachments' ? json(200, [{ id: 'a-1' }]) : json(500, { message: 'storage is down' }),
      )
      await expect(h.attachments.remove(stored())).resolves.toBeUndefined()
    })

    it('does not mind a storage that cannot be reached', async () => {
      const h = harness((sent) => (sent.url.pathname === '/rest/v1/attachments' ? json(200, [{ id: 'a-1' }]) : offline()))
      await expect(h.attachments.remove(stored())).resolves.toBeUndefined()
    })

    it('leaves the files alone when the row cannot be deleted', async () => {
      const h = harness(() => json(500, { message: 'boom' }))
      const error = await h.attachments.remove(stored()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 500 })
      expect(h.sent.some(isStorageRemove)).toBe(false)
    })

    it('says so when the database silently refuses to delete the row of somebody else', async () => {
      // Row level security hides the row from the delete: no error, no row deleted. The row is still there.
      const h = harness((sent) => (sent.method === 'DELETE' ? json(200, []) : json(200, [{ id: 'a-1' }])))
      const error = await h.attachments.remove(stored()).catch((e: unknown) => e)
      expect(error).toMatchObject({ status: 403 })
      expect(h.sent.some(isStorageRemove)).toBe(false)
    })

    it('treats a row that is already gone as removed, and still removes the files', async () => {
      // Nothing was deleted, and a look for the row finds nothing.
      const h = harness(() => json(200, []))
      await expect(h.attachments.remove(stored())).resolves.toBeUndefined()
      expect(h.sent.some(isStorageRemove)).toBe(true)
    })
  })

  describe('signedUrl', () => {
    it('asks for an address that works for one hour', async () => {
      const h = harness((sent) => {
        if (sent.url.pathname.startsWith('/storage/v1/object/sign/task-files/')) {
          return json(200, { signedURL: `/object/sign/task-files/${TASK}/a-1.jpg?token=abc` })
        }
        return json(404, { message: 'unexpected' })
      })
      const url = await h.attachments.signedUrl(`${TASK}/a-1.jpg`)
      expect(url).toBe(`${PROJECT}/storage/v1/object/sign/task-files/${TASK}/a-1.jpg?token=abc`)
      expect(JSON.parse(h.sent[0].body)).toEqual({ expiresIn: 3600 })
    })

    it('fails with the status of the refusal', async () => {
      const h = harness(() => json(400, { message: 'Object not found', statusCode: '404', error: 'not_found' }))
      const error = await h.attachments.signedUrl('missing.jpg').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(typeof (error as { status: unknown }).status).toBe('number')
    })
  })

  describe('list', () => {
    it('asks for the attachments of one task, oldest first', async () => {
      const h = harness(() => json(200, [stored(), stored({ id: 'a-2' })]))
      expect((await h.attachments.list(TASK)).map((a) => a.id)).toEqual(['a-1', 'a-2'])
      const url = h.sent[0].url
      expect(url.pathname).toBe('/rest/v1/attachments')
      expect(url.searchParams.get('task_id')).toBe(`eq.${TASK}`)
      expect(url.searchParams.get('order')).toBe('created_at.asc')
    })
  })
})
