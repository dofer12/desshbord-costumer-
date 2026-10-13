import { describe, expect, it } from 'vitest'
import { assertOutsideRepo, makePassword, parseArgs } from './setup-android-signing'

describe('makePassword', () => {
  it('is long, URL-safe and different every time', () => {
    const a = makePassword()
    const b = makePassword()
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(a).not.toBe(b)
  })
})

describe('parseArgs', () => {
  it('has safe defaults', () => {
    expect(parseArgs([])).toEqual({ repo: 'dofer12/desshbord-costumer-', outDir: undefined, dryRun: false })
  })

  it('reads every option', () => {
    expect(parseArgs(['--repo', 'a/b', '--out-dir', 'C:\\keys', '--dry-run'])).toEqual({
      repo: 'a/b',
      outDir: 'C:\\keys',
      dryRun: true,
    })
  })

  it('rejects unknown options and missing values', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/)
    expect(() => parseArgs(['--repo'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--repo', 'not-a-repo'])).toThrow(/owner\/name/)
  })
})

describe('assertOutsideRepo', () => {
  it('refuses a folder inside the repository, where it could be committed', () => {
    expect(() => assertOutsideRepo('/work/repo/keys', '/work/repo')).toThrow(/inside the repository/)
    expect(() => assertOutsideRepo('/work/repo', '/work/repo')).toThrow(/inside the repository/)
  })

  it('accepts a sibling folder whose name merely starts the same', () => {
    expect(() => assertOutsideRepo('/work/repo-secrets', '/work/repo')).not.toThrow()
    expect(() => assertOutsideRepo('/home/me/moked-secrets', '/work/repo')).not.toThrow()
  })
})
