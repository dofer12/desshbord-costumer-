import { get, set } from 'idb-keyval'
import type { TaskPatch } from './model'

/**
 * A change that has not reached the server yet. There is one entry for each task: a new change of
 * the same task is joined into it, and the last value of a field wins.
 */
export interface OutboxEntry {
  /** The id of the task. It is made once, so that sending the entry again can never make a second task. */
  id: string
  /** The fields that changed, and nothing else. A new task is sent whole. */
  patch: TaskPatch
  queuedAt: number
  /** How many times the sending failed for a reason that may pass. */
  attempts: number
  /** Set when the server refused the change: the entry is put aside, with the reason in words. */
  failure?: string
  /** True until the server has confirmed a task that was created here. */
  isNew?: boolean
}

/** Where the entries are kept between two runs of the app. */
export interface OutboxStorage {
  load(): Promise<OutboxEntry[]>
  /** Replaces the whole list. */
  save(entries: OutboxEntry[]): Promise<void>
}

/** For tests, and for where there is no IndexedDB. */
export function createMemoryOutboxStorage(): OutboxStorage {
  let saved: OutboxEntry[] = []
  return {
    load: async () => structuredClone(saved),
    save: async (entries) => {
      saved = structuredClone(entries)
    },
  }
}

/**
 * The entries in IndexedDB, under one key. The key has to name the user as well: the entries that
 * one person left behind must never be sent in the name of the next person who signs in.
 */
export function createIdbOutboxStorage(key = 'moked-outbox'): OutboxStorage {
  return {
    async load() {
      return (await get<OutboxEntry[]>(key)) ?? []
    },
    async save(entries) {
      await set(key, entries)
    },
  }
}
