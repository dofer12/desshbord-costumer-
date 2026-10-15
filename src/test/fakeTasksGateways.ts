import type { Profile } from '../features/auth/types'
import type {
  Attachment,
  AttachmentsGateway,
  DirectoryGateway,
  Settings,
  Status,
  TaskChangeEvent,
  TaskEvent,
  TasksGateway,
} from '../features/tasks/gateways'
import { DEFAULT_SHIP_METHODS, SERVER_OWNED_FIELDS, newTask, type Task, type TaskPatch } from '../features/tasks/model'
import { normalizeQuery, phoneNeedle } from '../features/tasks/search'
import { DANA, OWNER } from './fakeGateway'

// In-memory stand-ins for the three gateways. They keep the rows of a pretend server and behave
// like the real one where the stores can tell the difference: an upsert merges the fields of the
// patch into the row with the same id, the server stamps the time and `done_by`, and a call can
// fail the way a real one does. supabaseGateways.contract.test.ts pins the real gateways.

const clone = <T>(value: T): T => structuredClone(value)

function cleanPatch(patch: TaskPatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([field, value]) => value !== undefined && !SERVER_OWNED_FIELDS.has(field)),
  )
}

/** What a failed call looks like when the server cannot be reached. */
export function networkError(): Error {
  return Object.assign(new TypeError('Failed to fetch'), { status: 0 })
}

/** What a failed call looks like when the server refuses it. */
export function refusal(status = 400, message = 'The server refused the change', code?: string): Error {
  return Object.assign(new Error(message), { status, code })
}

/** The failures that a fake can be told to produce, shared by the three fakes. */
function createFailures() {
  let offline = false
  const queue: unknown[] = []
  return {
    setOffline(value: boolean) {
      offline = value
    },
    failNext(error: unknown) {
      queue.push(error)
    },
    /** Throws the failure that is due for this call, if there is one. */
    check() {
      if (offline) throw networkError()
      if (queue.length > 0) throw queue.shift()
    },
  }
}

export interface FakeTasks {
  gateway: TasksGateway
  /** The rows of the pretend server, by id. */
  rows: Map<string, Task>
  /** Every upsert that reached the pretend server, in order. */
  upserts: Array<{ id: string; patch: TaskPatch }>
  /** The history of the pretend server, in the order it was written. */
  events: TaskEvent[]
  /** How many times each call was made. */
  calls: { loadInitial: number; search: number; upsert: number; loadHistory: number }
  /** How many subscribers are listening. */
  readonly subscribers: number
  /** A row that arrives through realtime, as if another device had saved it. It is stored on the pretend server too. */
  pushRemote(task: Task): void
  /** Tells the subscribers whether the live connection is up. */
  setLive(live: boolean): void
  /** The next call, of any kind, fails with this error. */
  failNext(error: unknown): void
  /** The next upsert reaches the pretend server and is applied, but the answer is lost: the call fails as if offline. */
  loseNextAnswer(): void
  /** While true, every call fails as if there were no connection. */
  setOffline(offline: boolean): void
}

export function createFakeTasks(options: { userId?: string; now?: () => Date; tasks?: Task[] } = {}): FakeTasks {
  const userId = options.userId ?? DANA.id
  const now = options.now ?? (() => new Date())
  const rows = new Map<string, Task>((options.tasks ?? []).map((task) => [task.id, clone(task)]))
  const upserts: FakeTasks['upserts'] = []
  const events: TaskEvent[] = []
  const calls = { loadInitial: 0, search: 0, upsert: 0, loadHistory: 0 }
  const listeners = new Set<{ onEvent: (event: TaskChangeEvent) => void; onState: (live: boolean) => void }>()
  const failures = createFailures()
  let answerLost = false

  const gateway: TasksGateway = {
    async loadInitial(at) {
      calls.loadInitial++
      failures.check()
      const since = at.getTime() - 30 * 86_400_000
      return [...rows.values()]
        .filter((t) => t.deleted_at === null && (t.done_at === null || Date.parse(t.done_at) >= since))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map(clone)
    },

    async search(query) {
      calls.search++
      failures.check()
      const text = normalizeQuery(query).toLowerCase()
      if (!text) return []
      const digits = phoneNeedle(query)
      return [...rows.values()]
        .filter((t) => t.deleted_at === null)
        .filter(
          (t) =>
            [t.title, t.customer_name, t.order_number, t.service_call_number, t.glassix_conversation_id, t.cargo_number, t.product_sku].some(
              (value) => value.toLowerCase().includes(text),
            ) || (digits !== null && t.customer_phone_digits.includes(digits)),
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 200)
        .map(clone)
    },

    async upsert(id, patch) {
      calls.upsert++
      failures.check()
      const existing = rows.get(id)
      const row: Task = { ...(existing ?? newTask(userId, id)), ...cleanPatch(patch) }
      row.updated_at = now().toISOString()
      // What the triggers of the database do.
      if (row.done_at === null) row.done_by = null
      else if (!existing || existing.done_at === null) row.done_by = userId
      row.customer_phone_digits = row.customer_phone.replace(/\D/g, '')
      rows.set(id, row)
      upserts.push({ id, patch: clone(patch) })
      if (answerLost) {
        answerLost = false
        throw networkError()
      }
      return clone(row)
    },

    subscribe(onEvent, onState) {
      const listener = { onEvent, onState }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async loadHistory(taskId) {
      calls.loadHistory++
      failures.check()
      return events.filter((event) => event.task_id === taskId).sort((a, b) => b.id - a.id).map(clone)
    },
  }

  return {
    gateway,
    rows,
    upserts,
    events,
    calls,
    get subscribers() {
      return listeners.size
    },
    pushRemote(task) {
      rows.set(task.id, clone(task))
      for (const listener of [...listeners]) listener.onEvent({ type: 'upsert', task: clone(task) })
    },
    setLive(live) {
      for (const listener of [...listeners]) listener.onState(live)
    },
    failNext: failures.failNext,
    loseNextAnswer() {
      answerLost = true
    },
    setOffline: failures.setOffline,
  }
}

export const FAKE_STATUSES: Status[] = [
  { key: 'processing', name_he: 'בטיפול', color: '#22a559', sort: 1, is_active: true },
  { key: 'completed', name_he: 'הושלמו', color: '#7c9cc0', sort: 3, is_active: true },
  { key: 'cargo', name_he: 'Send to CARGO', color: '#1e88c9', sort: 8, is_active: true },
  { key: 'abroad', name_he: 'הזמנת חו"ל', color: '#18c13a', sort: 17, is_active: true },
]

export interface FakeDirectory {
  gateway: DirectoryGateway
  statuses: Status[]
  profiles: Profile[]
  settings: Settings
  /** How many times the directory was loaded. */
  loads: number
  /** Tells the subscribers that a status, a setting or a profile changed. */
  changed(): void
  failNext(error: unknown): void
  setOffline(offline: boolean): void
}

export function createFakeDirectory(): FakeDirectory {
  const failures = createFailures()
  const listeners = new Set<() => void>()
  const directory: FakeDirectory = {
    statuses: clone(FAKE_STATUSES),
    profiles: [clone(OWNER), clone(DANA)],
    settings: {
      glassix_url_template: 'https://glassix.example/conversations/{id}',
      ship_methods: [...DEFAULT_SHIP_METHODS],
      last_backup_at: null,
    },
    loads: 0,
    gateway: {
      async load() {
        directory.loads++
        failures.check()
        return {
          statuses: clone(directory.statuses),
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
    changed() {
      for (const listener of [...listeners]) listener()
    },
    failNext: failures.failNext,
    setOffline: failures.setOffline,
  }
  return directory
}

export interface FakeAttachments {
  gateway: AttachmentsGateway
  items: Attachment[]
  /** The paths of the files that went away with their attachments. */
  removedFiles: string[]
  failNext(error: unknown): void
  setOffline(offline: boolean): void
}

export function createFakeAttachments(options: { userId?: string } = {}): FakeAttachments {
  const userId = options.userId ?? DANA.id
  const failures = createFailures()
  let counter = 0
  const fake: FakeAttachments = {
    items: [],
    removedFiles: [],
    gateway: {
      async list(taskId) {
        failures.check()
        return fake.items.filter((item) => item.task_id === taskId).map(clone)
      },
      async add(taskId, { full, kind, width, height }) {
        failures.check()
        const id = `attachment-${++counter}`
        const attachment: Attachment = {
          id,
          task_id: taskId,
          storage_path: `${taskId}/${id}.jpg`,
          thumb_path: `${taskId}/${id}_t.jpg`,
          kind,
          width,
          height,
          bytes: full.size,
          uploaded_by: userId,
          created_at: new Date().toISOString(),
        }
        fake.items.push(attachment)
        return clone(attachment)
      },
      async remove(attachment) {
        failures.check()
        fake.items = fake.items.filter((item) => item.id !== attachment.id)
        fake.removedFiles.push(attachment.storage_path, attachment.thumb_path)
      },
      async signedUrl(path) {
        failures.check()
        return `https://files.example/${path}?token=fake`
      },
    },
    failNext: failures.failNext,
    setOffline: failures.setOffline,
  }
  return fake
}
