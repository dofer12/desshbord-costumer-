import type { Profile } from '../auth/types'
import type {
  Attachment,
  AttachmentsGateway,
  DirectoryGateway,
  Settings,
  Status,
  TaskChangeEvent,
  TaskEvent,
  TaskEventType,
  TasksGateway,
} from './gateways'
import { DEFAULT_SHIP_METHODS, SERVER_OWNED_FIELDS, newTask, type Task, type TaskPatch } from './model'
import { normalizeQuery } from './search'
import { filterTasks, sortTasks } from './selectors'

// The three gateways with no server behind them: everything is kept in memory. The demo build runs
// on them, and the fakes of the tests are made from them. They do what the database does where the
// app can tell the difference: an upsert merges the fields of the patch into the row with the same id,
// the time, the person who finished a task and the phone digits are stamped by the "server", and the
// history is written the way the triggers write it (supabase/migrations/0002_core.sql, part 2).

const clone = <T>(value: T): T => structuredClone(value)

function cleanPatch(patch: TaskPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([field, value]) => value !== undefined && !SERVER_OWNED_FIELDS.has(field)),
  )
}

/** The fields that say nothing about what a person did, which the history leaves out. */
const LEFT_OUT_OF_THE_HISTORY = new Set(['updated_at', 'done_by', 'created_at', 'customer_phone_digits'])

type Changes = Record<string, [unknown, unknown]>

/** The number of the next event: after the highest there is, whoever wrote the others. */
const nextEventId = (events: TaskEvent[]) => events.reduce((highest, event) => Math.max(highest, event.id), 0) + 1

export interface MemoryTasks {
  gateway: TasksGateway
  /** The rows of the pretend server, by id. */
  rows: Map<string, Task>
  /** The history of the pretend server, in the order it was written. */
  events: TaskEvent[]
  /** How many subscribers are listening. */
  readonly subscribers: number
  /** A row that arrives through the live connection, as if another device had saved it. It is stored too. */
  push(task: Task): void
  /** Tells the subscribers whether the live connection is up. */
  setLive(live: boolean): void
}

export function createMemoryTasks(options: {
  /** The person who is signed in: the author of new tasks and the actor of the history. */
  userId: string
  tasks?: Task[]
  /** History that is already there. */
  events?: TaskEvent[]
  now?: () => Date
  /** Send every saved row to the subscribers, as the live connection of the real server does. */
  echo?: boolean
  /** Whether the pretend connection is up from the start, so that a new subscriber is told so. The demo's is; a test's says so when it wants to. */
  live?: boolean
}): MemoryTasks {
  const { userId, echo = false } = options
  let connected = options.live ?? false
  const now = options.now ?? (() => new Date())
  const rows = new Map<string, Task>((options.tasks ?? []).map((task) => [task.id, clone(task)]))
  const events: TaskEvent[] = clone(options.events ?? [])
  const listeners = new Set<{ onEvent: (event: TaskChangeEvent) => void; onState: (live: boolean) => void }>()

  function emit(task: Task) {
    for (const listener of [...listeners]) listener.onEvent({ type: 'upsert', task: clone(task) })
  }

  function addEvent(task: Task, type: TaskEventType, changes: Changes = {}) {
    events.push({ id: nextEventId(events), task_id: task.id, actor_id: userId, type, changes, at: task.updated_at })
  }

  /** One event for each kind of change, as the trigger of the database writes them. */
  function writeHistory(before: Task | undefined, after: Task) {
    if (!before) {
      addEvent(after, 'created')
      return
    }
    const diff: Changes = {}
    for (const field of Object.keys(after)) {
      if (LEFT_OUT_OF_THE_HISTORY.has(field)) continue
      const was = (before as unknown as Record<string, unknown>)[field]
      const is = (after as unknown as Record<string, unknown>)[field]
      if (!Object.is(was, is)) diff[field] = [was, is]
    }
    const kinds: Array<[string, TaskEventType | null]> = [
      ['deleted_at', before.deleted_at === null && after.deleted_at !== null ? 'deleted' : before.deleted_at !== null && after.deleted_at === null ? 'restored' : null],
      ['done_at', before.done_at === null && after.done_at !== null ? 'done' : before.done_at !== null && after.done_at === null ? 'reopened' : null],
      ['status_key', 'status'],
      ['assignee_id', 'assigned'],
    ]
    for (const [field, type] of kinds) {
      if (!(field in diff) || type === null) continue
      addEvent(after, type, { [field]: diff[field] })
      delete diff[field]
    }
    if (Object.keys(diff).length > 0) addEvent(after, 'updated', diff)
  }

  const gateway: TasksGateway = {
    async loadInitial(at) {
      const since = at.getTime() - 30 * 86_400_000
      return [...rows.values()]
        .filter((t) => t.deleted_at === null && (t.done_at === null || Date.parse(t.done_at) >= since))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map(clone)
    },

    async search(query) {
      if (!normalizeQuery(query)) return []
      const everything = { statusKey: null, assignee: 'all', shipMethod: null, state: 'all', text: query } as const
      return sortTasks(filterTasks([...rows.values()], everything, userId), 'updated', 'desc').slice(0, 200).map(clone)
    },

    async upsert(id, patch) {
      const existing = rows.get(id)
      const row: Task = { ...(existing ?? newTask(userId, id)), ...cleanPatch(patch) }
      row.updated_at = now().toISOString()
      if (row.done_at === null) row.done_by = null
      else if (!existing || existing.done_at === null) row.done_by = userId
      row.customer_phone_digits = row.customer_phone.replace(/\D/g, '')
      rows.set(id, row)
      writeHistory(existing, row)
      if (echo) emit(row)
      return clone(row)
    },

    subscribe(onEvent, onState) {
      const listener = { onEvent, onState }
      listeners.add(listener)
      if (connected) onState(true)
      return () => {
        listeners.delete(listener)
      }
    },

    async loadHistory(taskId) {
      return events
        .filter((event) => event.task_id === taskId)
        .sort((a, b) => b.id - a.id)
        .map(clone)
    },
  }

  return {
    gateway,
    rows,
    events,
    get subscribers() {
      return listeners.size
    },
    push(task) {
      rows.set(task.id, clone(task))
      emit(task)
    },
    setLive(live) {
      connected = live
      for (const listener of [...listeners]) listener.onState(live)
    },
  }
}

export interface MemoryDirectory {
  gateway: DirectoryGateway
  statuses: Status[]
  profiles: Profile[]
  settings: Settings
  /** How many times the directory was loaded. */
  loads: number
  /** How many subscribers are listening. */
  readonly subscribers: number
  /** Tells the subscribers that a status, a setting or a profile changed. */
  changed(): void
}

export function createMemoryDirectory(options: {
  statuses: Status[]
  profiles: Profile[]
  settings?: Partial<Settings>
}): MemoryDirectory {
  const listeners = new Set<() => void>()
  const directory: MemoryDirectory = {
    statuses: clone(options.statuses),
    profiles: clone(options.profiles),
    settings: {
      glassix_url_template: '',
      ship_methods: [...DEFAULT_SHIP_METHODS],
      last_backup_at: null,
      ...clone(options.settings ?? {}),
    },
    loads: 0,
    gateway: {
      async load() {
        directory.loads++
        return {
          // In the order of their places, as the database gives them.
          statuses: clone(directory.statuses).sort((a, b) => a.sort - b.sort),
          profiles: clone(directory.profiles),
          settings: clone(directory.settings),
        }
      },
      subscribe(onChange) {
        listeners.add(onChange)
        return () => {
          listeners.delete(onChange)
        }
      },
    },
    get subscribers() {
      return listeners.size
    },
    changed() {
      for (const listener of [...listeners]) listener()
    },
  }
  return directory
}

export interface MemoryAttachments {
  gateway: AttachmentsGateway
  items: Attachment[]
  /** The pictures, by path in the bucket. */
  blobs: Map<string, Blob>
  /** The paths of the files that went away with their attachments. */
  removedFiles: string[]
}

export function createMemoryAttachments(options: {
  userId: string
  now?: () => Date
  /** How the address of a picture is made. By default it only names the path. */
  signedUrl?: (path: string, picture: Blob | undefined) => string
  newId?: () => string
  /** The history of the tasks, as the pretend server keeps it: adding and removing a picture is written on it, as the triggers of the database do. */
  events?: TaskEvent[]
}): MemoryAttachments {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => crypto.randomUUID())
  const { events } = options

  function log(taskId: string, type: 'attachment_added' | 'attachment_removed', changes: Changes) {
    events?.push({ id: nextEventId(events), task_id: taskId, actor_id: options.userId, type, changes, at: now().toISOString() })
  }
  const memory: MemoryAttachments = {
    items: [],
    blobs: new Map(),
    removedFiles: [],
    gateway: {
      async list(taskId) {
        return memory.items.filter((item) => item.task_id === taskId).map(clone)
      },
      async add(taskId, { full, thumb, kind, width, height }) {
        const id = newId()
        const attachment: Attachment = {
          id,
          task_id: taskId,
          storage_path: `${taskId}/${id}.jpg`,
          thumb_path: `${taskId}/${id}_t.jpg`,
          kind,
          width,
          height,
          bytes: full.size,
          uploaded_by: options.userId,
          created_at: now().toISOString(),
        }
        memory.blobs.set(attachment.storage_path, full)
        memory.blobs.set(attachment.thumb_path, thumb)
        memory.items.push(attachment)
        log(taskId, 'attachment_added', { attachment: [null, { id, kind }] })
        return clone(attachment)
      },
      async remove(attachment) {
        memory.items = memory.items.filter((item) => item.id !== attachment.id)
        for (const path of [attachment.storage_path, attachment.thumb_path]) {
          memory.blobs.delete(path)
          memory.removedFiles.push(path)
        }
        log(attachment.task_id, 'attachment_removed', { attachment: [{ id: attachment.id, kind: attachment.kind }, null] })
      },
      async signedUrl(path) {
        return options.signedUrl ? options.signedUrl(path, memory.blobs.get(path)) : `https://files.example/${path}?token=memory`
      },
    },
  }
  return memory
}
