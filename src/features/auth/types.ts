export type Role = 'admin' | 'employee'

export interface Profile {
  id: string
  email: string
  display_name: string
  role: Role
  is_active: boolean
  must_change_password: boolean
  /** Minutes before the due time at which a new task of this person reminds them. 0 is at the due time. */
  default_remind_min: number
}

/** Everything the auth store needs from the backend, so tests can fake it. */
export interface AuthGateway {
  /**
   * The user id of the locally stored session, or null when there is none.
   * Rejects with a network error when the stored session has expired and the
   * server cannot be reached to renew it (the session itself is kept).
   */
  getStoredUserId(): Promise<string | null>
  /** Resolves with the user id, or rejects with the backend's error. */
  signIn(email: string, password: string): Promise<string>
  signOut(): Promise<void>
  /** The caller's own profile row, or null when none is visible to them. */
  fetchProfile(userId: string): Promise<Profile | null>
  /** Calls back when the backend ends the session. Returns an unsubscribe function. */
  onSessionEnded(callback: () => void): () => void
}
