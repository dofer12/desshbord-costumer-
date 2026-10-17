// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES, STATUS_OF, createHandler } from '../functions/admin-users/handler'
import type { AdminDeps, AdminErrorCode, ProfileRow } from '../functions/admin-users/logic'

// The HTTP layer of the administrator function: the method, the size and the shape of the body, the
// token in the header, the status of each answer, and what every answer carries. The rules behind it are
// those of logic.ts (tested in adminUsers.logic.test.ts); here a few real requests go through them.

const ADMIN = '11111111-1111-4111-8111-111111111111'
const EMPLOYEE = '33333333-3333-4333-8333-333333333333'
const MISSING = '77777777-7777-4777-8777-777777777777'
const TOKEN = 'tok-9f3a-the-secret-of-the-caller'
const URL = 'https://probe.supabase.co/functions/v1/admin-users'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const profile = (id: string, over: Partial<ProfileRow> = {}): ProfileRow => ({
  id,
  email: `${id.slice(0, 4)}@example.com`,
  display_name: `name ${id.slice(0, 4)}`,
  role: 'employee',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
  ...over,
})

function fakeDeps(over: Partial<AdminDeps> = {}) {
  const profiles = new Map<string, ProfileRow>([
    [ADMIN, profile(ADMIN, { role: 'admin', display_name: 'Dana Admin', email: 'dana@example.com' })],
    [EMPLOYEE, profile(EMPLOYEE, { display_name: 'Eli Employee', email: 'eli@example.com' })],
  ])
  let counter = 0
  const deps: AdminDeps = {
    identify: vi.fn(async (token: string) => (token === TOKEN ? ADMIN : token === 'employee-token' ? EMPLOYEE : null)),
    profile: vi.fn(async (id: string) => profiles.get(id) ?? null),
    profileByName: vi.fn(async (name: string) => [...profiles.values()].find((p) => p.display_name.toLowerCase() === name.toLowerCase()) ?? null),
    profileByEmail: vi.fn(async (email: string) => [...profiles.values()].find((p) => p.email === email) ?? null),
    authCreate: vi.fn(async (input) => {
      const id = `99999999-9999-4999-8999-${String(++counter).padStart(12, '0')}`
      profiles.set(id, profile(id, { email: input.email, display_name: input.display_name, role: input.role, must_change_password: true }))
      return { id }
    }),
    authSetPassword: vi.fn(async () => true),
    authBan: vi.fn(async () => true),
    authDelete: vi.fn(async () => undefined),
    revokeSessions: vi.fn(async () => true),
    updateProfile: vi.fn(async (id: string, patch) => {
      const found = profiles.get(id)
      if (!found) return { error: 'not_found' as const }
      Object.assign(found, patch)
      return { ...found }
    }),
    // Another random password at every call.
    randomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + counter * 17 + 5) % 224),
    log: vi.fn(),
    ...over,
  }
  return { deps, profiles }
}

/** The handler over pretend services, and what it was asked to make them from. */
function setup(over: Partial<AdminDeps> = {}) {
  const { deps, profiles } = fakeDeps(over)
  const makeDeps = vi.fn(() => deps)
  const handler = createHandler({ makeDeps, cors: CORS })
  return { handler, makeDeps, deps, profiles }
}

const json = (body: unknown) => JSON.stringify(body)
const post = (body: string | null, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  new Request(URL, { method: 'POST', headers, body })
const rename = (name = 'Eli Cohen') => ({ action: 'rename', user_id: EMPLOYEE, display_name: name })

/** Everything that the process wrote to its console while a test ran, with the errors that were handed to it written out in full. */
const consoles = () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined))
  const write = (value: unknown) => (value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : typeof value === 'string' ? value : JSON.stringify(value))
  return () => spies.flatMap((spy) => spy.mock.calls.flatMap((call) => call.map(write))).join('\n')
}

afterEach(() => {
  vi.restoreAllMocks()
})

const expectCors = (response: Response) => {
  for (const [name, value] of Object.entries(CORS)) expect(response.headers.get(name)).toBe(value)
}

describe('the preflight and the methods', () => {
  it('answers OPTIONS with the CORS headers and no body, and does not touch the services', async () => {
    const { handler, makeDeps } = setup()
    const response = await handler(new Request(URL, { method: 'OPTIONS', headers: { origin: 'https://localhost' } }))
    expect(response.status).toBe(204)
    expectCors(response)
    expect(await response.text()).toBe('')
    expect(makeDeps).not.toHaveBeenCalled()
  })

  it('allows the methods that it answers even when the options of the host leave them out', async () => {
    const handler = createHandler({ makeDeps: () => fakeDeps().deps, cors: { 'Access-Control-Allow-Origin': '*' } })
    const response = await handler(new Request(URL, { method: 'OPTIONS' }))
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('refuses %s with 405 and says what is allowed, without touching the services', async (method) => {
    const { handler, makeDeps } = setup()
    const response = await handler(new Request(URL, { method, headers: { authorization: `Bearer ${TOKEN}` } }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    expectCors(response)
    expect(makeDeps).not.toHaveBeenCalled()
  })

  it('carries the CORS headers on every other answer too: a success and each kind of refusal', async () => {
    const { handler } = setup()
    const answers = [
      await handler(post(json(rename()))),
      await handler(post(json(rename()), {})),
      await handler(post(json(rename()), { authorization: 'Bearer employee-token' })),
      await handler(post('not json')),
      await handler(post('x'.repeat(MAX_BODY_BYTES + 1))),
      await handler(new Request(URL, { method: 'GET' })),
    ]
    expect(answers.map((r) => r.status)).toEqual([200, 401, 403, 400, 413, 405])
    for (const answer of answers) expectCors(answer)
  })
})

describe('the body', () => {
  it('may be 4 KB at the most, which is a few times what the longest real request needs', () => {
    expect(MAX_BODY_BYTES).toBe(4096)
  })

  it('refuses a body over 4 KB with 413, and does not look at it', async () => {
    const { handler, makeDeps, deps } = setup()
    const big = json({ ...rename(), padding: 'x'.repeat(MAX_BODY_BYTES) })
    const response = await handler(post(big))
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'body' })
    expect(makeDeps).not.toHaveBeenCalled()
    expect(deps.identify).not.toHaveBeenCalled()
  })

  it('refuses a body over 4 KB that does not say how long it is, as soon as it is that long, and tells the sender to stop', async () => {
    const { handler, deps } = setup()
    let pulled = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new TextEncoder().encode('x'.repeat(1024)))
        if (pulled > 1000) controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    const request = new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: stream, duplex: 'half' } as RequestInit)
    const response = await handler(request)
    expect(response.status).toBe(413)
    // It did not read a megabyte to find that out.
    expect(pulled).toBeLessThan(20)
    expect(cancelled).toBe(true)
    expect(deps.identify).not.toHaveBeenCalled()
  })

  it('refuses at once, without reading, a body that says that it is longer than 4 KB, and takes one that says that it is exactly 4 KB', async () => {
    const { handler } = setup()
    let pulled = 0
    // A stream starts to fill itself when it is made; what is looked at is that the handler does not read on from there.
    const unread = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(100))
      },
    })
    const long = new Request(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(MAX_BODY_BYTES + 1) },
      body: unread,
      duplex: 'half',
    } as RequestInit)
    expect((await handler(long)).status).toBe(413)
    expect(pulled).toBeLessThanOrEqual(2)

    const text = json(rename())
    const exact = new Request(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(MAX_BODY_BYTES) },
      body: text,
    })
    expect((await handler(exact)).status).toBe(200)
  })

  it('takes a body of exactly 4 KB, and refuses one that is a byte longer', async () => {
    const { handler } = setup()
    const make = (size: number) => {
      const base = json({ ...rename(), padding: '' })
      return base.slice(0, -2) + 'x'.repeat(size - base.length) + '"}'
    }
    const exact = make(MAX_BODY_BYTES)
    expect(new TextEncoder().encode(exact).length).toBe(MAX_BODY_BYTES)
    expect((await handler(post(exact))).status).toBe(200)
    expect((await handler(post(exact + ' '))).status).toBe(413)
  })

  it('counts bytes and not letters', async () => {
    const { handler } = setup()
    const hebrew = json({ ...rename(), padding: 'ש'.repeat(MAX_BODY_BYTES / 2) })
    expect([...hebrew].length).toBeLessThan(MAX_BODY_BYTES)
    expect((await handler(post(hebrew))).status).toBe(413)
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['not JSON', 'action=rename'],
    ['cut in the middle', '{"action": "rena'],
  ])('answers 400 "invalid" for a body that is %s', async (_what, body) => {
    const { handler, deps } = setup()
    const response = await handler(post(body))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'body' })
    expect(deps.updateProfile).not.toHaveBeenCalled()
  })

  it('answers 400 "invalid" for a body that is not UTF-8, also when it would still be JSON with a character that is not there', async () => {
    const { handler, deps } = setup()
    const head = new TextEncoder().encode(`{"action":"rename","user_id":"${EMPLOYEE}","display_name":"`)
    const tail = new TextEncoder().encode('"}')
    const bytes = new Uint8Array([...head, 0xff, ...tail])
    const response = await handler(new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: bytes }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'body' })
    expect(deps.updateProfile).not.toHaveBeenCalled()
  })

  it('answers 400 for a request with no body at all', async () => {
    const { handler } = setup()
    const response = await handler(post(null))
    expect(response.status).toBe(400)
  })
})

describe('the token', () => {
  it.each([
    ['no header', {}],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
    ['the scheme and no token', { authorization: 'Bearer' }],
    ['an empty token', { authorization: 'Bearer    ' }],
    ['the token with no scheme', { authorization: TOKEN }],
  ])('is not accepted from %s: 401, and nobody is asked who it is', async (_what, headers) => {
    const { handler, makeDeps, deps } = setup()
    const response = await handler(post(json(rename()), headers))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, code: 'unauthenticated' })
    expect(deps.identify).not.toHaveBeenCalled()
    expect(makeDeps).not.toHaveBeenCalled()
  })

  it('is read from the header Authorization only, not from the body, the address or another header', async () => {
    const { handler, deps } = setup()
    const request = new Request(`${URL}?token=${TOKEN}&access_token=${TOKEN}`, {
      method: 'POST',
      headers: { apikey: TOKEN, 'x-token': TOKEN, cookie: `token=${TOKEN}` },
      body: json({ ...rename(), token: TOKEN, authorization: `Bearer ${TOKEN}` }),
    })
    expect((await handler(request)).status).toBe(401)
    expect(deps.identify).not.toHaveBeenCalled()
  })

  it('is handed over as it came, once, whatever the case of the word Bearer', async () => {
    const { handler, deps } = setup()
    expect((await handler(post(json(rename()), { authorization: `bearer ${TOKEN}` }))).status).toBe(200)
    expect(deps.identify).toHaveBeenCalledTimes(1)
    expect(deps.identify).toHaveBeenCalledWith(TOKEN)
  })

  it('is never in an answer or in what the process writes, whatever happens', async () => {
    const written = consoles()
    const broken = setup({ identify: vi.fn(async () => Promise.reject(new Error(`bad token ${TOKEN}`))) })
    const throwing = createHandler({
      makeDeps: () => {
        throw new Error(`cannot make the services for ${TOKEN}`)
      },
      cors: CORS,
    })
    const fine = setup()
    const everything: string[] = []
    for (const response of [
      await fine.handler(post(json(rename()))),
      await fine.handler(post(json({ action: 'nonsense' }))),
      await fine.handler(post('not json')),
      await fine.handler(post(json(rename()), { authorization: 'Bearer employee-token' })),
      await broken.handler(post(json(rename()))),
      await throwing(post(json(rename()))),
    ]) {
      everything.push(await response.text(), JSON.stringify([...response.headers]))
    }
    expect(everything.join('\n')).not.toContain(TOKEN)
    expect(written()).not.toContain(TOKEN)
  })
})

describe('the answers', () => {
  it('answers a success with 200, the result as JSON, and a promise that nobody keeps it', async () => {
    const { handler } = setup()
    const response = await handler(post(json(rename('Eli Cohen'))))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ ok: true, user: { id: EMPLOYEE, display_name: 'Eli Cohen' } })
  })

  it('says no-store on a refusal too', async () => {
    const { handler } = setup()
    const response = await handler(post(json({ action: 'nonsense' })))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
  })

  it('has a status for every code, and these are they', () => {
    expect(STATUS_OF).toEqual({
      unauthenticated: 401,
      forbidden: 403,
      invalid: 400,
      email_taken: 409,
      name_taken: 409,
      not_found: 404,
      last_admin: 409,
      failed: 500,
    })
  })

  // Each code, reached by a real request through the real rules, comes out with its status and nothing else in it.
  const reaching: Array<[AdminErrorCode, () => Promise<Response>, string?]> = [
    ['unauthenticated', async () => setup().handler(post(json(rename()), { authorization: 'Bearer nobody' }))],
    ['forbidden', async () => setup().handler(post(json(rename()), { authorization: 'Bearer employee-token' }))],
    ['invalid', async () => setup().handler(post(json({ action: 'rename', user_id: 'x', display_name: 'y' }))), 'user_id'],
    [
      'email_taken',
      async () => setup().handler(post(json({ action: 'create', email: 'eli@example.com', display_name: 'New', role: 'employee' }))),
      'email',
    ],
    [
      'name_taken',
      async () => setup().handler(post(json({ action: 'create', email: 'new@example.com', display_name: 'eli employee', role: 'employee' }))),
      'display_name',
    ],
    ['not_found', async () => setup().handler(post(json({ action: 'rename', user_id: MISSING, display_name: 'x' })))],
    [
      'last_admin',
      async () => setup({ updateProfile: vi.fn(async () => ({ error: 'last_admin' as const })) }).handler(post(json({ action: 'set_role', user_id: EMPLOYEE, role: 'admin' }))),
    ],
    ['failed', async () => setup({ updateProfile: vi.fn(async () => ({ error: 'failed' as const })) }).handler(post(json(rename())))],
  ]
  it.each(reaching)('answers "%s" with the status that goes with it, and only the code (and the field, when there is one)', async (code, request, field) => {
    const response = await request()
    expect(response.status).toBe(STATUS_OF[code])
    expect(await response.json()).toEqual(field === undefined ? { ok: false, code } : { ok: false, code, field })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('when something breaks', () => {
  it('answers 500 "failed" with no word of what went wrong, and writes only a short code', async () => {
    const written = consoles()
    const handler = createHandler({
      makeDeps: () => {
        throw new Error('connection refused at 10.0.0.5, key sb_secret_abc')
      },
      cors: CORS,
    })
    const response = await handler(post(json(rename())))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'failed' })
    expectCors(response)
    expect(written()).not.toMatch(/10\.0\.0\.5|sb_secret|refused/)
    expect(written().length).toBeLessThan(200)
  })

  it('answers 500 "failed" when a service breaks in the middle of a request', async () => {
    const { handler } = setup({ updateProfile: vi.fn(async () => Promise.reject(new Error('boom'))) })
    const response = await handler(post(json(rename())))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ ok: false, code: 'failed' })
  })

  it('answers 400 "invalid" when the body cannot be read to the end (the connection was cut)', async () => {
    const { handler, deps } = setup()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('the connection was cut'))
      },
    })
    const request = new Request(URL, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: stream, duplex: 'half' } as RequestInit)
    const response = await handler(request)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'body' })
    expect(deps.updateProfile).not.toHaveBeenCalled()
  })
})

describe('the temporary password', () => {
  const create = (email: string, name: string) => ({ action: 'create', email, display_name: name, role: 'employee' })
  const said = async (response: Response) => (await response.json()) as Record<string, unknown> & { temp_password: string }

  it('comes once, in the answer to the request that made it, and in no other', async () => {
    const { handler } = setup()
    const made = await said(await handler(post(json(create('new@example.com', 'New Person')))))
    expect(made).toMatchObject({ ok: true, temp_password: expect.stringMatching(/^[A-Za-z2-9]{16}$/) })
    for (const body of [rename(), { action: 'set_active', user_id: EMPLOYEE, is_active: false }, { action: 'set_role', user_id: EMPLOYEE, role: 'admin' }]) {
      const answer = await said(await handler(post(json(body))))
      expect(answer).not.toHaveProperty('temp_password')
      expect(JSON.stringify(answer)).not.toContain(made.temp_password)
    }
  })

  it('is another one for the next person, and is not remembered by the handler', async () => {
    const { handler } = setup()
    const first = await said(await handler(post(json(create('one@example.com', 'One Person')))))
    const second = await said(await handler(post(json(create('two@example.com', 'Two Person')))))
    expect(first.temp_password).not.toBe(second.temp_password)
  })

  it('is not written to the console by the handler', async () => {
    const written = consoles()
    const { handler } = setup()
    const made = await said(await handler(post(json(create('new@example.com', 'New Person')))))
    expect(written()).not.toContain(made.temp_password)
  })
})
