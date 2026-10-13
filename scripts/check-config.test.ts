// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const URL_OK = 'https://abcdefgh.supabase.co'

/** Runs the real script. Values in the environment win over any .env file. */
function runGate(env: Record<string, string>) {
  return spawnSync(process.execPath, ['scripts/check-config.ts'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

describe('check-config', () => {
  it('passes with a public key and names the server', () => {
    const run = runGate({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf123' })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('abcdefgh.supabase.co')
  })

  it('fails the release when the key is a secret key', () => {
    const run = runGate({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_AbCdEf123' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('::error::')
    expect(run.stderr).toContain('סודי')
  })

  it('fails the release when the server settings are missing', () => {
    const run = runGate({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('::error::')
  })
})
