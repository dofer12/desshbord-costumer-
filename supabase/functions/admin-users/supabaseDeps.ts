// The services of the administrator function over the Supabase client: the profiles through the
// database, the users through the admin part of the auth service. The client is made in index.ts with the
// secret key of the project, which only that file reads; here a client is given, so that every call and
// every translation of an error can be tried against a recorder.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminDeps, ProfileRow } from './logic.ts'

const PROFILE_COLUMNS = 'id, email, display_name, role, is_active, must_change_password, default_remind_min'
/** Supabase has no "for ever": this is a ban of about a hundred years, and 'none' lifts it. */
const BAN_FOR_EVER = '876000h'

/** The secret key of the project: the new key that the platform puts in SUPABASE_SECRET_KEYS, else the older service role key. */
export function readSecretKey(get: (name: string) => string | undefined): string {
  const list = get('SUPABASE_SECRET_KEYS')
  if (list) {
    try {
      const key = (JSON.parse(list) as Record<string, unknown>).default
      if (typeof key === 'string' && key !== '') return key
    } catch {
      // A list that cannot be read: the older key is tried.
    }
  }
  const legacy = get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  // No word of what was found: an environment is not something to put in a message.
  throw new Error('The function has no secret key.')
}

export function createSupabaseDeps(admin: SupabaseClient, extras: Pick<AdminDeps, 'randomBytes' | 'log'>): AdminDeps {
  /**
   * Every profile. The team is a few dozen people, and a name or an e-mail is compared here, letter by
   * letter and without regard to case, as the unique index of the names does: a filter of the database
   * would have to guess which characters of a name are wildcards.
   */
  async function allProfiles(): Promise<ProfileRow[]> {
    const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS)
    // A table that cannot be read is an error, never "nobody": the function would make a second user of the same name.
    if (error) throw error
    return (data ?? []) as ProfileRow[]
  }

  return {
    async identify(token) {
      const { data, error } = await admin.auth.getUser(token)
      if (error) {
        // An auth service that is down is not a token that is wrong: it is a failure, so that nobody is told that they are signed out.
        if (error.name === 'AuthRetryableFetchError' || error.status === 0 || (error.status ?? 0) >= 500) throw error
        return null
      }
      return data.user?.id ?? null
    },

    async profile(id) {
      const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
      if (error) throw error
      return (data ?? null) as ProfileRow | null
    },

    async profileByName(name) {
      const wanted = name.toLowerCase()
      return (await allProfiles()).find((p) => p.display_name.toLowerCase() === wanted) ?? null
    },

    async profileByEmail(email) {
      const wanted = email.toLowerCase()
      return (await allProfiles()).find((p) => p.email.toLowerCase() === wanted) ?? null
    },

    async authCreate({ email, password, role, display_name }) {
      // The e-mail is confirmed (the app sends none). The role goes into app_metadata, which only the secret key can write,
      // and the trigger that makes the profile reads it from there; the name goes into user_metadata for the same trigger.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role },
        user_metadata: { display_name },
      })
      if (error || !data.user) {
        const taken =
          error?.code === 'email_exists' || error?.code === 'user_already_exists' || /already (been )?registered/i.test(error?.message ?? '')
        return { error: taken ? 'email_taken' : 'failed' }
      }
      return { id: data.user.id }
    },

    async authSetPassword(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password })
      return !error
    },

    async authBan(id, banned) {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: banned ? BAN_FOR_EVER : 'none' })
      return !error
    },

    async authDelete(id) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) throw error
    },

    async revokeSessions(id) {
      const { error } = await admin.rpc('revoke_user_sessions', { p_user_id: id })
      return !error
    },

    async updateProfile(id, patch) {
      const { data, error } = await admin.from('profiles').update(patch).eq('id', id).select(PROFILE_COLUMNS)
      if (error) {
        // The two rules of the database that the function answers for: the guard of the last administrator (0003) and the unique names (0001).
        if (error.code === '23514' && /profiles_last_admin/.test(error.message)) return { error: 'last_admin' }
        if (error.code === '23505' && /profiles_display_name_key/.test(error.message)) return { error: 'name_taken' }
        return { error: 'failed' }
      }
      const updated = (data as ProfileRow[] | null)?.[0]
      return updated ?? { error: 'not_found' }
    },

    randomBytes: extras.randomBytes,
    log: extras.log,
  }
}
