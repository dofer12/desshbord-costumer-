import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import { apiError, type ApiError } from '../../lib/apiError'
import type { Profile } from '../auth/types'
import type { Status } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import type {
  AdminErrorCode,
  AdminGateway,
  AdminSettingsGateway,
  AdminStatusesGateway,
  AdminTasksGateway,
  ExistingKeys,
  ImportOutcome,
  UserFailureCode,
  UserOutcome,
} from './gateways'
import { isKnown } from './importKeys'
import type { ImportItem } from './legacyFormat'
import { orderKey } from './ordersImport'
import { settingRows } from './settingsRules'
import { cleanStatusPatch, newStatusRow } from './statusRules'
import { toAdminWriteMessage } from './writeErrors'

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
/** An import is written this many tasks in a request. */
const IMPORT_CHUNK = 100
/** The database API answers at most 1000 rows to one request; more pages than any team has tasks only stops a list that never ends. */
const KEYS_PAGE = 1000
const KEYS_MAX_PAGES = 200
/** The most tasks that the list of the deleted ones shows. */
const DELETED_LIMIT = 500
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

function createSettingsGateway(client: SupabaseClient): AdminSettingsGateway {
  return {
    async save(patch) {
      const rows = settingRows(patch)
      if (rows.length === 0) return
      // An upsert on the key (Prefer: resolution=merge-duplicates): the rows are there since 0002, and a key that is not is made.
      const { error, status } = await client.from('app_settings').upsert(rows, { onConflict: 'key' })
      if (error) throw apiError(error, status)
    },
  }
}

function createTasksGateway(client: SupabaseClient): AdminTasksGateway {
  async function existingKeys(): Promise<ExistingKeys> {
    const legacyIds = new Set<string>()
    const orderNumbers = new Set<string>()
    for (let page = 0; page < KEYS_MAX_PAGES; page++) {
      const from = page * KEYS_PAGE
      const { data, error, status } = await client
        .from('tasks')
        .select('id,legacy_id,order_number,deleted_at')
        // A fixed order, so that the pages neither overlap nor skip a row.
        .order('id', { ascending: true })
        .range(from, from + KEYS_PAGE - 1)
        .retry(false)
      if (error) throw apiError(error, status)
      const rows = data as Array<{ id: string; legacy_id: string | null; order_number: string; deleted_at: string | null }>
      for (const row of rows) {
        legacyIds.add(row.id)
        if (row.legacy_id) legacyIds.add(row.legacy_id)
        const order = orderKey(row.order_number ?? '')
        if (order !== '' && row.deleted_at === null) orderNumbers.add(order)
      }
      if (rows.length < KEYS_PAGE) return { legacyIds, orderNumbers }
    }
    throw new Error('Too many tasks to read')
  }

  /** One page of tasks, from the row `from` on, in the order that never skips or repeats a row. */
  async function readPage(from: number): Promise<Task[]> {
    const { data, error, status } = await client
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + KEYS_PAGE - 1)
      .retry(false)
    if (error) throw apiError(error, status)
    return data as Task[]
  }

  /** Who is importing: the tasks are theirs, as the policies of the database say. */
  async function importingUser(): Promise<string> {
    const { data } = await client.auth.getSession()
    const id = data.session?.user.id
    if (!id) throw apiError({ message: 'No session', code: 'PGRST301' }, 401)
    return id
  }

  /** One request for some of the items. Resolves with how many were made: what the database had already is left out of its answer. */
  async function write(items: ImportItem[], userId: string): Promise<number> {
    const rows = items.map((item) => ({ ...item.patch, ...(item.id === undefined ? {} : { id: item.id }), created_by: userId }))
    // An upsert on the old id that ignores duplicates, and a row with no id gets the one of the database (missing=default).
    const { data, error, status } = await client
      .from('tasks')
      .upsert(rows, { onConflict: 'legacy_id', ignoreDuplicates: true, defaultToNull: false })
      .select('id')
    if (error) throw apiError(error, status)
    return data.length
  }

  return {
    async count() {
      const { count, error, status } = await client.from('tasks').select('id', { count: 'exact', head: true }).retry(false)
      if (error) throw apiError(error, status)
      return count ?? 0
    },

    async loadAll(onPage) {
      const tasks: Task[] = []
      for (let page = 0; page < KEYS_MAX_PAGES; page++) {
        const from = page * KEYS_PAGE
        // A page that fails is read once more; a second failure fails the whole call, so that there is never half a list.
        const rows = await readPage(from).catch(() => readPage(from))
        tasks.push(...rows)
        onPage(tasks.length)
        if (rows.length < KEYS_PAGE) return tasks
      }
      throw new Error('Too many tasks to read')
    },

    async listDeleted(since) {
      const { data, error, status } = await client
        .from('tasks')
        .select('*')
        .gte('deleted_at', since.toISOString())
        .order('deleted_at', { ascending: false })
        .limit(DELETED_LIMIT)
        .retry(false)
      if (error) throw apiError(error, status)
      return data as Task[]
    },

    async restore(id) {
      // Only a task that is deleted is changed, so that the second of two administrators who restore it gets "nothing", not a second restore on the history.
      const { data, error, status } = await client.from('tasks').update({ deleted_at: null }).eq('id', id).not('deleted_at', 'is', null).select()
      if (error) throw apiError(error, status)
      return (data as Task[])[0] ?? null
    },

    existingKeys,

    async importMany(items, onProgress) {
      const userId = await importingUser()
      const outcome: ImportOutcome = { added: 0, already: 0, failed: [] }
      onProgress(0, items.length)
      for (let start = 0; start < items.length; start += IMPORT_CHUNK) {
        const chunk = items.slice(start, start + IMPORT_CHUNK)
        try {
          const added = await write(chunk, userId)
          outcome.added += added
          outcome.already += chunk.length - added
        } catch {
          // The answer may have been lost after the database applied the chunk: what is there now is looked at
          // before the second try, so that an order is not made twice.
          // (When it cannot be looked at, the second try goes with the whole chunk.)
          const known = await existingKeys().catch(() => null)
          const fresh = known === null ? chunk : chunk.filter((item) => !isKnown(item, known))
          outcome.already += chunk.length - fresh.length
          if (fresh.length > 0) {
            try {
              const added = await write(fresh, userId)
              outcome.added += added
              outcome.already += fresh.length - added
            } catch (err) {
              const message = toAdminWriteMessage(err)
              for (const item of fresh) outcome.failed.push({ key: item.legacyId ?? (item.patch.order_number || item.patch.title || ''), message })
            }
          }
        }
        onProgress(Math.min(start + chunk.length, items.length), items.length)
      }
      return outcome
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
    settings: createSettingsGateway(client),
    tasks: createTasksGateway(client),
  }
}
