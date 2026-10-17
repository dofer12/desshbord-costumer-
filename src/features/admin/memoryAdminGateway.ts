import { apiError } from '../../lib/apiError'
import type { Profile } from '../auth/types'
import { handleAdminRequest, type AdminDeps, type AdminResult } from '../../../supabase/functions/admin-users/logic'
import type { MemoryDirectory } from '../tasks/memoryGateways'
import type { AdminGateway, UserOutcome } from './gateways'
import { settingRows } from './settingsRules'
import { cleanStatusPatch, newStatusRow } from './statusRules'

// The administrator tools with no server behind them, for the demo and for the tests of the screens. It
// is the rules of the real function (supabase/functions/admin-users/logic.ts) over the profiles of a memory
// directory: what it answers is what the real one answers, because it is the same code, and the services
// under it behave as the database does where the screens can tell the difference (a name is not used twice,
// the last administrator stays). The profiles are those of the directory, which is told when they change,
// as the live connection of the real server tells the app. The statuses are the rows of the directory:
// they are written by whoever is an active administrator, as the policies of the database say, and fail
// as the database API does (an error with `code` and `status`).

const TOKEN = 'memory-token'
/** The ids of the people of a demo and of the tests are not UUIDs: any plain word will do. */
const PLAIN_ID = /^[\w.-]{1,64}$/

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export interface MemoryAdminOptions {
  /** The profiles are the ones of this directory, and it is told when they change. */
  directory: MemoryDirectory
  /** Who is acting: an id, or a function that says it at the moment of each request. Null is nobody: no session. */
  currentUserId: string | null | (() => string | null)
  /** Where the temporary passwords come from. By default the randomness of the platform. */
  randomBytes?: (n: number) => Uint8Array
}

function outcomeOf(result: AdminResult): UserOutcome {
  if (!result.ok) return result.field === undefined ? { ok: false, code: result.code } : { ok: false, code: result.code, field: result.field }
  return { ok: true, user: { ...result.user }, ...(result.temp_password === undefined ? {} : { tempPassword: result.temp_password }) }
}

export function createMemoryAdminGateway(options: MemoryAdminOptions): AdminGateway {
  const { directory } = options
  let made = 0
  const find = (test: (profile: Profile) => boolean) => directory.profiles.find(test)
  const copy = (profile: Profile | undefined): Profile | null => (profile ? { ...profile } : null)
  const actingUserId = () => (typeof options.currentUserId === 'function' ? options.currentUserId() : options.currentUserId)

  /** The policies of the database: nobody signed in is not heard at all, and the statuses and the settings are written by an active administrator only. */
  function requireAdministrator(table: 'statuses' | 'app_settings'): void {
    const id = actingUserId()
    if (id === null) throw apiError({ message: 'JWT expired', code: 'PGRST301' }, 401)
    const me = find((profile) => profile.id === id)
    if (!me || me.role !== 'admin' || !me.is_active) {
      throw apiError({ message: `new row violates row-level security policy for table "${table}"`, code: '42501' }, 403)
    }
  }

  const deps: AdminDeps = {
    identify: async (token) => (token === TOKEN ? actingUserId() : null),
    profile: async (id) => copy(find((p) => p.id === id)),
    profileByName: async (name) => copy(find((p) => same(p.display_name, name))),
    profileByEmail: async (email) => copy(find((p) => same(p.email, email))),
    authCreate: async ({ email, role, display_name }) => {
      if (find((p) => same(p.email, email))) return { error: 'email_taken' }
      let id: string
      do id = `memory-user-${++made}`
      while (find((p) => p.id === id))
      directory.profiles.push({ id, email, display_name, role, is_active: true, must_change_password: true, default_remind_min: 15 })
      return { id }
    },
    authSetPassword: async () => true,
    authBan: async () => true,
    authDelete: async (id) => {
      directory.profiles = directory.profiles.filter((p) => p.id !== id)
    },
    revokeSessions: async () => true,
    updateProfile: async (id, patch) => {
      const found = find((p) => p.id === id)
      if (!found) return { error: 'not_found' }
      if (patch.display_name !== undefined && directory.profiles.some((p) => p.id !== id && same(p.display_name, patch.display_name as string))) {
        return { error: 'name_taken' }
      }
      // The guard of the database: the last active administrator stays.
      const leaves = found.role === 'admin' && found.is_active && (patch.role === 'employee' || patch.is_active === false)
      if (leaves && !directory.profiles.some((p) => p.id !== id && p.role === 'admin' && p.is_active)) return { error: 'last_admin' }
      Object.assign(found, patch)
      return { ...found }
    },
    randomBytes: options.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n))),
    log: () => undefined,
  }

  async function run(body: unknown): Promise<UserOutcome> {
    const before = JSON.stringify(directory.profiles)
    const result = await handleAdminRequest(deps, TOKEN, body, { isUserId: (value) => PLAIN_ID.test(value) })
    // A change of the profiles is heard by whoever listens, once: as the live connection of the real server does it.
    if (JSON.stringify(directory.profiles) !== before) directory.changed()
    return outcomeOf(result)
  }

  return {
    users: {
      create: (input) => run({ action: 'create', ...input }),
      resetPassword: (userId) => run({ action: 'reset_password', user_id: userId }),
      setActive: (userId, isActive) => run({ action: 'set_active', user_id: userId, is_active: isActive }),
      setRole: (userId, role) => run({ action: 'set_role', user_id: userId, role }),
      rename: (userId, displayName) => run({ action: 'rename', user_id: userId, display_name: displayName }),
    },
    statuses: {
      async add(input) {
        requireAdministrator('statuses')
        const row = newStatusRow(input, directory.statuses)
        directory.statuses.push(row)
        directory.changed()
        return { ...row }
      },

      async update(key, patch) {
        const clean = cleanStatusPatch(patch)
        requireAdministrator('statuses')
        const found = directory.statuses.find((status) => status.key === key)
        // What the database API says when one row was asked for and there is none.
        if (!found) throw apiError({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406)
        Object.assign(found, clean)
        directory.changed()
        return { ...found }
      },

      async reorder(keys) {
        requireAdministrator('statuses')
        let changed = false
        for (const [index, key] of keys.entries()) {
          const found = directory.statuses.find((status) => status.key === key)
          if (found && found.sort !== index + 1) {
            found.sort = index + 1
            changed = true
          }
        }
        if (changed) directory.changed()
      },
    },
    settings: {
      async save(patch) {
        const rows = settingRows(patch)
        if (rows.length === 0) return
        requireAdministrator('app_settings')
        // What is kept is a copy: the caller's list is theirs.
        for (const row of rows) Object.assign(directory.settings, { [row.key]: Array.isArray(row.value) ? [...row.value] : row.value })
        directory.changed()
      },
    },
  }
}
