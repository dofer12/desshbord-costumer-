import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppConfig } from './config'

export function createSupabaseClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Sessions are never delivered through the URL (hash routing owns the fragment).
      detectSessionInUrl: false,
    },
  })
}
