import { createStore, type StoreApi } from 'zustand/vanilla'
import { normalizeEmail } from './credentials'
import { AUTH_MESSAGES, classifyProfileFailure, isNetworkError, toHebrewAuthError } from './errors'
import type { AuthGateway, Profile } from './types'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unreachable'

/**
 * How long start-up waits for the server before it offers a retry. An expired token that cannot
 * be renewed offline would otherwise keep "loading" on screen for about 25 seconds. The slow
 * answer is not discarded: if it arrives, the user simply lands in the app.
 */
export const SLOW_START_MS = 5000

export interface AuthState {
  status: AuthStatus
  profile: Profile | null
  /** Message for the login screen (failed sign-in, ended session). */
  error: string | null
  /** True while a sign-in request is in flight. */
  busy: boolean
}

export interface AuthActions {
  /** Restores a stored session, if any. Call once at start-up. */
  init(): Promise<void>
  /** Resolves true when the user ended up signed in. */
  signIn(email: string, password: string): Promise<boolean>
  signOut(): Promise<void>
  /** Re-runs start-up after the server was unreachable. */
  retry(): Promise<void>
  /**
   * Looks at the profile of the signed-in user again. A user who was deactivated, or whose profile
   * is gone, is signed out with an explanation; a server that cannot be reached changes nothing.
   */
  recheck(): Promise<void>
  /** Stops listening to the backend. */
  dispose(): void
}

export type AuthStore = StoreApi<AuthState & AuthActions>

export function createAuthStore(gateway: AuthGateway): AuthStore {
  let unsubscribe: (() => void) | null = null
  /** Numbers the start-ups, so the late answer of an abandoned one cannot overwrite a newer state. */
  let startups = 0
  /** Numbers the sessions, so that the late answer of a re-check cannot touch a later one. */
  let sessions = 0

  return createStore<AuthState & AuthActions>()((set, get) => {
    /** Drops the local session first, so a late "signed out" event is recognised as our own. */
    async function endSession(message: string | null) {
      sessions++
      set({ status: 'signedOut', profile: null, error: message })
      try {
        await gateway.signOut()
      } catch {
        // The local state is already signed out; there is nothing else to undo.
      }
    }

    /**
     * Loads the caller's profile and settles the status. Resolves true when signed in.
     * Does nothing once `isCurrent` says a newer start-up has taken over.
     */
    async function enter(userId: string, isCurrent: () => boolean = () => true): Promise<boolean> {
      try {
        const profile = await gateway.fetchProfile(userId)
        if (!isCurrent()) return false
        if (!profile || !profile.is_active) {
          await endSession(AUTH_MESSAGES.notMember)
          return false
        }
        sessions++
        set({ status: 'signedIn', profile, error: null })
        return true
      } catch (err) {
        if (!isCurrent()) return false
        switch (classifyProfileFailure(err)) {
          case 'unreachable':
            // Offline, or a bad moment on the server: keep the stored session and let the user retry.
            set({ status: 'unreachable', profile: null })
            return false
          case 'sessionInvalid':
            await endSession(AUTH_MESSAGES.sessionEnded)
            return false
          case 'notSetUp':
            await endSession(AUTH_MESSAGES.notMember)
            return false
          default:
            await endSession(AUTH_MESSAGES.generic)
            return false
        }
      }
    }

    return {
      status: 'loading',
      profile: null,
      error: null,
      busy: false,

      async init() {
        const startup = ++startups
        const isCurrent = () => startup === startups
        unsubscribe?.()
        unsubscribe = gateway.onSessionEnded(() => {
          if (get().status === 'signedIn') {
            set({ status: 'signedOut', profile: null, error: AUTH_MESSAGES.sessionEnded })
          }
        })
        const watchdog = setTimeout(() => {
          if (isCurrent() && get().status === 'loading') set({ status: 'unreachable', profile: null })
        }, SLOW_START_MS)
        try {
          const userId = await gateway.getStoredUserId()
          if (!isCurrent()) return
          if (!userId) {
            set({ status: 'signedOut', profile: null })
            return
          }
          await enter(userId, isCurrent)
        } catch (err) {
          if (!isCurrent()) return
          set({ status: isNetworkError(err) ? 'unreachable' : 'signedOut', profile: null })
        } finally {
          clearTimeout(watchdog)
        }
      },

      async signIn(email, password) {
        if (get().busy) return false
        set({ busy: true, error: null })
        try {
          const userId = await gateway.signIn(normalizeEmail(email), password)
          return await enter(userId)
        } catch (err) {
          set({ error: toHebrewAuthError(err) })
          return false
        } finally {
          set({ busy: false })
        }
      },

      async signOut() {
        await endSession(null)
      },

      async retry() {
        set({ status: 'loading' })
        await get().init()
      },

      async recheck() {
        const { status, profile: current } = get()
        if (status !== 'signedIn' || !current) return
        const session = sessions
        try {
          const profile = await gateway.fetchProfile(current.id)
          if (session !== sessions) return
          if (!profile || !profile.is_active) {
            await endSession(AUTH_MESSAGES.notMember)
            return
          }
          set({ profile })
        } catch (err) {
          if (session !== sessions) return
          // Only a clear "no" from the server ends the session. Trouble in reaching it, or a failure
          // that nobody can classify, changes nothing: the check is made again at the next moment.
          switch (classifyProfileFailure(err)) {
            case 'sessionInvalid':
              await endSession(AUTH_MESSAGES.sessionEnded)
              break
            case 'notSetUp':
              await endSession(AUTH_MESSAGES.notMember)
              break
            default:
              break
          }
        }
      },

      dispose() {
        unsubscribe?.()
        unsubscribe = null
      },
    }
  })
}
