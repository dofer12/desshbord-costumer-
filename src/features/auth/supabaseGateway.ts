import type { SupabaseClient } from '@supabase/supabase-js'
import { apiError } from '../../lib/apiError'
import { isNetworkError } from './errors'
import type { AuthGateway, Profile } from './types'

const PROFILE_COLUMNS = 'id, email, display_name, role, is_active, must_change_password, default_remind_min'

/** Adapts supabase-js to the small interface the auth store depends on. */
export function createSupabaseGateway(client: SupabaseClient): AuthGateway {
  async function readProfile(userId: string): Promise<Profile | null> {
    const { data, error, status } = await client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      // The library would keep retrying a failed request for several seconds. The store has its
      // own answer to an unreachable server (a retry screen), so it must hear about it at once.
      .retry(false)
      .maybeSingle()
    // The HTTP status travels with the error: it tells "server trouble" from "not allowed".
    if (error) throw apiError(error, status)
    return (data as Profile | null) ?? null
  }

  return {
    async getStoredUserId() {
      const { data, error } = await client.auth.getSession()
      // An expired token that could not be renewed because we are offline leaves the
      // session in storage. Surface that, so it is not mistaken for "signed out".
      if (error && isNetworkError(error)) throw error
      return data.session?.user.id ?? null
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      return data.user.id
    },

    async signOut() {
      // This device only. The default would also end the user's sessions on every other device.
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
    },

    fetchProfile: readProfile,

    async changePassword(newPassword) {
      const { error } = await client.auth.updateUser({ password: newPassword })
      if (error) throw error
    },

    async clearMustChangePassword() {
      const { error, status } = await client.rpc('clear_must_change_password')
      if (error) throw apiError(error, status)
    },

    async updateMyProfile(input) {
      const { data, error: sessionError } = await client.auth.getSession()
      if (sessionError && isNetworkError(sessionError)) throw sessionError
      const userId = data.session?.user.id
      if (!userId) throw Object.assign(new Error('There is no session.'), { status: 401 })
      const { error, status } = await client.rpc('update_my_profile', {
        p_display_name: input.display_name,
        p_default_remind_min: input.default_remind_min,
      })
      if (error) throw apiError(error, status)
      const profile = await readProfile(userId)
      // The function ran as an active member, so the row is there to be seen; a person who was blocked in between sees nothing.
      if (!profile) throw Object.assign(new Error('The profile cannot be seen.'), { status: 403 })
      return profile
    },

    onSessionEnded(callback) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') callback()
      })
      return () => data.subscription.unsubscribe()
    },
  }
}
