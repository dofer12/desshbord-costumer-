import type { AuthGateway, Profile } from '../auth/types'

export const DEMO_USER_ID = 'demo-user'

/** The only user of the demo: an active admin, so every screen is within reach. */
export const DEMO_PROFILE: Profile = {
  id: DEMO_USER_ID,
  // ".invalid" is reserved: this address can never belong to anyone. Keep it in step with
  // DEMO_MARKER in demoBuild.test.ts, which looks for it in a production bundle.
  email: 'demo@moked.invalid',
  display_name: 'משתמש הדגמה',
  role: 'admin',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
}

/**
 * An AuthGateway with no server behind it, for trying the app out on one computer. Only builds
 * made with `--mode demo` use it. The session lives in memory and starts signed in; after a
 * sign-out, any email and password signs in again.
 */
export function createDemoGateway(): AuthGateway {
  let signedIn = true
  return {
    getStoredUserId: async () => (signedIn ? DEMO_PROFILE.id : null),
    signIn: async () => {
      signedIn = true
      return DEMO_PROFILE.id
    },
    signOut: async () => {
      signedIn = false
    },
    fetchProfile: async () => DEMO_PROFILE,
    onSessionEnded: () => () => {},
  }
}
