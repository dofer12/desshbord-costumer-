import { describe, expect, it } from 'vitest'
import { parseReleaseTag, resolveRelease } from './release-version'

describe('parseReleaseTag', () => {
  it('reads the version and derives an Android versionCode', () => {
    expect(parseReleaseTag('v0.1.0')).toEqual({ version: '0.1.0', androidVersionCode: 1_000 })
    expect(parseReleaseTag('v1.2.3')).toEqual({ version: '1.2.3', androidVersionCode: 1_002_003 })
  })

  it('produces a versionCode that grows with every release', () => {
    const order = ['v0.1.0', 'v0.1.1', 'v0.2.0', 'v0.10.0', 'v1.0.0', 'v1.0.1', 'v2.0.0'].map(
      (t) => parseReleaseTag(t).androidVersionCode,
    )
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(new Set(order).size).toBe(order.length)
  })

  it('rejects anything that is not a plain vMAJOR.MINOR.PATCH tag', () => {
    for (const bad of ['1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-rc1', 'va.b.c', 'v1.2.3 ', '', 'main']) {
      expect(() => parseReleaseTag(bad), bad).toThrow(/not a release tag/)
    }
  })

  it('rejects numbers that would overflow the versionCode scheme', () => {
    expect(() => parseReleaseTag('v1.1000.0')).toThrow(/supported range/)
    expect(() => parseReleaseTag('v1.0.1000')).toThrow(/supported range/)
    expect(() => parseReleaseTag('v2001.0.0')).toThrow(/supported range/)
    expect(parseReleaseTag('v2000.999.999').androidVersionCode).toBeLessThan(2_100_000_000)
  })
})

describe('resolveRelease', () => {
  it('uses package.json when there is no tag (manual builds)', () => {
    expect(resolveRelease(undefined, '0.1.0')).toEqual({ version: '0.1.0', androidVersionCode: 1_000 })
  })

  it('accepts a tag that matches package.json', () => {
    expect(resolveRelease('v0.2.0', '0.2.0').version).toBe('0.2.0')
  })

  it('refuses a tag that does not match package.json, naming both', () => {
    expect(() => resolveRelease('v0.2.0', '0.1.0')).toThrow(/v0\.2\.0.*0\.1\.0/)
  })

  it('refuses a package.json version that is not plain semver', () => {
    expect(() => resolveRelease(undefined, '0.1.0-beta')).toThrow(/not a release tag/)
  })
})
