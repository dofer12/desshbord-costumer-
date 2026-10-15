import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Profile } from '../auth/types'
import { toHebrewLoadError } from './errors'
import type { DirectoryGateway, Settings, Status } from './gateways'
import { DEFAULT_SHIP_METHODS } from './model'

export interface DirectoryState {
  statuses: Status[]
  profiles: Profile[]
  settings: Settings
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}

export interface DirectoryActions {
  load(): Promise<void>
  /** Loads again whenever a status, a setting or a profile changes anywhere. */
  start(): void
  stop(): void
}

export type DirectoryStore = StoreApi<DirectoryState & DirectoryActions>

/** The statuses, the people and the settings that the screens of the tasks need. */
export function createDirectoryStore(gateway: DirectoryGateway): DirectoryStore {
  let unsubscribe: (() => void) | null = null
  /** Numbers the loads, so that the late answer of an old one cannot overwrite a newer one. */
  let loads = 0

  return createStore<DirectoryState & DirectoryActions>()((set, get) => ({
    statuses: [],
    profiles: [],
    settings: { glassix_url_template: '', ship_methods: [...DEFAULT_SHIP_METHODS], last_backup_at: null },
    status: 'idle',
    error: null,

    async load() {
      const mine = ++loads
      if (get().status !== 'ready') set({ status: 'loading', error: null })
      try {
        const { statuses, profiles, settings } = await gateway.load()
        if (mine !== loads) return
        set({
          statuses: [...statuses].sort((a, b) => a.sort - b.sort),
          profiles,
          settings,
          status: 'ready',
          error: null,
        })
      } catch (err) {
        if (mine !== loads) return
        const error = toHebrewLoadError(err)
        // What is already on the screen stays there; only a first load that fails is an error screen.
        set(get().status === 'ready' ? { error } : { status: 'error', error })
      }
    },

    start() {
      if (unsubscribe) return
      unsubscribe = gateway.subscribe(() => {
        void get().load()
      })
    },

    stop() {
      unsubscribe?.()
      unsubscribe = null
    },
  }))
}
