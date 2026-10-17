// @vitest-environment node
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Profile } from '../auth/types'
import { ADMIN_MESSAGES, adminMessage, type UserOutcome } from './gateways'
import { createSupabaseAdminGateway } from './supabaseAdminGateway'

// These tests run the real supabase-js client against a stubbed network, so they pin what the library
// really sends to the function (the address, the token, the body) and what its errors really look like:
// a function that answers with a status that is not 2xx is an error of the library, whose body has to be read
// from the response that it carries.

const PROJECT = 'https://probe.supabase.co'
const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
/** A token that looks like one of the auth service: it is read for the time when it ends, and checked with the server. */
const ACCESS_TOKEN = `${base64({ alg: 'HS256', typ: 'JWT' })}.${base64({ sub: 'u-owner', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.${base64('signature')}`

const ELI: Profile = { id: '33333333-3333-4333-8333-333333333333', email: 'eli@example.com', display_name: 'Eli', role: 'employee', is_active: true, must_change_password: true, default_remind_min: 15 }

interface Sent {
  method: string
  url: URL
  headers: Headers
  body: string
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

async function harness(respond: (sent: Sent) => Response | Promise<Response>, options: { signedIn?: boolean } = {}) {
  const sent: Sent[] = []
  const client = createClient(PROJECT, 'sb_publishable_test', {
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input))
        // The check of the session that setSession makes: not a request of the function.
        if (url.pathname === '/auth/v1/user') {
          return json(200, { id: 'u-owner', aud: 'authenticated', role: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' })
        }
        const body = init?.body
        const request: Sent = {
          method: init?.method ?? 'GET',
          url,
          headers: new Headers(init?.headers),
          body: typeof body === 'string' ? body : '',
        }
        sent.push(request)
        return respond(request)
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  if (options.signedIn !== false) {
    const session = await client.auth.setSession({ access_token: ACCESS_TOKEN, refresh_token: 'refresh-token' })
    expect(session.error).toBeNull()
  }
  return { client, sent, gateway: createSupabaseAdminGateway(client) }
}

const failureOf = (outcome: UserOutcome) => {
  expect(outcome.ok).toBe(false)
  return outcome as Extract<UserOutcome, { ok: false }>
}

describe('what is sent', () => {
  const ok = () => json(200, { ok: true, user: ELI })

  it('is a POST to the function, with the token of the session, and with nothing of the caller in it', async () => {
    const h = await harness(ok)
    await h.gateway.users.rename(ELI.id, 'Eli Cohen')
    expect(h.sent).toHaveLength(1)
    const request = h.sent[0]
    expect(request.method).toBe('POST')
    expect(request.url.pathname).toBe('/functions/v1/admin-users')
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(request.headers.get('content-type')).toMatch(/json/)
  })

  it.each([
    ['create', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.create({ email: 'new@example.com', display_name: 'New', role: 'admin' }), { action: 'create', email: 'new@example.com', display_name: 'New', role: 'admin' }],
    ['resetPassword', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.resetPassword(ELI.id), { action: 'reset_password', user_id: ELI.id }],
    ['setActive (block)', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.setActive(ELI.id, false), { action: 'set_active', user_id: ELI.id, is_active: false }],
    ['setActive (unblock)', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.setActive(ELI.id, true), { action: 'set_active', user_id: ELI.id, is_active: true }],
    ['setRole', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.setRole(ELI.id, 'admin'), { action: 'set_role', user_id: ELI.id, role: 'admin' }],
    ['rename', (g: ReturnType<typeof createSupabaseAdminGateway>) => g.users.rename(ELI.id, 'Eli Cohen'), { action: 'rename', user_id: ELI.id, display_name: 'Eli Cohen' }],
  ])('says %s with a body of exactly the action and what it is about', async (_name, call, expected) => {
    const h = await harness(ok)
    await call(h.gateway)
    expect(JSON.parse(h.sent[0].body)).toEqual(expected)
  })

  it('never sends a password, nor who the caller is, in any request', async () => {
    const h = await harness(ok)
    // Whatever else a caller hands over is not sent: the body is made from the fields that the call is about.
    await h.gateway.users.create({ email: 'new@example.com', display_name: 'New', role: 'employee', password: 'chosen-by-the-caller', caller_id: 'u-owner' } as never)
    await h.gateway.users.resetPassword(ELI.id)
    await h.gateway.users.setRole(ELI.id, 'admin')
    expect(h.sent).toHaveLength(3)
    for (const request of h.sent) {
      const keys = Object.keys(JSON.parse(request.body) as Record<string, unknown>)
      expect(keys).not.toEqual(expect.arrayContaining(['password']))
      for (const key of keys) expect(key).not.toMatch(/^(password|temp_password|caller|caller_id|token|access_token|app_metadata|user_metadata|is_admin)$/)
    }
  })

  it('sends no token when nobody is signed in, and the platform then refuses it, which is "unauthenticated"', async () => {
    const h = await harness(
      (sent) => (sent.headers.get('authorization') === null ? json(401, { code: 401, message: 'Missing authorization header' }) : json(200, { ok: true, user: ELI })),
      { signedIn: false },
    )
    expect(await h.gateway.users.rename(ELI.id, 'x')).toEqual({ ok: false, code: 'unauthenticated' })
    expect(h.sent[0].headers.get('authorization')).toBeNull()
  })
})

describe('what comes back', () => {
  it('turns a success into the person and, when there is one, the temporary password', async () => {
    const withPassword = await harness(() => json(200, { ok: true, user: ELI, temp_password: 'Abcdefgh23456789' }))
    expect(await withPassword.gateway.users.resetPassword(ELI.id)).toEqual({ ok: true, user: ELI, tempPassword: 'Abcdefgh23456789' })
    const without = await harness(() => json(200, { ok: true, user: ELI }))
    const outcome = await without.gateway.users.rename(ELI.id, 'x')
    expect(outcome).toEqual({ ok: true, user: ELI })
    expect(outcome).not.toHaveProperty('tempPassword')
  })

  it.each([
    [400, { ok: false, code: 'invalid', field: 'email' }, { ok: false, code: 'invalid', field: 'email' }],
    [400, { ok: false, code: 'invalid', field: 'user_id' }, { ok: false, code: 'invalid', field: 'user_id' }],
    [401, { ok: false, code: 'unauthenticated' }, { ok: false, code: 'unauthenticated' }],
    [403, { ok: false, code: 'forbidden' }, { ok: false, code: 'forbidden' }],
    [404, { ok: false, code: 'not_found' }, { ok: false, code: 'not_found' }],
    [409, { ok: false, code: 'email_taken', field: 'email' }, { ok: false, code: 'email_taken', field: 'email' }],
    [409, { ok: false, code: 'name_taken', field: 'display_name' }, { ok: false, code: 'name_taken', field: 'display_name' }],
    [409, { ok: false, code: 'last_admin' }, { ok: false, code: 'last_admin' }],
    [413, { ok: false, code: 'invalid', field: 'body' }, { ok: false, code: 'invalid', field: 'body' }],
    [500, { ok: false, code: 'failed' }, { ok: false, code: 'failed' }],
  ])('turns the answer %s %j into the failure %j', async (status, body, expected) => {
    const h = await harness(() => json(status, body))
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual(expected)
  })

  it('keeps only the code and the field of a failure, and none of the words of the server', async () => {
    const h = await harness(() => json(500, { ok: false, code: 'failed', field: 'x', message: 'connection to 10.0.0.5 refused', detail: 'sb_secret_abc' }))
    const outcome = failureOf(await h.gateway.users.resetPassword(ELI.id))
    expect(JSON.stringify(outcome)).not.toMatch(/10\.0\.0\.5|sb_secret|refused/)
    expect(Object.keys(outcome).sort()).toEqual(['code', 'field', 'ok'])
    // And a failure that names no field has none: not even an empty one.
    const plain = await harness(() => json(403, { ok: false, code: 'forbidden', message: 'no' }))
    expect(Object.keys(failureOf(await plain.gateway.users.resetPassword(ELI.id))).sort()).toEqual(['code', 'ok'])
  })

  it('has no temporary password when the answer carries something that is not one', async () => {
    const h = await harness(() => json(200, { ok: true, user: ELI, temp_password: null }))
    expect(await h.gateway.users.resetPassword(ELI.id)).toEqual({ ok: true, user: ELI })
    const number = await harness(() => json(200, { ok: true, user: ELI, temp_password: 12345 }))
    expect(await number.gateway.users.resetPassword(ELI.id)).not.toHaveProperty('tempPassword')
  })

  it('says that the function is not there when the platform says that it cannot find it', async () => {
    const platform = await harness(() => json(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }))
    expect(await platform.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'not_deployed' })
    const html = await harness(() => new Response('<html>Not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }))
    expect(await html.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'not_deployed' })
    const empty = await harness(() => new Response(null, { status: 404 }))
    expect(await empty.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'not_deployed' })
  })

  it('does not take a "not found" of the function itself for a function that is not there', async () => {
    const h = await harness(() => json(404, { ok: false, code: 'not_found' }))
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'not_found' })
  })

  it('does not take for the function\'s own a body that has a code of ours and is not shaped as ours', async () => {
    const h = await harness(() => json(404, { code: 'not_found', message: 'Requested function was not found' }))
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'not_deployed' })
  })

  it.each([
    [401, { code: 401, message: 'Invalid JWT' }, 'unauthenticated'],
    [403, { message: 'Forbidden' }, 'forbidden'],
    [500, '<html>Internal Server Error</html>', 'failed'],
    [502, 'Bad Gateway', 'failed'],
    [503, { msg: 'Service unavailable' }, 'failed'],
    [400, { message: 'something else' }, 'failed'],
  ])('reads an answer of the platform with the status %s and the body %j as "%s", also when the body is not JSON', async (status, body, code) => {
    const h = await harness(() =>
      typeof body === 'string' ? new Response(body, { status, headers: { 'content-type': 'text/plain' } }) : json(status, body),
    )
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code })
  })

  it('does not trust a body that has the shape of ours with a code that is not ours', async () => {
    const h = await harness(() => json(409, { ok: false, code: 'something_new' }))
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'failed' })
  })

  it('says "failed" when the platform says that its own relay failed', async () => {
    const h = await harness(() => json(500, { message: 'function failed to start' }, { 'x-relay-error': 'true' }))
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'failed' })
  })

  it('says "network" when the request does not get to the server', async () => {
    const h = await harness(() => {
      throw new TypeError('Failed to fetch')
    })
    expect(await h.gateway.users.setRole(ELI.id, 'admin')).toEqual({ ok: false, code: 'network' })
  })

  it.each([
    ['an answer with no person in it', json(200, { ok: true })],
    ['an answer that has a person with no id', json(200, { ok: true, user: { display_name: 'x' } })],
    ['an answer that is not JSON', new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['an empty answer', new Response(null, { status: 200 })],
    ['a refusal that came as a success', json(200, { ok: false, code: 'forbidden' })],
  ])('says "failed" for %s (and a refusal that is ours is read as itself)', async (what, response) => {
    const h = await harness(() => response.clone())
    const outcome = failureOf(await h.gateway.users.setRole(ELI.id, 'admin'))
    expect(outcome.code).toBe(what === 'a refusal that came as a success' ? 'forbidden' : 'failed')
  })
})

describe('the sentences of the answers', () => {
  it('has a Hebrew sentence for every failure that the gateway can give', async () => {
    const answers: Array<[number, unknown]> = [
      [400, { ok: false, code: 'invalid' }],
      [401, { ok: false, code: 'unauthenticated' }],
      [403, { ok: false, code: 'forbidden' }],
      [404, { ok: false, code: 'not_found' }],
      [409, { ok: false, code: 'last_admin' }],
      [404, { code: 'NOT_FOUND' }],
      [500, 'boom'],
    ]
    for (const [status, body] of answers) {
      const h = await harness(() => (typeof body === 'string' ? new Response(body, { status }) : json(status, body)))
      const outcome = failureOf(await h.gateway.users.setRole(ELI.id, 'admin'))
      expect(adminMessage(outcome)).toMatch(/[֐-׿]/)
      expect(Object.values(ADMIN_MESSAGES)).toContain(adminMessage({ ...outcome, field: undefined }))
    }
  })
})
