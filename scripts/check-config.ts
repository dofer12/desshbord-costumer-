// Fails the release build when `.env` is missing or holds something unusable
// (for example a secret key), so a broken app is never published.
import { loadEnv } from 'vite'
import { loadConfig } from '../src/lib/config.ts'

try {
  const config = loadConfig(loadEnv('production', process.cwd(), 'VITE_'))
  console.log(`Server settings OK: ${new URL(config.supabaseUrl).host}`)
} catch (err) {
  console.error(`::error::${(err as Error).message}`)
  process.exit(1)
}
