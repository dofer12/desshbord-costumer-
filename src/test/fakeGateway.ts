import { vi, type Mock } from 'vitest'
import type { AuthGateway, Profile } from '../features/auth/types'

export const DANA: Profile = {
  id: 'u-dana',
  email: 'dana@example.com',
  display_name: 'דנה',
  role: 'employee',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
}

export const OWNER: Profile = {
  id: 'u-owner',
  email: 'owner@example.com',
  display_name: 'הבעלים',
  role: 'admin',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
}

export interface FakeGateway {
  gateway: AuthGateway
  getStoredUserId: Mock<AuthGateway['getStoredUserId']>
  signIn: Mock<AuthGateway['signIn']>
  signOut: Mock<AuthGateway['signOut']>
  fetchProfile: Mock<AuthGateway['fetchProfile']>
  changePassword: Mock<AuthGateway['changePassword']>
  clearMustChangePassword: Mock<AuthGateway['clearMustChangePassword']>
  updateMyProfile: Mock<AuthGateway['updateMyProfile']>
  /** Simulates the backend ending the session (revoked token, removed user). */
  endSessionFromServer(): void
}

/**
 * A gateway whose defaults are: no stored session, sign-in as DANA succeeds, a new password is accepted,
 * and the profile that is saved comes back as it was sent (on top of DANA). Override per test.
 */
export function createFakeGateway(): FakeGateway {
  let listener: (() => void) | null = null

  const getStoredUserId = vi.fn<AuthGateway['getStoredUserId']>().mockResolvedValue(null)
  const signIn = vi.fn<AuthGateway['signIn']>().mockResolvedValue(DANA.id)
  const signOut = vi.fn<AuthGateway['signOut']>().mockResolvedValue(undefined)
  const fetchProfile = vi.fn<AuthGateway['fetchProfile']>().mockResolvedValue(DANA)
  const changePassword = vi.fn<AuthGateway['changePassword']>().mockResolvedValue(undefined)
  const clearMustChangePassword = vi.fn<AuthGateway['clearMustChangePassword']>().mockResolvedValue(undefined)
  const updateMyProfile = vi.fn<AuthGateway['updateMyProfile']>(async (input) => ({ ...DANA, ...input }))

  const gateway: AuthGateway = {
    getStoredUserId,
    signIn,
    signOut,
    fetchProfile,
    changePassword,
    clearMustChangePassword,
    updateMyProfile,
    onSessionEnded(callback) {
      listener = callback
      return () => {
        listener = null
      }
    },
  }

  return {
    gateway,
    getStoredUserId,
    signIn,
    signOut,
    fetchProfile,
    changePassword,
    clearMustChangePassword,
    updateMyProfile,
    endSessionFromServer: () => listener?.(),
  }
}
