export interface AppConfig {
  supabaseUrl: string
  supabasePublishableKey: string
}

/** Raised when the build was made without usable connection settings. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

type EnvLike = Record<string, unknown>

/** True for Supabase secret keys: the "sb_secret_" format and legacy service_role JWTs. */
function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown }
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

/** Reads and validates the Supabase connection settings from Vite's env. */
export function loadConfig(env: EnvLike): AppConfig {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim()
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()

  if (!url) throw new ConfigError('חסרה כתובת השרת (VITE_SUPABASE_URL).')
  if (!key) throw new ConfigError('חסר המפתח הציבורי של השרת (VITE_SUPABASE_PUBLISHABLE_KEY).')
  if (isSecretKey(key)) {
    throw new ConfigError('זה מפתח סודי של Supabase, ואסור להטמיע אותו באפליקציה. השתמשו במפתח הציבורי (Publishable key).')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ConfigError('כתובת השרת אינה תקינה (VITE_SUPABASE_URL).')
  }
  if (parsed.protocol !== 'https:') {
    throw new ConfigError('כתובת השרת חייבת להתחיל ב-https:// (VITE_SUPABASE_URL).')
  }

  return { supabaseUrl: parsed.origin, supabasePublishableKey: key }
}
