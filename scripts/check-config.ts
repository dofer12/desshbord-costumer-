// Fails the release build when `.env` is missing or holds something unusable
// (for example a secret key), so a broken app is never published.
//
// It uses Node alone, because the release workflow runs it right after checkout, before
// `npm ci`. `loadViteEnv` therefore stands in for Vite's `loadEnv`: the tests pin it to
// Vite's behaviour, so the gate sees exactly what the production build will inline.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { loadConfig } from '../src/lib/config.ts'

/** Files a production build reads, from the lowest to the highest priority. */
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local']

/** The VITE_* settings a production build inlines: the env files, overridden by the environment. */
export function loadViteEnv(root: string, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const merged: Record<string, string | undefined> = {}
  for (const name of ENV_FILES) {
    const file = path.join(root, name)
    if (existsSync(file)) Object.assign(merged, parseEnv(readFileSync(file, 'utf8')))
  }
  Object.assign(merged, processEnv)

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (key.startsWith('VITE_') && value !== undefined) env[key] = value
  }
  return env
}

if (import.meta.main) {
  try {
    const config = loadConfig(loadViteEnv(process.cwd()))
    console.log(`Server settings OK: ${new URL(config.supabaseUrl).host}`)
  } catch (err) {
    console.error(`::error::${(err as Error).message}`)
    process.exit(1)
  }
}
