import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../auth/types'
import type {
  Attachment,
  AttachmentsGateway,
  DirectoryGateway,
  Settings,
  Status,
  TaskEvent,
  TasksGateway,
} from './gateways'
import { DEFAULT_SHIP_METHODS, SERVER_OWNED_FIELDS, type Task, type TaskPatch } from './model'
import { buildSearchFilter } from './search'

/** The database API answers at most 1000 rows to one request. */
export const PAGE_SIZE = 1000
/** More pages than any team will ever have tasks; it only stops a server that never ends the list. */
export const MAX_PAGES = 200
const SEARCH_LIMIT = 200
const HISTORY_LIMIT = 500
const RECENT_DONE_DAYS = 30
const DAY_MS = 86_400_000
const BUCKET = 'task-files'
const SIGNED_URL_SECONDS = 3600
const PROFILE_COLUMNS = 'id,email,display_name,role,is_active,must_change_password'

/** An error that carries the HTTP status (0 when the server was not reached), as the auth gateway's do. */
type GatewayError = Error & { code?: string; status: number }

function apiError(error: { message: string; code?: string }, status: number): GatewayError {
  return Object.assign(new Error(error.message), { code: error.code, status })
}

function storageError(error: { message: string; status?: number }): GatewayError {
  // The storage client reports a connection that is down without a status.
  return Object.assign(new Error(error.message), { status: typeof error.status === 'number' ? error.status : 0 })
}

// The fields that the database keeps itself are never sent, even if a caller passes them.
function cleanPatch(patch: TaskPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([field, value]) => value !== undefined && !SERVER_OWNED_FIELDS.has(field)),
  )
}

function parseSettings(rows: Array<{ key: string; value: unknown }>): Settings {
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const template = values.get('glassix_url_template')
  const methods = values.get('ship_methods')
  const backup = values.get('last_backup_at')
  return {
    glassix_url_template: typeof template === 'string' ? template : '',
    ship_methods:
      Array.isArray(methods) && methods.every((method) => typeof method === 'string')
        ? (methods as string[])
        : [...DEFAULT_SHIP_METHODS],
    last_backup_at: typeof backup === 'string' ? backup : null,
  }
}

let channels = 0
/** Every subscription gets a channel of its own, so that a stale one can never be mistaken for it. */
const channelName = (prefix: string) => `${prefix}-${++channels}`

export function createSupabaseTasksGateway(client: SupabaseClient, options: { maxPages?: number } = {}): TasksGateway {
  const maxPages = options.maxPages ?? MAX_PAGES

  // The library would retry a failed read for several seconds. The store has its own answer to an
  // unreachable server, so it must hear about the failure at once: every read below says retry(false).
  return {
    async loadInitial(now) {
      const since = new Date(now.getTime() - RECENT_DONE_DAYS * DAY_MS).toISOString()
      const tasks: Task[] = []
      for (let page = 0; page < maxPages; page++) {
        const from = page * PAGE_SIZE
        const { data, error, status } = await client
          .from('tasks')
          .select('*')
          .is('deleted_at', null)
          .or(`done_at.is.null,done_at.gte.${since}`)
          // A fixed order, so that the pages neither overlap nor skip a row.
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1)
          .retry(false)
        if (error) throw apiError(error, status)
        tasks.push(...(data as Task[]))
        if (data.length < PAGE_SIZE) return tasks
      }
      throw new Error('Too many tasks to load')
    },

    async search(query) {
      const filter = buildSearchFilter(query)
      if (!filter) return []
      const { data, error, status } = await client
        .from('tasks')
        .select('*')
        .is('deleted_at', null)
        .or(filter)
        .order('updated_at', { ascending: false })
        .limit(SEARCH_LIMIT)
        .retry(false)
      if (error) throw apiError(error, status)
      return data as Task[]
    },

    async upsert(id, patch) {
      const { data, error, status } = await client
        .from('tasks')
        .upsert({ id, ...cleanPatch(patch) }, { onConflict: 'id' })
        .select()
        .single()
      if (error) throw apiError(error, status)
      return data as Task
    },

    subscribe(onEvent, onState) {
      const channel = client
        .channel(channelName('tasks'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
          // Tasks are never deleted, only marked, so a delete is not a change that matters.
          if (payload.eventType === 'DELETE') return
          onEvent({ type: 'upsert', task: payload.new as unknown as Task })
        })
        .subscribe((state) => onState(state === 'SUBSCRIBED'))
      return () => {
        void client.removeChannel(channel)
      }
    },

    async loadHistory(taskId) {
      const { data, error, status } = await client
        .from('task_events')
        .select('id,task_id,actor_id,type,changes,at')
        .eq('task_id', taskId)
        .order('at', { ascending: false })
        .order('id', { ascending: false })
        .limit(HISTORY_LIMIT)
        .retry(false)
      if (error) throw apiError(error, status)
      return data as TaskEvent[]
    },
  }
}

export function createSupabaseDirectoryGateway(client: SupabaseClient): DirectoryGateway {
  return {
    async load() {
      const [statuses, profiles, settings] = await Promise.all([
        client.from('statuses').select('key,name_he,color,sort,is_active').order('sort', { ascending: true }).retry(false),
        client.from('profiles').select(PROFILE_COLUMNS).order('display_name', { ascending: true }).retry(false),
        client.from('app_settings').select('key,value').retry(false),
      ])
      for (const result of [statuses, profiles, settings]) {
        if (result.error) throw apiError(result.error, result.status)
      }
      return {
        statuses: statuses.data as Status[],
        profiles: profiles.data as Profile[],
        settings: parseSettings(settings.data as Array<{ key: string; value: unknown }>),
      }
    },

    subscribe(onChange) {
      const channel = client.channel(channelName('directory'))
      for (const table of ['statuses', 'app_settings', 'profiles']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
      }
      channel.subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}

export function createSupabaseAttachmentsGateway(client: SupabaseClient): AttachmentsGateway {
  const bucket = () => client.storage.from(BUCKET)

  return {
    async list(taskId) {
      const { data, error, status } = await client
        .from('attachments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
        .retry(false)
      if (error) throw apiError(error, status)
      return data as Attachment[]
    },

    async add(taskId, { full, thumb, kind, width, height }) {
      const id = crypto.randomUUID()
      const storagePath = `${taskId}/${id}.jpg`
      const thumbPath = `${taskId}/${id}_t.jpg`
      const uploaded: string[] = []
      try {
        // The files first and the row last, so that no row ever points at a missing file.
        for (const [path, file] of [
          [storagePath, full],
          [thumbPath, thumb],
        ] as const) {
          const { error } = await bucket().upload(path, file, { contentType: 'image/jpeg', upsert: false })
          if (error) throw storageError(error)
          uploaded.push(path)
        }
        const { data, error, status } = await client
          .from('attachments')
          .insert({
            id,
            task_id: taskId,
            storage_path: storagePath,
            thumb_path: thumbPath,
            kind,
            width,
            height,
            bytes: full.size,
          })
          .select()
          .single()
        if (error) throw apiError(error, status)
        return data as Attachment
      } catch (err) {
        // A file without a row would only take up room, but there is no reason to leave it there.
        if (uploaded.length > 0) await bucket().remove(uploaded).catch(() => undefined)
        throw err
      }
    },

    async remove(attachment) {
      const { data, error, status } = await client
        .from('attachments')
        .delete()
        .eq('id', attachment.id)
        .select('id')
        .retry(false)
      if (error) throw apiError(error, status)
      if (data.length === 0) {
        // Row level security hides a row that the caller may not delete: no error, and no row deleted.
        // A row that is gone is what was asked for; a row that is still there was refused.
        const left = await client.from('attachments').select('id').eq('id', attachment.id).retry(false).maybeSingle()
        if (left.error) throw apiError(left.error, left.status)
        if (left.data) throw Object.assign(new Error('Removing the attachment was refused'), { status: 403 })
      }
      // The row is gone, so a file that stays behind harms no one.
      const files = [attachment.storage_path, attachment.thumb_path].filter((path) => path !== '')
      await bucket().remove(files).catch(() => undefined)
    },

    async signedUrl(path) {
      const { data, error } = await bucket().createSignedUrl(path, SIGNED_URL_SECONDS)
      if (error) throw storageError(error)
      return data.signedUrl
    },
  }
}
