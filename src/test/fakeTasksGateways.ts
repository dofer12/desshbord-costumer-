import type { Profile } from '../features/auth/types'
import type {
  Attachment,
  AttachmentsGateway,
  DirectoryGateway,
  Settings,
  Status,
  TaskEvent,
  TasksGateway,
} from '../features/tasks/gateways'
import { createMemoryAttachments, createMemoryDirectory, createMemoryTasks, type MemoryDirectory } from '../features/tasks/memoryGateways'
import type { Task, TaskPatch } from '../features/tasks/model'
import { DANA, OWNER } from './fakeGateway'

// Stand-ins for the three gateways, for the tests of the stores. They are the in-memory gateways of
// the app (memoryGateways.ts: a pretend server that behaves like the database where the stores can
// tell the difference), with what a test needs added: a log of the calls, and failures on demand.
// supabaseGateways.contract.test.ts pins the real gateways.

const clone = <T>(value: T): T => structuredClone(value)

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
  const memory = createMemoryTasks({ userId: options.userId ?? DANA.id, now: options.now, tasks: options.tasks })
  const upserts: FakeTasks['upserts'] = []
  const calls = { loadInitial: 0, search: 0, upsert: 0, loadHistory: 0 }
  const failures = createFailures()
  let answerLost = false

  const gateway: TasksGateway = {
    async loadInitial(at) {
      calls.loadInitial++
      failures.check()
      return memory.gateway.loadInitial(at)
    },
    async search(query) {
      calls.search++
      failures.check()
      return memory.gateway.search(query)
    },
    async upsert(id, patch) {
      calls.upsert++
      failures.check()
      const row = await memory.gateway.upsert(id, patch)
      upserts.push({ id, patch: clone(patch) })
      if (answerLost) {
        answerLost = false
        throw networkError()
      }
      return row
    },
    subscribe: memory.gateway.subscribe,
    async loadHistory(taskId) {
      calls.loadHistory++
      failures.check()
      return memory.gateway.loadHistory(taskId)
    },
  }

  return {
    gateway,
    rows: memory.rows,
    upserts,
    events: memory.events,
    calls,
    get subscribers() {
      return memory.subscribers
    },
    pushRemote: memory.push,
    setLive: memory.setLive,
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
  /** The pretend server behind the gateway: the tools of the administrator work on the same profiles. */
  readonly memory: MemoryDirectory
  statuses: Status[]
  profiles: Profile[]
  settings: Settings
  /** How many times the directory was loaded. */
  readonly loads: number
  /** How many subscribers are listening. */
  readonly subscribers: number
  /** Tells the subscribers that a status, a setting or a profile changed. */
  changed(): void
  failNext(error: unknown): void
  setOffline(offline: boolean): void
}

export function createFakeDirectory(): FakeDirectory {
  const memory = createMemoryDirectory({
    statuses: FAKE_STATUSES,
    profiles: [OWNER, DANA],
    settings: { glassix_url_template: 'https://glassix.example/conversations/{id}' },
  })
  const failures = createFailures()
  return {
    memory,
    gateway: {
      async load() {
        failures.check()
        return memory.gateway.load()
      },
      subscribe: memory.gateway.subscribe,
    },
    get statuses() {
      return memory.statuses
    },
    set statuses(value) {
      memory.statuses = value
    },
    get profiles() {
      return memory.profiles
    },
    set profiles(value) {
      memory.profiles = value
    },
    get settings() {
      return memory.settings
    },
    set settings(value) {
      memory.settings = value
    },
    get subscribers() {
      return memory.subscribers
    },
    get loads() {
      return memory.loads
    },
    changed: memory.changed,
    failNext: failures.failNext,
    setOffline: failures.setOffline,
  }
}

export interface FakeAttachments {
  gateway: AttachmentsGateway
  readonly items: Attachment[]
  /** The paths of the files that went away with their attachments. */
  readonly removedFiles: string[]
  failNext(error: unknown): void
  setOffline(offline: boolean): void
}

export function createFakeAttachments(options: { userId?: string; events?: TaskEvent[] } = {}): FakeAttachments {
  let counter = 0
  const memory = createMemoryAttachments({
    userId: options.userId ?? DANA.id,
    newId: () => `attachment-${++counter}`,
    events: options.events,
  })
  const failures = createFailures()
  return {
    gateway: {
      async list(taskId) {
        failures.check()
        return memory.gateway.list(taskId)
      },
      async add(taskId, files) {
        failures.check()
        return memory.gateway.add(taskId, files)
      },
      async remove(attachment) {
        failures.check()
        return memory.gateway.remove(attachment)
      },
      async signedUrl(path) {
        failures.check()
        return memory.gateway.signedUrl(path)
      },
    },
    get items() {
      return memory.items
    },
    get removedFiles() {
      return memory.removedFiles
    },
    failNext: failures.failNext,
    setOffline: failures.setOffline,
  }
}
