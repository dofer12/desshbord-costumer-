import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

// The repository is public and `.env` is committed. This fails the build if `.env`
// ever holds something that must not ship, such as a secret key.
describe('the committed .env', () => {
  it.skipIf(!import.meta.env.VITE_SUPABASE_URL)('holds a usable, public configuration', () => {
    expect(() => loadConfig(import.meta.env)).not.toThrow()
  })
})
