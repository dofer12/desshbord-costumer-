import { createStore, type StoreApi } from 'zustand/vanilla'
import { isConnectionLost, isRetryable, noAnswerInTime, toHebrewLoadError, toHebrewSaveFailure } from './errors'
import type { TasksGateway } from './gateways'
import { SERVER_OWNED_FIELDS, isWholeRow, newTask, taskToPatch, type Task, type TaskPatch } from './model'
import type { OutboxEntry, OutboxStorage } from './outbox'
import { normalizeQuery } from './search'

/** How often the changes that are waiting are tried again while the app is open. */
export const FLUSH_INTERVAL_MS = 30_000

/** How long the tasks wait to be read again after a row came that could not be kept, so that a burst of them is read once. */
export const REREAD_DELAY_MS = 300

/** How long a change may take to be sent. A connection that carries nothing is given up on, so that it does not hold every change behind it. */
export const REQUEST_TIMEOUT_MS = 20_000

export interface TasksState {
  /** The tasks as the person sees them: the row of the server with the changes that are still waiting on top. */
  tasks: Record<string, Task>
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** How many tasks have changes waiting to be sent: the "N שינויים ממתינים". */
  pending: number
  /** Changes that the server refused. They stay on the screen and are not sent again until the person acts. */
  failed: Array<{ id: string; message: string }>
  /** Whether the live connection that brings the changes of others is up. */
  live: boolean
}

export interface TasksActions {
  load(): Promise<void>
  /** A new task. It is shown at once and sent whole. */
  create(task: Task): void
  /** Changes some fields of a task. It is shown at once and only these fields are sent. */
  update(id: string, patch: TaskPatch): void
  markDone(id: string, done: boolean): void
  softDelete(id: string, deleted: boolean): void
  /** Sends the waiting changes, one at a time. Resolves when it has sent all it can. */
  flush(): Promise<void>
  /** Puts the refused changes back in the queue, and sends them. */
  retryFailed(): void
  /** Gives up a refused change: the task shows what the server has again, and a new task disappears. */
  discardFailed(id: string): void
  /** A row that came from the server, here or through realtime. */
  applyRemote(task: Task): void
  /** Looks in all the tasks on the server. What it finds is kept, so that it can be opened and changed. */
  search(query: string): Promise<Task[]>
  /** Listens for the changes of others and for the moments to send again: online, visible, every 30 seconds. */
  start(): void
  stop(): void
}

export type TasksStore = StoreApi<TasksState & TasksActions>

const newer = (a: Task, b: Task) => Date.parse(a.updated_at) > Date.parse(b.updated_at)

function cleanPatch(patch: TaskPatch): TaskPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([field, value]) => value !== undefined && !SERVER_OWNED_FIELDS.has(field)),
  ) as TaskPatch
}

export function createTasksStore(deps: { gateway: TasksGateway; storage: OutboxStorage; now?: () => Date; requestTimeoutMs?: number }): TasksStore {
  const { gateway, storage } = deps
  const now = deps.now ?? (() => new Date())
  const timeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS

  /** The last row that the server gave for each task. */
  let server = new Map<string, Task>()
  /** Tasks that were made here and that the server has not confirmed yet. */
  const local = new Map<string, Task>()
  /** The changes that have not been delivered. This is the truth; the storage keeps a copy of it. */
  let entries: OutboxEntry[] = []
  /** Numbers the loads, so that the late answer of an old one cannot overwrite a newer one. */
  let loads = 0
  let running: Promise<void> | null = null
  let saving: Promise<void> = Promise.resolve()
  let unsubscribe: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let rereadTimer: ReturnType<typeof setTimeout> | null = null
  let listeners: Array<[EventTarget, string, EventListener]> = []
  let wasDown = false

  return createStore<TasksState & TasksActions>()((set, get) => {
    /** A task that was queued in an earlier run and has not reached the server: all that is known is its change. */
    function placeholder(entry: OutboxEntry): Task {
      const queued = new Date(entry.queuedAt).toISOString()
      return { ...newTask('', entry.id), created_at: queued, updated_at: queued }
    }

    function view(id: string): Task | undefined {
      const entry = entries.find((e) => e.id === id)
      const base = server.get(id) ?? local.get(id) ?? (entry?.isNew ? placeholder(entry) : undefined)
      if (!base) return undefined
      if (!entry) return base
      const merged = { ...base, ...entry.patch }
      // The database makes the digits of the phone number; a task with a waiting change gets them here.
      return { ...merged, customer_phone_digits: merged.customer_phone.replace(/\D/g, '') }
    }

    function counts() {
      return {
        pending: entries.filter((e) => !e.failure).length,
        failed: entries.flatMap((e) => (e.failure ? [{ id: e.id, message: e.failure }] : [])),
      }
    }

    function publish(ids: string[]) {
      set((state) => {
        const tasks = { ...state.tasks }
        for (const id of ids) {
          const task = view(id)
          if (task) tasks[id] = task
          else delete tasks[id]
        }
        return { tasks, ...counts() }
      })
    }

    function publishAll() {
      const ids = new Set([...server.keys(), ...local.keys(), ...entries.filter((e) => e.isNew).map((e) => e.id)])
      const tasks: Record<string, Task> = {}
      for (const id of ids) {
        const task = view(id)
        if (task) tasks[id] = task
      }
      set({ tasks, ...counts() })
    }

    // What an earlier run left in the storage. It is read once, at the start, and the changes that
    // are made before it has been read are joined with it instead of being overwritten by it.
    const restored = Promise.resolve().then(async () => {
      try {
        const stored = await storage.load()
        const mine = new Map(entries.map((e) => [e.id, e]))
        const older: OutboxEntry[] = []
        for (const entry of stored) {
          const current = mine.get(entry.id)
          if (current) {
            current.patch = { ...entry.patch, ...current.patch }
            if (entry.isNew) current.isNew = true
          } else {
            older.push(entry)
          }
        }
        entries = [...older, ...entries]
      } catch {
        // The storage cannot be read. The app starts with nothing waiting, and what is queued from now on is still sent.
      }
      publishAll()
    })

    /** Writes the queue to the storage, after any write before it. A storage that fails does not stop the sending. */
    function persist() {
      saving = saving
        .then(() => restored)
        .then(() => storage.save(structuredClone(entries)))
        .catch(() => undefined)
    }

    function acceptRow(row: Task) {
      const known = server.get(row.id)
      if (!known || !newer(known, row)) server.set(row.id, row)
      local.delete(row.id)
    }

    /** The server has the sent fields now: they leave the entry, and what was changed meanwhile stays. */
    function deliver(id: string, sent: TaskPatch, row: Task) {
      const entry = entries.find((e) => e.id === id)
      if (entry) {
        const waiting = entry.patch as Record<string, unknown>
        for (const [field, value] of Object.entries(sent)) {
          if (Object.is(waiting[field], value)) delete waiting[field]
        }
        delete entry.isNew
        entry.attempts = 0
        if (Object.keys(waiting).length === 0) entries = entries.filter((e) => e !== entry)
      }
      acceptRow(row)
      persist()
      publish([id])
    }

    function queue(id: string, patch: TaskPatch, isNew: boolean) {
      const entry = entries.find((e) => e.id === id)
      if (entry) {
        entry.patch = { ...entry.patch, ...patch }
        // A person who changes a refused task may have mended what the server did not like.
        delete entry.failure
      } else {
        entries.push({ id, patch, queuedAt: now().getTime(), attempts: 0, ...(isNew ? { isNew: true } : {}) })
      }
      persist()
      publish([id])
      void flush()
    }

    /** One request, with a limit: when it is not answered in time it is told to stop and counts as a request that did not get to the server. */
    async function withinTime<T>(send: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(noAnswerInTime())
        }, timeoutMs)
      })
      try {
        return await Promise.race([send(controller.signal), late])
      } finally {
        clearTimeout(timer)
      }
    }

    /** The sending itself. It lets go of `running` at the very moment that it finds nothing more to send. */
    async function sendAll(): Promise<void> {
      /** The changes that failed for a reason that may pass: they wait for the next run, and the others go on. */
      const waiting = new Set<OutboxEntry>()
      try {
        for (;;) {
          // The storage first, so that nothing is sent that a crash could make the app forget.
          await restored
          await saving
          const entry = entries.find((e) => !e.failure && !waiting.has(e))
          if (!entry) return
          const sent = { ...entry.patch }
          let row: Task
          try {
            row = await withinTime((signal) => gateway.upsert(entry.id, sent, { signal }))
          } catch (err) {
            if (isRetryable(err)) {
              // Keep everything, and let the next moment try again.
              entry.attempts += 1
              persist()
              // No connection: the others would fail the same way, and wait as long.
              if (isConnectionLost(err)) return
              // A server that fails on this change may do well with the others: only this one waits.
              waiting.add(entry)
              continue
            }
            entry.failure = toHebrewSaveFailure(err)
            persist()
            publish([entry.id])
            continue
          }
          deliver(entry.id, sent, row)
        }
      } finally {
        running = null
      }
    }

    /** One run at a time: a call while one is going on joins it. It resolves when the storage is up to date as well. */
    function flush(): Promise<void> {
      if (!running) running = sendAll()
      return running.then(() => saving)
    }

    return {
      tasks: {},
      status: 'idle',
      error: null,
      pending: 0,
      failed: [],
      live: false,

      async load() {
        const mine = ++loads
        if (get().status !== 'ready') set({ status: 'loading', error: null })
        try {
          await restored
          const rows = await gateway.loadInitial(now())
          if (mine !== loads) return
          const next = new Map<string, Task>()
          for (const row of rows) {
            const known = server.get(row.id)
            next.set(row.id, known && newer(known, row) ? known : row)
          }
          // A task with a change waiting stays, even if the server no longer lists it.
          for (const entry of entries) {
            const known = server.get(entry.id)
            if (known && !next.has(entry.id)) next.set(entry.id, known)
          }
          server = next
          for (const id of [...local.keys()]) if (server.has(id)) local.delete(id)
          set({ status: 'ready', error: null })
          publishAll()
        } catch (err) {
          if (mine !== loads) return
          const error = toHebrewLoadError(err)
          // What is on the screen stays there; only a first load that fails is an error screen.
          set(get().status === 'ready' ? { error } : { status: 'error', error })
        }
      },

      create(task) {
        const onServer = server.has(task.id)
        if (!onServer) local.set(task.id, task)
        queue(task.id, taskToPatch(task), !onServer)
      },

      update(id, patch) {
        const clean = cleanPatch(patch)
        if (Object.keys(clean).length === 0) return
        const known = server.has(id) || local.has(id) || entries.some((e) => e.id === id && e.isNew)
        if (!known) return
        queue(id, clean, false)
      },

      markDone(id, done) {
        get().update(id, { done_at: done ? now().toISOString() : null })
      },

      softDelete(id, deleted) {
        get().update(id, { deleted_at: deleted ? now().toISOString() : null })
      },

      flush,

      retryFailed() {
        let any = false
        for (const entry of entries) {
          if (entry.failure) {
            delete entry.failure
            any = true
          }
        }
        if (!any) return
        persist()
        set(counts())
        void flush()
      },

      discardFailed(id) {
        const entry = entries.find((e) => e.id === id && e.failure)
        if (!entry) return
        entries = entries.filter((e) => e !== entry)
        if (entry.isNew) local.delete(id)
        persist()
        publish([id])
      },

      applyRemote(task) {
        const known = server.get(task.id)
        if (!known && !isWholeRow(task)) {
          // A change of a task that is not here, and without some of its columns (a long text that the change
          // did not touch): half a row is not kept, the tasks are read again, and the task comes whole if it belongs.
          rereadTimer ??= setTimeout(() => {
            rereadTimer = null
            void get().load()
          }, REREAD_DELAY_MS)
          return
        }
        // What the row leaves out is what did not change: it stays as it was.
        acceptRow(known ? { ...known, ...task } : task)
        publish([task.id])
      },

      async search(query) {
        const text = normalizeQuery(query)
        if (!text) return []
        const rows = await gateway.search(text)
        for (const row of rows) acceptRow(row)
        publish(rows.map((row) => row.id))
        return rows.flatMap((row) => view(row.id) ?? [])
      },

      start() {
        if (unsubscribe) return
        wasDown = false
        unsubscribe = gateway.subscribe(
          (event) => get().applyRemote(event.task),
          (live) => {
            set({ live })
            if (!live) {
              wasDown = true
            } else if (wasDown) {
              // The connection was lost and is back: what was missed in between has to be read again.
              wasDown = false
              void get().load()
            }
          },
        )
        if (typeof window !== 'undefined') {
          const onOnline = () => void flush()
          const onVisible = () => {
            if (document.visibilityState === 'visible') void flush()
          }
          window.addEventListener('online', onOnline)
          document.addEventListener('visibilitychange', onVisible)
          listeners = [
            [window, 'online', onOnline],
            [document, 'visibilitychange', onVisible],
          ]
        }
        timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
        // What an earlier run left waiting goes out now.
        void flush()
      },

      stop() {
        unsubscribe?.()
        unsubscribe = null
        if (timer !== null) clearInterval(timer)
        timer = null
        if (rereadTimer !== null) clearTimeout(rereadTimer)
        rereadTimer = null
        for (const [target, type, handler] of listeners) target.removeEventListener(type, handler)
        listeners = []
        wasDown = false
        if (get().live) set({ live: false })
      },
    }
  })
}
