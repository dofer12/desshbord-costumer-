// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEnv } from 'vite'
import { loadViteEnv } from './check-config'

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

  it('runs with Node alone, because the release "version" job checks out the code and installs nothing', () => {
    // A fresh checkout holds just the two files the gate needs and no node_modules.
    const checkout = mkdtempSync(path.join(tmpdir(), 'moked-gate-'))
    try {
      mkdirSync(path.join(checkout, 'scripts'))
      mkdirSync(path.join(checkout, 'src', 'lib'), { recursive: true })
      copyFileSync('scripts/check-config.ts', path.join(checkout, 'scripts', 'check-config.ts'))
      copyFileSync('src/lib/config.ts', path.join(checkout, 'src', 'lib', 'config.ts'))
      const run = spawnSync(process.execPath, ['scripts/check-config.ts'], {
        cwd: checkout,
        env: { ...process.env, VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbCdEf123' },
        encoding: 'utf8',
      })
      expect(run.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout).toContain('abcdefgh.supabase.co')
    } finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})

describe('loadViteEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function inTempDir(files: Record<string, string>, check: (dir: string) => void) {
    const dir = mkdtempSync(path.join(tmpdir(), 'moked-env-'))
    try {
      for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body)
      check(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // The gate replaces Vite's own loader so it can run before `npm ci`. It must see exactly
  // what the production build will inline, or it would approve something different.
  it('reads the same files, in the same order, as the production build', () => {
    inTempDir(
      {
        '.env': 'VITE_A=env\nVITE_B=env\nVITE_C=env\nVITE_D=env\nVITE_E=env\nPLAIN=env\n',
        '.env.local': 'VITE_B=local\nVITE_C=local\nVITE_D=local\n',
        '.env.production': 'VITE_C=production\nVITE_D=production\n',
        '.env.production.local': 'VITE_D=production-local\n',
        '.env.development': 'VITE_A=development\n',
      },
      (dir) => {
        vi.stubEnv('VITE_E', 'from-process')
        expect(loadViteEnv(dir)).toEqual(loadEnv('production', dir, 'VITE_'))
        expect(loadViteEnv(dir)).toMatchObject({ VITE_A: 'env', VITE_B: 'local', VITE_C: 'production', VITE_D: 'production-local', VITE_E: 'from-process' })
        expect(loadViteEnv(dir)).not.toHaveProperty('PLAIN')
      },
    )
  })

  it('lets variables set in the environment win over every file', () => {
    inTempDir({ '.env': 'VITE_SUPABASE_URL=https://from-file.supabase.co\n' }, (dir) => {
      expect(loadViteEnv(dir, { VITE_SUPABASE_URL: 'https://from-process.supabase.co' })).toEqual({
        VITE_SUPABASE_URL: 'https://from-process.supabase.co',
      })
    })
  })

  it('parses quotes, comments and the export prefix like Vite does', () => {
    inTempDir(
      {
        '.env': [
          'VITE_Q1="double quoted # not a comment"',
          "VITE_Q2='single quoted'",
          'VITE_C1=plain # trailing comment',
          '# VITE_HIDDEN=1',
          'export VITE_X=exported',
          'VITE_EMPTY=',
          'VITE_URL=https://abc.supabase.co',
          'VITE_EQ=a=b=c',
          '',
        ].join('\n'),
      },
      (dir) => {
        expect(loadViteEnv(dir)).toEqual(loadEnv('production', dir, 'VITE_'))
        expect(loadViteEnv(dir)).toMatchObject({ VITE_C1: 'plain', VITE_X: 'exported', VITE_EQ: 'a=b=c' })
        expect(loadViteEnv(dir)).not.toHaveProperty('VITE_HIDDEN')
      },
    )
  })

  it('is empty when there is no .env file at all', () => {
    inTempDir({}, (dir) => {
      expect(loadViteEnv(dir, {})).toEqual({})
    })
  })
})
