import { createStore, type StoreApi } from 'zustand/vanilla'
import { normalizeEmail } from './credentials'
import {
  AUTH_MESSAGES,
  classifyPasswordFailure,
  classifyProfileFailure,
  isNetworkError,
  PASSWORD_MESSAGES,
  PROFILE_MESSAGES,
  toHebrewAuthError,
  toPasswordMessage,
  toProfileMessage,
} from './errors'
import type { AuthGateway, Profile, ProfileInput } from './types'

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
  /**
   * Sets a password that the person chose and, when they were asked to choose one, says so to the server,
   * so that the app opens. Resolves with null when it worked, and otherwise with a sentence for the person,
   * with nothing changed. A second call while the first is on its way gets the answer of the first.
   */
  changePassword(password: string): Promise<string | null>
  /** Saves the name and the default reminder. Resolves with null when it worked, and otherwise with a sentence for the person. */
  saveProfile(input: ProfileInput): Promise<string | null>
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
  /**
   * The session in which the server said yes to a new password while the profile still asks for one. If the
   * word about it did not get through, the second try with the same text is answered "the same", and
   * only after a yes of ours does that mean that the work is half done and can go on.
   */
  let passwordSetIn = -1
  /** The change of a password that is on its way, if any. */
  let changing: Promise<string | null> | null = null

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

    async function setPassword(password: string): Promise<string | null> {
      const { status, profile } = get()
      if (status !== 'signedIn' || !profile) return PASSWORD_MESSAGES.session
      const session = sessions
      const asked = profile.must_change_password
      try {
        await gateway.changePassword(password)
        if (asked) passwordSetIn = session
      } catch (err) {
        // The server answers "the same" to a password that it already has. After a yes of ours that is the
        // second try with the same text; with none it is the temporary password typed again, and is refused.
        const finishing = asked && passwordSetIn === session && classifyPasswordFailure(err) === 'same_password'
        if (!finishing) return toPasswordMessage(err)
      }
      // A person who signed out meanwhile has no session to say it in; they will be asked again at the next sign-in.
      if (!asked || session !== sessions) return null
      try {
        await gateway.clearMustChangePassword()
      } catch {
        return PASSWORD_MESSAGES.incomplete
      }
      if (session !== sessions) return null
      passwordSetIn = -1
      const current = get().profile
      if (current) set({ profile: { ...current, must_change_password: false } })
      return null
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

      changePassword(password) {
        if (changing) return changing
        const run: Promise<string | null> = setPassword(password).finally(() => {
          if (changing === run) changing = null
        })
        changing = run
        return run
      },

      async saveProfile(input) {
        if (get().status !== 'signedIn') return PROFILE_MESSAGES.session
        const session = sessions
        try {
          const profile = await gateway.updateMyProfile(input)
          if (session === sessions && get().status === 'signedIn') set({ profile })
          return null
        } catch (err) {
          return toProfileMessage(err)
        }
      },

      dispose() {
        unsubscribe?.()
        unsubscribe = null
      },
    }
  })
}
