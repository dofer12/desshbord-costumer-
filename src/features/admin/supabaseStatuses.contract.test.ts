// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseAdminGateway } from './supabaseAdminGateway'
import { toAdminWriteMessage, WRITE_MESSAGES } from './writeErrors'

// The statuses that an administrator edits, against the real client over a stubbed network: they pin what
// the app really sends to the database API (the table, the columns, the filter on the key, what comes
// back) and what its errors really look like. The rules of the statuses are tried in statusRules.test.ts.

const PROJECT = 'https://probe.supabase.co'
const STORAGE_KEY = 'moked-statuses-contract'
const STATUSES = '/rest/v1/statuses'
const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.com',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

const base64url = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fakeJwt = (payload: object) => `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.${Buffer.from('signature').toString('base64url')}`

function storedSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: fakeJwt({ sub: USER.id, exp: expiresAt }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh-1',
    user: USER,
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const offline = (): never => {
  throw new TypeError('Failed to fetch')
}

interface Sent {
  method: string
  url: URL
  body: string
  headers: Headers
}

function harness(respond: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const values = new Map([[STORAGE_KEY, JSON.stringify(storedSession())]])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  const client = createClient(PROJECT, 'sb_publishable_test', {
    global: {
      fetch: async (input, init) => {
        const request: Sent = {
          method: init?.method ?? 'GET',
          url: new URL(String(input)),
          body: typeof init?.body === 'string' ? init.body : '',
          headers: new Headers(init?.headers),
        }
        sent.push(request)
        return respond(request)
      },
    },
    auth: { storage, storageKey: STORAGE_KEY, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { statuses: createSupabaseAdminGateway(client).statuses, sent }
}

const ROW = { key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1, is_active: true }
const EXISTING = [
  { key: 'processing', sort: 1 },
  { key: 'cargo', sort: 8 },
  { key: 'abroad', sort: 17 },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('add', () => {
  const made = { key: 'custom-000000', name_he: 'ממתין ללקוח', color: '#abcdef', sort: 18, is_active: true }

  it('reads the keys and the places that there are, then writes the new row at the end, asking for it back', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const h = harness((sent) => (sent.method === 'GET' ? json(200, EXISTING) : json(201, made)))
    const row = await h.statuses.add({ name_he: '  ממתין ללקוח ', color: '#ABCDEF' })

    const [read, write] = h.sent
    expect(read.method).toBe('GET')
    expect(read.url.pathname).toBe(STATUSES)
    expect(read.url.searchParams.get('select')).toBe('key,sort')

    expect(write.method).toBe('POST')
    expect(write.url.pathname).toBe(STATUSES)
    expect(write.headers.get('prefer')).toContain('return=representation')
    // The key is made by the app, the name is trimmed, the colour is lower-case, and the place is after the last one.
    expect(JSON.parse(write.body)).toEqual({ key: 'custom-000000', name_he: 'ממתין ללקוח', color: '#abcdef', sort: 18, is_active: true })
    expect(row).toEqual(made)
  })

  it('puts the first status of an empty table in the first place', async () => {
    const h = harness((sent) => (sent.method === 'GET' ? json(200, []) : json(201, { ...made, sort: 1 })))
    await h.statuses.add({ name_he: 'ראשון', color: '#000000' })
    expect(JSON.parse(h.sent[1].body)).toMatchObject({ sort: 1 })
  })

  it('does not use a key that the person hands in: the key is never theirs to choose', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const h = harness((sent) => (sent.method === 'GET' ? json(200, EXISTING) : json(201, made)))
    await h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef', key: 'processing', sort: 1, is_active: false } as never)
    expect(JSON.parse(h.sent[1].body)).toEqual({ key: 'custom-000000', name_he: 'ממתין ללקוח', color: '#abcdef', sort: 18, is_active: true })
  })

  it('makes a key that none of the keys that it read is', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const taken = [{ key: 'custom-000000', sort: 1 }, { key: 'custom-000001', sort: 2 }]
    const h = harness((sent) => (sent.method === 'GET' ? json(200, taken) : json(201, made)))
    await h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' })
    expect(JSON.parse(h.sent[1].body).key).toBe('custom-000002')
  })

  it('tries again with another key when another administrator made the same one at the same moment', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let posts = 0
    const h = harness((sent) => {
      if (sent.method === 'GET') return json(200, EXISTING)
      return ++posts === 1
        ? json(409, { code: '23505', details: 'Key (key)=(custom-000000) already exists.', hint: null, message: 'duplicate key value violates unique constraint "statuses_pkey"' })
        : json(201, { ...made, key: 'custom-000001' })
    })
    const row = await h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' })
    const keys = h.sent.filter((s) => s.method === 'POST').map((s) => JSON.parse(s.body).key)
    expect(keys).toEqual(['custom-000000', 'custom-000001'])
    expect(row.key).toBe('custom-000001')
  })

  it('gives up after a few keys that are taken, with the refusal, instead of trying for ever', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const h = harness((sent) =>
      sent.method === 'GET' ? json(200, EXISTING) : json(409, { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "statuses_pkey"' }),
    )
    await expect(h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' })).rejects.toMatchObject({ code: '23505', status: 409 })
    expect(h.sent.filter((s) => s.method === 'POST')).toHaveLength(3)
  })

  it('writes nothing when it cannot read what there is', async () => {
    const h = harness(() => json(500, { code: 'XX000', details: null, hint: null, message: 'boom' }))
    await expect(h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' })).rejects.toMatchObject({ status: 500 })
    expect(h.sent.every((s) => s.method === 'GET')).toBe(true)
  })

  it('says why a refusal was one, with the code and the status that the database gave', async () => {
    const h = harness((sent) =>
      sent.method === 'GET'
        ? json(200, EXISTING)
        : json(403, { code: '42501', details: null, hint: null, message: 'new row violates row-level security policy for table "statuses"' }),
    )
    const refusal = await h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' }).catch((error: unknown) => error)
    expect(refusal).toMatchObject({ code: '42501', status: 403 })
    expect(toAdminWriteMessage(refusal)).toBe(WRITE_MESSAGES.forbidden)
    // Another key would not help: it is only for a key that exists that another one is tried.
    expect(h.sent.filter((s) => s.method === 'POST')).toHaveLength(1)
  })

  it('says that the server could not be reached when the network is down', async () => {
    const h = harness(offline)
    const failure = await h.statuses.add({ name_he: 'ממתין ללקוח', color: '#abcdef' }).catch((error: unknown) => error)
    expect(toAdminWriteMessage(failure)).toBe(WRITE_MESSAGES.network)
  })
})

describe('update', () => {
  it('is a PATCH of the one row, by its key, with only the columns that changed, asking for the row back', async () => {
    const h = harness(() => json(200, { ...ROW, name_he: 'בטיפול מיידי' }))
    const row = await h.statuses.update('processing', { name_he: '  בטיפול מיידי ' })
    const [patch] = h.sent
    expect(patch.method).toBe('PATCH')
    expect(patch.url.pathname).toBe(STATUSES)
    expect(patch.url.searchParams.get('key')).toBe('eq.processing')
    expect(patch.headers.get('prefer')).toContain('return=representation')
    expect(patch.headers.get('accept')).toContain('application/vnd.pgrst.object+json')
    expect(JSON.parse(patch.body)).toEqual({ name_he: 'בטיפול מיידי' })
    expect(row).toEqual({ ...ROW, name_he: 'בטיפול מיידי' })
  })

  it('keeps the colour in lower-case, and sends the place and the state when they are what changed', async () => {
    const h = harness(() => json(200, ROW))
    await h.statuses.update('processing', { color: '#ABCDEF', sort: 4, is_active: false })
    expect(JSON.parse(h.sent[0].body)).toEqual({ color: '#abcdef', sort: 4, is_active: false })
  })

  it('never has the key in what it sends, and never a column that it does not know, even if it is handed one', async () => {
    const h = harness(() => json(200, ROW))
    await h.statuses.update('processing', { name_he: 'חדש', key: 'other', id: 7, color: undefined } as never)
    expect(JSON.parse(h.sent[0].body)).toEqual({ name_he: 'חדש' })
    expect(h.sent[0].url.searchParams.get('key')).toBe('eq.processing')
  })

  it('does not ask the database for a change that is nothing', async () => {
    const h = harness(() => json(200, ROW))
    await expect(h.statuses.update('processing', {})).rejects.toThrow(/nothing to change/i)
    await expect(h.statuses.update('processing', { color: undefined } as never)).rejects.toThrow(/nothing to change/i)
    expect(h.sent).toHaveLength(0)
  })

  it('says that there is no such status when the key is not there any more', async () => {
    const h = harness(() => json(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }))
    const failure = await h.statuses.update('gone', { name_he: 'חדש' }).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'PGRST116', status: 406 })
    expect(toAdminWriteMessage(failure)).toBe(WRITE_MESSAGES.gone)
  })

  it('says that the person is not allowed when the policies of the database say no', async () => {
    const h = harness(() => json(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }))
    const failure = await h.statuses.update('processing', { name_he: 'חדש' }).catch((error: unknown) => error)
    expect(toAdminWriteMessage(failure)).toBe(WRITE_MESSAGES.session)
  })
})

describe('reorder', () => {
  it('writes the place of each status as 1, 2, 3 and so on, one request for each, in the order that was given', async () => {
    const h = harness(() => new Response(null, { status: 204 }))
    await h.statuses.reorder(['cargo', 'processing', 'abroad'])
    expect(h.sent.map((s) => [s.method, s.url.searchParams.get('key'), JSON.parse(s.body)])).toEqual([
      ['PATCH', 'eq.cargo', { sort: 1 }],
      ['PATCH', 'eq.processing', { sort: 2 }],
      ['PATCH', 'eq.abroad', { sort: 3 }],
    ])
  })

  it('does not write anything for a list with nothing in it', async () => {
    const h = harness(() => new Response(null, { status: 204 }))
    await h.statuses.reorder([])
    expect(h.sent).toHaveLength(0)
  })

  it('goes on to the others when one fails, and says that something failed at the end', async () => {
    let n = 0
    const h = harness(() => (++n === 2 ? json(500, { code: 'XX000', details: null, hint: null, message: 'boom' }) : new Response(null, { status: 204 })))
    const failure = await h.statuses.reorder(['a', 'b', 'c']).catch((error: unknown) => error)
    expect(h.sent.map((s) => s.url.searchParams.get('key'))).toEqual(['eq.a', 'eq.b', 'eq.c'])
    expect(failure).toMatchObject({ status: 500 })
  })

  it('says the first thing that went wrong, when several did', async () => {
    let n = 0
    const h = harness(() => (++n === 1 ? json(403, { code: '42501', details: null, hint: null, message: 'no' }) : json(500, { code: 'XX000', details: null, hint: null, message: 'boom' })))
    const failure = await h.statuses.reorder(['a', 'b']).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: '42501', status: 403 })
  })

  it('says that the server could not be reached when the network is down', async () => {
    const h = harness(offline)
    const failure = await h.statuses.reorder(['a', 'b']).catch((error: unknown) => error)
    expect(toAdminWriteMessage(failure)).toBe(WRITE_MESSAGES.network)
  })
})

describe('the statuses are never deleted', () => {
  it('has no way to delete one', () => {
    const h = harness(() => json(200, ROW))
    expect(Object.keys(h.statuses).sort()).toEqual(['add', 'reorder', 'update'])
  })

  it('sends no DELETE, whatever is done', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const h = harness((sent) => (sent.method === 'GET' ? json(200, EXISTING) : sent.method === 'POST' ? json(201, ROW) : json(200, ROW)))
    await h.statuses.add({ name_he: 'חדש', color: '#000000' })
    await h.statuses.update('processing', { is_active: false })
    await h.statuses.reorder(['processing', 'cargo'])
    expect(h.sent.some((s) => s.method === 'DELETE')).toBe(false)
  })
})
