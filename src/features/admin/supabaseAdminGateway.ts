import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { apiError, type ApiError } from '../../lib/apiError'
import type { Profile } from '../auth/types'
import type { Status } from '../tasks/gateways'
import type { AdminErrorCode, AdminGateway, AdminStatusesGateway, UserFailureCode, UserOutcome } from './gateways'
import { cleanStatusPatch, newStatusRow } from './statusRules'

// The administrator tools of the real app: the people of the team are made, reset, blocked and changed
// by the Edge Function admin-users (supabase/functions/admin-users), the only code that holds the secret key.
// The app sends the token of the session, and nothing else of who is asking: the function judges that itself.
// The statuses are the exception: they are rows of a table that the policies of the database let only an
// administrator write, so the app writes them itself, with the token of the session.

const FUNCTION_NAME = 'admin-users'
const STATUS_COLUMNS = 'key,name_he,color,sort,is_active'
/** The database says that a key exists: another administrator made it at the same moment. This many keys are tried. */
const KEY_TRIES = 3
const UNIQUE_VIOLATION = '23505'
const CODES: readonly AdminErrorCode[] = ['unauthenticated', 'forbidden', 'invalid', 'email_taken', 'name_taken', 'not_found', 'last_admin', 'failed']

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function failure(code: UserFailureCode, field?: unknown): UserOutcome {
  return typeof field === 'string' ? { ok: false, code, field } : { ok: false, code }
}

/** A refusal that is the function's own: `{ ok: false, code }` with a code that it knows. Anything else is not. */
function refusalOf(body: unknown): UserOutcome | null {
  if (!isObject(body) || body.ok !== false) return null
  const code = (CODES as readonly unknown[]).includes(body.code) ? (body.code as AdminErrorCode) : null
  // Only the code and the field are taken: whatever else the body says is not for the screen.
  return code === null ? null : failure(code, body.field)
}

/** The outcome of an answer that came with a status that is not 2xx: ours, or the platform's. */
async function outcomeOfHttpError(response: Response): Promise<UserOutcome> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // An answer that is not JSON (a page of a proxy, an empty one) says nothing but its status.
  }
  const ours = refusalOf(body)
  if (ours) return ours
  // The platform answers 404 for a function that is not deployed, with a body that is not ours.
  if (response.status === 404) return failure('not_deployed')
  if (response.status === 401) return failure('unauthenticated')
  if (response.status === 403) return failure('forbidden')
  return failure('failed')
}

function outcomeOfData(data: unknown): UserOutcome {
  if (!isObject(data)) return failure('failed')
  if (data.ok === false) return refusalOf(data) ?? failure('failed')
  const user = data.user
  if (data.ok !== true || !isObject(user) || typeof user.id !== 'string') return failure('failed')
  return { ok: true, user: user as unknown as Profile, ...(typeof data.temp_password === 'string' ? { tempPassword: data.temp_password } : {}) }
}

function createStatusesGateway(client: SupabaseClient): AdminStatusesGateway {
  return {
    async add(input) {
      // The key and the place are made from what there is. Nothing is cached: another administrator may have added one.
      const { data, error, status } = await client.from('statuses').select('key,sort').retry(false)
      if (error) throw apiError(error, status)
      const existing = data as Array<Pick<Status, 'key' | 'sort'>>
      const tried: string[] = []
      for (let attempt = 1; ; attempt++) {
        const row = newStatusRow(input, existing, tried)
        const result = await client.from('statuses').insert(row).select(STATUS_COLUMNS).single()
        if (!result.error) return result.data as Status
        if (result.error.code !== UNIQUE_VIOLATION || attempt >= KEY_TRIES) throw apiError(result.error, result.status)
        tried.push(row.key)
      }
    },

    async update(key, patch) {
      const clean = cleanStatusPatch(patch)
      const { data, error, status } = await client.from('statuses').update(clean).eq('key', key).select(STATUS_COLUMNS).single()
      if (error) throw apiError(error, status)
      return data as Status
    },

    async reorder(keys) {
      // One request for each status; a request that fails does not stop the others, and the first failure is the one that is told.
      let first: ApiError | null = null
      for (const [index, key] of keys.entries()) {
        const { error, status } = await client.from('statuses').update({ sort: index + 1 }).eq('key', key)
        if (error && first === null) first = apiError(error, status)
      }
      if (first) throw first
    },
  }
}

export function createSupabaseAdminGateway(client: SupabaseClient): AdminGateway {
  async function call(body: Record<string, unknown>): Promise<UserOutcome> {
    try {
      const { data, error } = await client.functions.invoke(FUNCTION_NAME, { body })
      if (error) {
        if (error instanceof FunctionsHttpError) return await outcomeOfHttpError(error.context as Response)
        if (error instanceof FunctionsFetchError) return failure('network')
        return failure('failed')
      }
      return outcomeOfData(data)
    } catch {
      return failure('failed')
    }
  }

  return {
    users: {
      create: (input) => call({ action: 'create', email: input.email, display_name: input.display_name, role: input.role }),
      resetPassword: (userId) => call({ action: 'reset_password', user_id: userId }),
      setActive: (userId, isActive) => call({ action: 'set_active', user_id: userId, is_active: isActive }),
      setRole: (userId, role) => call({ action: 'set_role', user_id: userId, role }),
      rename: (userId, displayName) => call({ action: 'rename', user_id: userId, display_name: displayName }),
    },
    statuses: createStatusesGateway(client),
  }
}
