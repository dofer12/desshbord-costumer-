import { createStore, type StoreApi } from 'zustand/vanilla'
import { SNOOZE_MS, type Snoozed } from './reminders'

// The snoozes of one person on one device. A snooze is "stay quiet about this task for ten minutes";
// it is kept in the storage of the device so that closing the app does not bring the reminder back at
// once, and it remembers the due time of the task it was made for, so that a task that is moved later
// is not kept quiet by an old snooze.

export const snoozeKey = (userId: string) => `moked.snooze.${userId}`

/**
 * Whether two spellings of a due time are the same moment. The app writes a time as "…:00.000Z", and the
 * server and the live connection give the same moment back as "…:00+00:00"; a snooze must not be lost
 * because of that.
 */
export function sameDue(a: string | null, b: string | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  const x = Date.parse(a)
  return Number.isFinite(x) && x === Date.parse(b)
}

interface Entry {
  until: number
  due: string | null
}

export interface SnoozeState {
  /** Task id to the moment (epoch milliseconds) until which it is quiet. */
  snoozed: Snoozed
}

export interface SnoozeActions {
  /** Quiets the task for ten minutes from now. `dueAt` is its due time as it is now. */
  snooze(taskId: string, dueAt: string | null): void
  clear(taskId: string): void
  /** Forgets the snoozes that are over. */
  prune(): void
  /** The due time that the task had when it was snoozed, or null. */
  dueOf(taskId: string): string | null
}

export type SnoozeStore = StoreApi<SnoozeState & SnoozeActions>

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false
  const { until, due } = value as Record<string, unknown>
  return typeof until === 'number' && Number.isFinite(until) && (due === null || typeof due === 'string')
}

/** What the storage holds for the person, without what is over, or nothing when it cannot be read. */
function load(storage: Pick<Storage, 'getItem'> | null, userId: string, now: number): Record<string, Entry> {
  try {
    const raw = storage?.getItem(snoozeKey(userId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => isEntry(entry) && entry.until > now))
  } catch {
    return {}
  }
}

export function createSnoozeStore(deps: {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  userId: string
  now?: () => number
}): SnoozeStore {
  const now = deps.now ?? (() => Date.now())
  let entries = load(deps.storage, deps.userId, now())

  const view = (): Snoozed => Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, entry.until]))

  return createStore<SnoozeState & SnoozeActions>()((set) => {
    function commit() {
      set({ snoozed: view() })
      try {
        deps.storage?.setItem(snoozeKey(deps.userId), JSON.stringify(entries))
      } catch {
        // A storage that is full or blocked: the snooze is kept in memory for as long as the app runs.
      }
    }

    return {
      snoozed: view(),
      snooze(taskId, dueAt) {
        entries = { ...entries, [taskId]: { until: now() + SNOOZE_MS, due: dueAt } }
        commit()
      },
      clear(taskId) {
        if (!(taskId in entries)) return
        entries = Object.fromEntries(Object.entries(entries).filter(([id]) => id !== taskId))
        commit()
      },
      prune() {
        const kept = Object.fromEntries(Object.entries(entries).filter(([, entry]) => entry.until > now()))
        if (Object.keys(kept).length === Object.keys(entries).length) return
        entries = kept
        commit()
      },
      dueOf: (taskId) => entries[taskId]?.due ?? null,
    }
  })
}
