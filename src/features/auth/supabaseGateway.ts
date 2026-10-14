import type { SupabaseClient } from '@supabase/supabase-js'
import { isNetworkError } from './errors'
import type { AuthGateway, Profile } from './types'

const PROFILE_COLUMNS = 'id, email, display_name, role, is_active, must_change_password'

/** Adapts supabase-js to the small interface the auth store depends on. */
export function createSupabaseGateway(client: SupabaseClient): AuthGateway {
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

    async fetchProfile(userId) {
      const { data, error, status } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        // The library would keep retrying a failed request for several seconds. The store has its
        // own answer to an unreachable server (a retry screen), so it must hear about it at once.
        .retry(false)
        .maybeSingle()
      // The HTTP status travels with the error: it tells "server trouble" from "not allowed".
      if (error) throw Object.assign(new Error(error.message), { code: error.code, status })
      return (data as Profile | null) ?? null
    },

    onSessionEnded(callback) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') callback()
      })
      return () => data.subscription.unsubscribe()
    },
  }
}
