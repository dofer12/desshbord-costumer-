import type { AuthGateway, Profile } from '../auth/types'
import type { MemoryDirectory } from '../tasks/memoryGateways'

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

/** An error the way the database API gives one: a code and the HTTP status next to the message. */
const refusal = (code: string, status: number, message: string) => Object.assign(new Error(message), { code, status })

/**
 * An AuthGateway with no server behind it, for trying the app out on one computer. Only builds
 * made with `--mode demo` use it. The session lives in memory and starts signed in; after a
 * sign-out, any email and password signs in again. A new password is accepted and not kept.
 *
 * The profile is the one in the directory of the team when the demo build hands that in, so that a name
 * changed here is seen by the screens of the administrator and the other way round; without one, the
 * gateway keeps a profile of its own.
 */
export function createDemoGateway(directory?: MemoryDirectory): AuthGateway {
  let signedIn = true
  const own: Profile[] = [{ ...DEMO_PROFILE }]
  const people = () => directory?.profiles ?? own
  const me = () => people().find((person) => person.id === DEMO_USER_ID)

  return {
    getStoredUserId: async () => (signedIn ? DEMO_PROFILE.id : null),
    signIn: async () => {
      signedIn = true
      return DEMO_PROFILE.id
    },
    signOut: async () => {
      signedIn = false
    },
    fetchProfile: async (userId) => {
      const person = people().find((candidate) => candidate.id === userId)
      return person ? { ...person } : null
    },
    changePassword: async () => {},
    clearMustChangePassword: async () => {
      const mine = me()
      if (!mine?.must_change_password) return
      mine.must_change_password = false
      directory?.changed()
    },
    updateMyProfile: async ({ display_name, default_remind_min }) => {
      const mine = me()
      if (!mine) throw refusal('42501', 403, 'only an active member can change their profile')
      const name = display_name.trim()
      if (name === '') throw refusal('22023', 400, 'the display name cannot be empty')
      if (!Number.isInteger(default_remind_min) || default_remind_min < 0) {
        throw refusal('22023', 400, 'the default reminder cannot be negative or missing')
      }
      // The database keeps the names apart whatever the case of the letters.
      if (people().some((person) => person.id !== mine.id && person.display_name.toLowerCase() === name.toLowerCase())) {
        throw refusal('23505', 409, 'duplicate key value violates unique constraint "profiles_display_name_key"')
      }
      const changed = mine.display_name !== name || mine.default_remind_min !== default_remind_min
      mine.display_name = name
      mine.default_remind_min = default_remind_min
      if (changed) directory?.changed()
      return { ...mine }
    },
    onSessionEnded: () => () => {},
  }
}
