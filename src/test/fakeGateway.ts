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
  /** Simulates the backend ending the session (revoked token, removed user). */
  endSessionFromServer(): void
}

/** A gateway whose defaults are: no stored session, sign-in as DANA succeeds. Override per test. */
export function createFakeGateway(): FakeGateway {
  let listener: (() => void) | null = null

  const getStoredUserId = vi.fn<AuthGateway['getStoredUserId']>().mockResolvedValue(null)
  const signIn = vi.fn<AuthGateway['signIn']>().mockResolvedValue(DANA.id)
  const signOut = vi.fn<AuthGateway['signOut']>().mockResolvedValue(undefined)
  const fetchProfile = vi.fn<AuthGateway['fetchProfile']>().mockResolvedValue(DANA)

  const gateway: AuthGateway = {
    getStoredUserId,
    signIn,
    signOut,
    fetchProfile,
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
    endSessionFromServer: () => listener?.(),
  }
}
