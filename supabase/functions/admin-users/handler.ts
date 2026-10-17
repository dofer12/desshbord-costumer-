// The HTTP layer of the Edge Function admin-users: what a request must be before the rules of logic.ts
// are asked (the method, the token in the header, the size and the shape of the body) and how each
// result is said (a status, the headers, the body). It uses only the standard Request and Response, so
// it runs the same under Deno and in the tests.

import { handleAdminRequest, type AdminDeps, type AdminErrorCode, type AdminResult } from './logic.ts'

/** A request that is longer than this is refused before it is read: the biggest real one is a few hundred bytes. */
export const MAX_BODY_BYTES = 4096

export const STATUS_OF: Record<AdminErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid: 400,
  email_taken: 409,
  name_taken: 409,
  not_found: 404,
  last_admin: 409,
  failed: 500,
}

export interface HandlerOptions {
  /** The services of a request. They are made for every request, so that what they need of the environment is read when it is needed. */
  makeDeps(): AdminDeps
  /** The CORS headers (the app is served from https://localhost on Android, from a file in Windows, and from a web address). */
  cors: Record<string, string>
}

const BAD_BODY: AdminResult = { ok: false, code: 'invalid', field: 'body' }

/** The token of a request: from the header Authorization with the word Bearer, and from nowhere else. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const token = /^bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim()
  return token ? token : null
}

/**
 * The body as text; `'too_large'` when it is longer than the limit (the rest of it is not read);
 * null when it cannot be read to the end or is not text.
 */
async function readBody(request: Request): Promise<string | 'too_large' | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too_large'
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return 'too_large'
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      bytes.set(chunk, at)
      at += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function createHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const cors = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', ...options.cors }
  const reply = (status: number, result: AdminResult, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(result), {
      status,
      // What an answer says is for the one who asked, and for nobody after them: a temporary password is in it.
      headers: { ...cors, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })

  return async (request) => {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      if (request.method !== 'POST') return reply(405, { ok: false, code: 'invalid', field: 'method' }, { Allow: 'POST, OPTIONS' })

      const token = bearerToken(request)
      if (token === null) return reply(STATUS_OF.unauthenticated, { ok: false, code: 'unauthenticated' })

      const text = await readBody(request)
      if (text === 'too_large') return reply(413, BAD_BODY)
      if (text === null) return reply(STATUS_OF.invalid, BAD_BODY)
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return reply(STATUS_OF.invalid, BAD_BODY)
      }

      const result = await handleAdminRequest(options.makeDeps(), token, body)
      return reply(result.ok ? 200 : STATUS_OF[result.code], result)
    } catch {
      // Nothing of what went wrong is said, here or in the answer: it could hold a key or an address.
      console.error('admin-users: failed')
      return reply(STATUS_OF.failed, { ok: false, code: 'failed' })
    }
  }
}
