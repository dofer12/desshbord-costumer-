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
      const { error } = await client.auth.signOut()
      if (error) throw error
    },

    async fetchProfile(userId) {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
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
