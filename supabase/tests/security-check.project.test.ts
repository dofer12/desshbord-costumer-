// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSupabaseProbe, type Probe, type World } from './security-check'

// The probe of a real project, over a pretend network. Nothing here proves what Supabase answers;
// that is for the owner's own run. What it pins is what the probe does with its side of the
// conversation: that every person's requests carry their own credentials (a check that acted as the
// wrong person would prove nothing), that it asks for the changes in the way the app does, that it
// reads the answers that mean "no" as refusals and no other, and that its cleanup deletes what the
// check made and nothing else, in an order that works.

const settings = { url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_abcdefghijklmnop', secretKey: 'sb_secret_abcdefghijklmnop' }

interface Call {
  method: string
  path: string
  query: URLSearchParams
  headers: Headers
  body: string
  /** The size of a body that is not text, such as an uploaded file. */
  bytes: number
}
type Answer = { status: number; body?: unknown; headers?: Record<string, string> }

function pretend(route: (call: Call) => Answer) {
  const calls: Call[] = []
  const stub: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
      bytes: ArrayBuffer.isView(init?.body) ? init.body.byteLength : 0,
    }
    calls.push(call)
    const { status, body, headers } = route(call)
    return new Response(status === 204 || status === 201 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  }
  return { fetch: stub, calls }
}

const json = (body: unknown): Answer => ({ status: 200, body })
const denied: Answer = { status: 403, body: { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "tasks"' } }

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const REAL = id(1)
const TEMP_ADMIN = id(2)
const TEMP_INACTIVE = id(3)
const OTHER_HOST = id(4)
const OTHER_START = id(5)
const NO_EMAIL = id(6)
const OTHER_END = id(7)

const USERS = [
  { id: REAL, email: 'dana@moked.co.il' },
  { id: TEMP_ADMIN, email: 'security-check-abc12345-admin@example.com' },
  { id: TEMP_INACTIVE, email: 'security-check-abc12345-inactive@example.com' },
  { id: OTHER_HOST, email: 'security-check-notes@gmail.com' },
  { id: OTHER_START, email: 'my-security-check-x@example.com' },
  { id: NO_EMAIL, email: null },
  { id: OTHER_END, email: 'security-check-x@example.community' },
]

/** A project that holds one task with the mark of the check, one task by a temporary user, and some leftovers. */
function project(route: (call: Call) => Answer | undefined = () => undefined) {
  return pretend((call) => {
    const special = route(call)
    if (special) return special
    const { method, path } = call
    if (method === 'GET' && path === '/auth/v1/admin/users') return json({ users: USERS, aud: 'authenticated' })
    if (method === 'GET' && path === '/rest/v1/tasks') return json(call.query.has('title') ? [{ id: 't-marked' }] : [{ id: 't-by-temp-user' }])
    if (method === 'POST' && path.startsWith('/storage/v1/object/list/task-files')) return json([{ name: 'a.jpg' }, { name: 'b.jpg' }])
    if (method === 'DELETE' && path === '/storage/v1/object/task-files') return json([])
    if (method === 'DELETE' && ['/rest/v1/statuses', '/rest/v1/app_settings', '/rest/v1/tasks'].includes(path)) return { status: 204 }
    if (method === 'DELETE' && path.startsWith('/auth/v1/admin/users/')) return json({})
    return { status: 500, body: { message: `unexpected ${method} ${path}` } }
  })
}

const isUserDelete = (c: Call) => c.method === 'DELETE' && c.path.startsWith('/auth/v1/admin/users/')
const deletedUsers = (calls: Call[]) => calls.filter(isUserDelete).map((c) => c.path.split('/').pop())

describe('the cleanup of the check on a real project', () => {
  it('deletes the temporary users, the tasks that carry the mark and their files, and nothing else', async () => {
    const { fetch, calls } = project()

    const left = await createSupabaseProbe(settings, { fetch }).cleanup()

    expect(left).toEqual([])
    // Only the two users whose address is that of a temporary user. A real colleague, an address on
    // another host, an address that only contains the words or only begins like the domain, and a
    // user with no address stay.
    expect(deletedUsers(calls)).toEqual([TEMP_ADMIN, TEMP_INACTIVE])
    // The tasks are those that carry the mark in the title and those that a temporary user made.
    const byAuthor = calls.find((c) => c.method === 'GET' && c.path === '/rest/v1/tasks' && c.query.has('created_by'))
    expect(byAuthor?.query.get('created_by')).toBe(`in.(${TEMP_ADMIN},${TEMP_INACTIVE})`)
    const byTitle = calls.find((c) => c.method === 'GET' && c.path === '/rest/v1/tasks' && c.query.has('title'))
    expect(byTitle?.query.get('title')).toBe('like.security-check-%')
    const tasksDelete = calls.find((c) => c.method === 'DELETE' && c.path === '/rest/v1/tasks')
    expect(tasksDelete?.query.get('id')).toBe('in.(t-marked,t-by-temp-user)')
    // The settings that carry the mark.
    for (const table of ['statuses', 'app_settings']) {
      const call = calls.find((c) => c.method === 'DELETE' && c.path === `/rest/v1/${table}`)
      expect(call?.query.get('key'), table).toBe('like.security-check-%')
    }
    // The files of each of those tasks.
    const removed = calls.filter((c) => c.method === 'DELETE' && c.path === '/storage/v1/object/task-files').map((c) => JSON.parse(c.body).prefixes)
    expect(removed).toEqual([
      ['t-marked/a.jpg', 't-marked/b.jpg'],
      ['t-by-temp-user/a.jpg', 't-by-temp-user/b.jpg'],
    ])
  })

  it('deletes the files first, then the tasks, and the users last, because a user who made a task cannot be deleted while it is there', async () => {
    const { fetch, calls } = project()
    await createSupabaseProbe(settings, { fetch }).cleanup()

    const files = calls.findIndex((c) => c.path === '/storage/v1/object/task-files' && c.method === 'DELETE')
    const tasks = calls.findIndex((c) => c.path === '/rest/v1/tasks' && c.method === 'DELETE')
    const firstUser = calls.findIndex(isUserDelete)
    expect(files).toBeGreaterThan(-1)
    expect(files).toBeLessThan(tasks)
    expect(tasks).toBeLessThan(firstUser)
  })

  it('deletes nothing when the project holds nothing of the check', async () => {
    const { fetch, calls } = project((c) => {
      if (c.method === 'GET' && c.path === '/auth/v1/admin/users') return json({ users: [USERS[0]], aud: 'authenticated' })
      if (c.method === 'GET' && c.path === '/rest/v1/tasks') return json([])
      return undefined
    })

    expect(await createSupabaseProbe(settings, { fetch }).cleanup()).toEqual([])
    expect(deletedUsers(calls)).toEqual([])
    expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/rest/v1/tasks')).toEqual([])
    expect(calls.filter((c) => c.method === 'DELETE' && c.path.startsWith('/storage/'))).toEqual([])
  })

  it('goes on after something cannot be deleted, and says what is left', async () => {
    const { fetch, calls } = project((c) => (c.method === 'DELETE' && c.path.endsWith(TEMP_ADMIN) ? { status: 500, body: { message: 'database error' } } : undefined))

    const left = await createSupabaseProbe(settings, { fetch }).cleanup()

    expect(left).toHaveLength(1)
    expect(left[0]).toContain(TEMP_ADMIN)
    expect(left[0]).toContain('database error')
    expect(deletedUsers(calls)).toEqual([TEMP_ADMIN, TEMP_INACTIVE])
  })
})

describe('the setup of the check on a real project', () => {
  it('says that the project did not accept the key, and then has nothing to clean', async () => {
    const { fetch, calls } = project((c) => (c.path === '/auth/v1/admin/users' ? { status: 401, body: { message: 'Invalid API key' } } : undefined))
    const probe = createSupabaseProbe(settings, { fetch })

    await expect(probe.setup()).rejects.toThrow(/did not accept the secret key \(Invalid API key\).*sb_secret_/)
    expect(await probe.cleanup()).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('says that the project could not be reached', async () => {
    const down: typeof fetch = async () => {
      throw new TypeError('fetch failed')
    }
    const probe = createSupabaseProbe(settings, { fetch: down })

    await expect(probe.setup()).rejects.toThrow(/could not reach the project \(fetch failed\)/)
    expect(await probe.cleanup()).toEqual([])
  })

  it('does not go on when what an earlier run left behind cannot be deleted', async () => {
    const { fetch, calls } = project((c) => (isUserDelete(c) ? { status: 500, body: { message: 'database error' } } : undefined))

    await expect(createSupabaseProbe(settings, { fetch }).setup()).rejects.toThrow(/left behind could not be deleted.*database error/)
    // No temporary user was made on top of the leftovers.
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/auth/v1/admin/users')).toEqual([])
  })
})

// --- A project that lets the check make its users, sign them in and write its rows.

const tokenOf = (userId: string) => `e30.${Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: 4102444800 })).toString('base64url')}.signature`

/**
 * A clean project that lets the setup through. Once the setup is done, `route` answers first, so that
 * a test can say what a request gets.
 */
async function liveProject(route: (call: Call) => Answer | undefined = () => undefined) {
  let ready = false
  let made = 0
  const idOf = new Map<string, string>()
  const { fetch, calls } = project((call) => {
    if (ready) {
      const special = route(call)
      if (special) return special
    }
    const { method, path } = call
    if (method === 'GET' && path === '/auth/v1/admin/users') return json({ users: [USERS[0]], aud: 'authenticated' })
    if (method === 'GET' && path === '/rest/v1/tasks') return json([])
    if (method === 'POST' && path === '/auth/v1/admin/users') {
      const email = JSON.parse(call.body).email as string
      idOf.set(email, id(100 + ++made))
      return json({ id: idOf.get(email), email })
    }
    if (method === 'POST' && path === '/auth/v1/token') {
      const email = JSON.parse(call.body).email as string
      const userId = idOf.get(email)
      return json({ access_token: tokenOf(userId ?? ''), token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: userId, email } })
    }
    if (method === 'PATCH' && path === '/rest/v1/profiles') return { status: 204, headers: { 'content-range': '*/1' } }
    if (method === 'POST' && ['/rest/v1/tasks', '/rest/v1/attachments', '/rest/v1/statuses', '/rest/v1/app_settings'].includes(path)) return { status: 201 }
    if (method === 'POST' && path.startsWith('/storage/v1/object/task-files/')) return json({ Key: 'task-files/x' })
    return undefined
  })
  const probe = createSupabaseProbe(settings, { fetch })
  const world = await probe.setup()
  const setupCalls = [...calls]
  ready = true
  calls.length = 0
  return { probe, world, calls, setupCalls }
}

const MEMBERS = ['admin', 'employee', 'colleague', 'inactive'] as const

describe('who acts in a real project', () => {
  it('makes an administrator, two employees and a member who is then deactivated, and signs each of them in', async () => {
    const { world, setupCalls } = await liveProject()

    const made = setupCalls.filter((c) => c.method === 'POST' && c.path === '/auth/v1/admin/users').map((c) => JSON.parse(c.body))
    expect(made.map((m) => m.app_metadata.role)).toEqual(['admin', 'employee', 'employee', 'employee'])
    expect(made.map((m) => (m.email as string).replace(/^security-check-[0-9a-f]{8}-/, ''))).toEqual([
      'admin@example.com',
      'employee@example.com',
      'colleague@example.com',
      'inactive@example.com',
    ])
    for (const m of made) {
      expect(m.email_confirm).toBe(true)
      expect(m.password.length).toBeGreaterThanOrEqual(20)
      expect(m.user_metadata.display_name).toMatch(/^security-check-/)
    }
    expect(new Set(made.map((m) => m.password)).size).toBe(4)

    const signedIn = setupCalls.filter((c) => c.method === 'POST' && c.path === '/auth/v1/token').map((c) => JSON.parse(c.body).email)
    expect(signedIn).toEqual(made.map((m) => m.email))

    const off = setupCalls.find((c) => c.method === 'PATCH' && c.path === '/rest/v1/profiles')
    expect(JSON.parse(off?.body ?? '{}')).toEqual({ is_active: false })
    expect(off?.query.get('id')).toBe(`eq.${world.ids.inactive}`)
  })

  it('lets each person act with their own credentials, and the visitor with the public key', async () => {
    const { probe, world, calls } = await liveProject()

    for (const who of [...MEMBERS, 'anon'] as const) await probe.db(who, { op: 'select', table: 'tasks' })

    const bearers = calls.map((c) => c.headers.get('authorization'))
    expect(bearers).toEqual([...MEMBERS.map((who) => `Bearer ${tokenOf(world.ids[who])}`), `Bearer ${settings.publishableKey}`])
    expect(new Set(bearers).size).toBe(5)
    for (const c of calls) expect(c.headers.get('apikey')).toBe(settings.publishableKey)
  })

  it('writes the rows to try as the owner of the project', async () => {
    const { world, calls } = await liveProject()

    await world.newTask('employee')
    await world.newAttachment('colleague')
    await world.newSetting('statuses')

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /rest/v1/tasks', 'POST /rest/v1/attachments', 'POST /rest/v1/statuses'])
    for (const c of calls) {
      expect(c.headers.get('authorization')).toBe(`Bearer ${settings.secretKey}`)
      expect(c.headers.get('apikey')).toBe(settings.secretKey)
    }
  })

  it('puts the mark of the run on everything that it makes, so that the cleanup finds it', async () => {
    const { world, calls } = await liveProject()

    await world.newTask('admin')
    await world.newSetting('app_settings')

    expect(world.mark).toMatch(/^security-check-[0-9a-f]{8}$/)
    expect(JSON.parse(calls[0].body).title).toBe(world.mark)
    expect(JSON.parse(calls[1].body).key).toMatch(new RegExp(`^${world.mark}-app_settings-\\d+$`))
    expect(world.fresh('name')).toMatch(new RegExp(`^${world.mark}-name-\\d+$`))
    expect(world.fresh('name')).not.toBe(world.fresh('name'))
  })
})

describe('what a real project is asked', () => {
  const taskId = id(900)

  async function ask(run: (probe: Probe, world: World) => Promise<unknown>) {
    const { probe, world, calls } = await liveProject()
    await run(probe, world)
    return calls.at(-1)!
  }

  it('writes a row without asking for it back, as the app does', async () => {
    const insert = await ask((p) => p.db('employee', { op: 'insert', table: 'tasks', row: { id: taskId, title: 'x' } }))
    expect(`${insert.method} ${insert.path}`).toBe('POST /rest/v1/tasks')
    expect(JSON.parse(insert.body)).toEqual({ id: taskId, title: 'x' })
    expect(insert.headers.get('prefer') ?? '').not.toContain('return=representation')
  })

  it('upserts on the id, as the app does when it sends a change again', async () => {
    const upsert = await ask((p) => p.db('employee', { op: 'upsert', table: 'tasks', row: { id: taskId, title: 'x' } }))
    expect(`${upsert.method} ${upsert.path}`).toBe('POST /rest/v1/tasks')
    expect(upsert.query.get('on_conflict')).toBe('id')
    expect(upsert.headers.get('prefer')).toContain('resolution=merge-duplicates')
    expect(upsert.headers.get('prefer') ?? '').not.toContain('return=representation')
  })

  it('counts the rows of an update and of a delete, without asking for them back', async () => {
    const update = await ask((p) => p.db('employee', { op: 'update', table: 'tasks', match: { id: taskId }, patch: { notes: 'n' } }))
    expect(`${update.method} ${update.path}`).toBe('PATCH /rest/v1/tasks')
    expect(update.query.get('id')).toBe(`eq.${taskId}`)
    expect(JSON.parse(update.body)).toEqual({ notes: 'n' })
    expect(update.headers.get('prefer')).toContain('count=exact')
    expect(update.headers.get('prefer')).not.toContain('return=representation')

    const del = await ask((p) => p.db('employee', { op: 'delete', table: 'tasks', match: { id: taskId } }))
    expect(`${del.method} ${del.path}`).toBe('DELETE /rest/v1/tasks')
    expect(del.query.get('id')).toBe(`eq.${taskId}`)
    expect(del.headers.get('prefer')).toContain('count=exact')
    expect(del.headers.get('prefer')).not.toContain('return=representation')
  })

  it('reads the columns it was asked for, and calls a function by name with its arguments', async () => {
    const select = await ask((p) => p.db('admin', { op: 'select', table: 'tasks', columns: 'created_by', match: { id: taskId } }))
    expect(`${select.method} ${select.path}`).toBe('GET /rest/v1/tasks')
    expect(select.query.get('select')).toBe('created_by')
    expect(select.query.get('id')).toBe(`eq.${taskId}`)

    const rpc = await ask((p) => p.db('employee', { op: 'rpc', fn: 'update_my_profile', args: { p_display_name: 'n', p_default_remind_min: 20 } }))
    expect(`${rpc.method} ${rpc.path}`).toBe('POST /rest/v1/rpc/update_my_profile')
    expect(JSON.parse(rpc.body)).toEqual({ p_display_name: 'n', p_default_remind_min: 20 })
  })
})

describe('what a real project answers', () => {
  const taskId = id(900)

  async function answer(op: Parameters<Probe['db']>[1], reply: Answer, who: Parameters<Probe['db']>[0] = 'employee') {
    const { probe } = await liveProject((c) => (c.path.startsWith('/rest/v1/') && c.method !== 'GET' ? reply : undefined))
    return probe.db(who, op)
  }
  const insert = { op: 'insert', table: 'tasks', row: { id: taskId } } as const
  const update = { op: 'update', table: 'tasks', match: { id: taskId }, patch: { notes: 'n' } } as const

  it('takes "insufficient privilege" for a refusal, and nothing else', async () => {
    expect((await answer(insert, denied)).kind).toBe('refused')
    expect((await answer(update, { status: 401, body: { code: '42501', message: 'permission denied for table tasks' } }, 'anon')).kind).toBe('refused')
    expect((await answer(insert, { status: 401, body: { code: 'PGRST303', message: 'JWT expired' } })).kind).toBe('error')
    expect((await answer(insert, { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } })).kind).toBe('error')
    expect((await answer(insert, { status: 500, body: { message: 'boom' } })).kind).toBe('error')
  })

  it('counts the rows of an update from the answer, and reads no count as no row', async () => {
    expect(await answer(update, { status: 204, headers: { 'content-range': '*/3' } })).toEqual({ kind: 'ok', rows: 3 })
    expect(await answer(update, { status: 204, headers: { 'content-range': '*/0' } })).toEqual({ kind: 'ok', rows: 0 })
    expect(await answer(update, { status: 204 })).toEqual({ kind: 'ok', rows: 0 })
    expect(await answer({ op: 'delete', table: 'tasks', match: { id: taskId } }, { status: 204, headers: { 'content-range': '*/1' } })).toEqual({ kind: 'ok', rows: 1 })
  })

  it('counts the rows of a read, and keeps them', async () => {
    const { probe } = await liveProject((c) => (c.method === 'GET' && c.path === '/rest/v1/tasks' ? json([{ created_by: 'x' }, { created_by: 'y' }]) : undefined))
    expect(await probe.db('employee', { op: 'select', table: 'tasks' })).toEqual({ kind: 'ok', rows: 2, data: [{ created_by: 'x' }, { created_by: 'y' }] })
  })

  it('takes a written row for one row, and a call for one', async () => {
    expect(await answer(insert, { status: 201 })).toEqual({ kind: 'ok', rows: 1 })
    expect(await answer({ op: 'rpc', fn: 'clear_must_change_password', args: {} }, { status: 204 })).toEqual({ kind: 'ok', rows: 1 })
  })

  it('takes a network that fails for a failure and not for a refusal', async () => {
    const { probe } = await liveProject((c) => {
      if (c.path.startsWith('/rest/v1/')) throw new TypeError('fetch failed')
      return undefined
    })
    expect((await probe.db('employee', insert)).kind).toBe('error')
  })
})

describe('what the bucket answers', () => {
  const path = `${id(900)}/${id(901)}.jpg`
  const signed: Answer = { status: 200, body: { signedURL: `/object/sign/task-files/${path}?token=t` } }
  const isSign = (c: Call) => c.path.startsWith('/storage/v1/object/sign/')
  const notFound: Answer = { status: 400, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } }

  it('reads the answers of Storage that mean "no" as refusals', async () => {
    const { probe } = await liveProject((c) =>
      c.method === 'POST' && c.path.startsWith('/storage/v1/object/task-files/')
        ? { status: 400, body: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } }
        : undefined,
    )
    expect((await probe.storage('anon', { op: 'upload', path, type: 'image/jpeg', bytes: 64 })).kind).toBe('refused')
  })

  it('reads a bucket that is not there as a failure', async () => {
    const { probe } = await liveProject((c) =>
      c.method === 'POST' && c.path.startsWith('/storage/v1/object/task-files/')
        ? { status: 404, body: { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' } }
        : undefined,
    )
    expect((await probe.storage('employee', { op: 'upload', path, type: 'image/jpeg', bytes: 64 })).kind).toBe('error')
  })

  it('uploads the number of bytes it was asked for, with the type it was asked for, and says whether to overwrite', async () => {
    const { probe, calls } = await liveProject()

    await probe.storage('employee', { op: 'upload', path, type: 'text/plain', bytes: 5 * 1024 * 1024 + 1, overwrite: true })
    const big = calls.at(-1)!
    expect(`${big.method} ${big.path}`).toBe(`POST /storage/v1/object/task-files/${path}`)
    expect(big.headers.get('x-upsert')).toBe('true')
    expect(big.headers.get('content-type')).toBe('text/plain')
    expect(big.bytes).toBe(5 * 1024 * 1024 + 1)

    await probe.storage('employee', { op: 'upload', path, type: 'image/jpeg', bytes: 64 })
    const small = calls.at(-1)!
    expect(small.headers.get('x-upsert')).toBe('false')
    expect(small.headers.get('content-type')).toBe('image/jpeg')
    expect(small.bytes).toBe(64)
  })

  it('counts an address as nothing unless the file comes with it', async () => {
    const given = await liveProject((c) => (isSign(c) ? (c.method === 'POST' ? signed : json({})) : undefined))
    expect(await given.probe.storage('employee', { op: 'sign', path })).toEqual({ kind: 'ok', rows: 1 })
    expect(given.calls.map((c) => c.method)).toEqual(['POST', 'GET'])

    const withheld = await liveProject((c) => (isSign(c) ? (c.method === 'POST' ? signed : { status: 400, body: {} }) : undefined))
    expect((await withheld.probe.storage('employee', { op: 'sign', path })).kind).toBe('refused')

    const hidden = await liveProject((c) => (isSign(c) ? notFound : undefined))
    expect((await hidden.probe.storage('anon', { op: 'sign', path })).kind).toBe('refused')
  })

  it('counts the files that were deleted', async () => {
    const some = await liveProject((c) => (c.method === 'DELETE' && c.path === '/storage/v1/object/task-files' ? json([{ name: path }]) : undefined))
    expect(await some.probe.storage('employee', { op: 'remove', path })).toEqual({ kind: 'ok', rows: 1 })
    expect(JSON.parse(some.calls.at(-1)!.body)).toEqual({ prefixes: [path] })

    const none = await liveProject((c) => (c.method === 'DELETE' && c.path === '/storage/v1/object/task-files' ? json([]) : undefined))
    expect(await none.probe.storage('colleague', { op: 'remove', path })).toEqual({ kind: 'ok', rows: 0 })
  })

  it('opens the public address of a file, and takes anything but the file for a refusal', async () => {
    const closed = await liveProject((c) =>
      c.path.startsWith('/storage/v1/object/public/') ? { status: 400, body: { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' } } : undefined,
    )
    expect((await closed.probe.storage('anon', { op: 'public', path })).kind).toBe('refused')
    expect(closed.calls.at(-1)!.path).toBe(`/storage/v1/object/public/task-files/${path}`)

    const open = await liveProject((c) => (c.path.startsWith('/storage/v1/object/public/') ? json({}) : undefined))
    expect(await open.probe.storage('anon', { op: 'public', path })).toEqual({ kind: 'ok', rows: 1 })
  })
})

describe('what the sign-in service answers', () => {
  it('takes a sign-up that is switched off for a refusal, and one that goes through for what it is', async () => {
    const off = await liveProject((c) =>
      c.path === '/auth/v1/signup' ? { status: 422, body: { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' } } : undefined,
    )
    expect((await off.probe.signUp()).kind).toBe('refused')

    const on = await liveProject((c) => (c.path === '/auth/v1/signup' ? json({ id: id(300), email: 'x@example.com' }) : undefined))
    expect(await on.probe.signUp()).toEqual({ kind: 'ok', rows: 1 })
  })

  it('takes a password that is too short for a refusal, when the employee tries it', async () => {
    const weak = await liveProject((c) =>
      c.path === '/auth/v1/user' && c.method === 'PUT'
        ? { status: 422, body: { code: 422, error_code: 'weak_password', msg: 'Password should be at least 10 characters.', weak_password: { reasons: ['length'] } } }
        : undefined,
    )
    expect((await weak.probe.weakPassword()).kind).toBe('refused')
    expect(JSON.parse(weak.calls.at(-1)!.body)).toMatchObject({ password: '123456789' })
    expect(weak.calls.at(-1)!.headers.get('authorization')).toBe(`Bearer ${tokenOf(weak.world.ids.employee)}`)

    const accepted = await liveProject((c) => (c.path === '/auth/v1/user' && c.method === 'PUT' ? json({ id: id(301), email: 'x@example.com' }) : undefined))
    expect(await accepted.probe.weakPassword()).toEqual({ kind: 'ok', rows: 1 })
  })
})
