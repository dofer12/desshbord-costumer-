import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const URL_OK = 'https://abcdefgh.supabase.co'
const KEY_OK = 'sb_publishable_AbCdEf1234567890'

/** Builds an unsigned JWT-shaped string, as the legacy Supabase keys are. */
function legacyKey(role: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.signature`
}

describe('loadConfig', () => {
  it('returns the url and the publishable key', () => {
    expect(loadConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toEqual({
      supabaseUrl: URL_OK,
      supabasePublishableKey: KEY_OK,
    })
  })

  it('trims whitespace and reduces the url to its origin', () => {
    const cfg = loadConfig({
      VITE_SUPABASE_URL: `  ${URL_OK}/rest/v1/  `,
      VITE_SUPABASE_PUBLISHABLE_KEY: `\n${KEY_OK} `,
    })
    expect(cfg).toEqual({ supabaseUrl: URL_OK, supabasePublishableKey: KEY_OK })
  })

  it('explains what is missing when either value is absent or blank', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    expect(() => loadConfig({ VITE_SUPABASE_URL: URL_OK })).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
    expect(() => loadConfig({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(
      /VITE_SUPABASE_URL/,
    )
  })

  it('rejects a url that is not valid', () => {
    expect(() => loadConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK })).toThrow(
      ConfigError,
    )
  })

  it('refuses to talk to the server over plain http', () => {
    expect(() =>
      loadConfig({ VITE_SUPABASE_URL: 'http://abcdefgh.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY_OK }),
    ).toThrow(/https/)
  })
})

describe('loadConfig and secret keys', () => {
  const withKey = (key: string) => () => loadConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: key })

  it('refuses a secret key, because this app and its repository are public', () => {
    expect(withKey('sb_secret_AbCdEf1234567890')).toThrow(/סודי/)
  })

  it('refuses a legacy service_role key', () => {
    expect(withKey(legacyKey('service_role'))).toThrow(/סודי/)
  })

  it('never echoes the rejected key in the message', () => {
    const secret = 'sb_secret_ShouldNeverAppearAnywhere'
    try {
      withKey(secret)()
      expect.unreachable('loadConfig should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain(secret)
    }
  })

  it('accepts a legacy anon key while those are still valid', () => {
    expect(withKey(legacyKey('anon'))().supabasePublishableKey).toBe(legacyKey('anon'))
  })

  it('does not choke on a dotted value that is not a JWT', () => {
    expect(withKey('a.b.c')().supabasePublishableKey).toBe('a.b.c')
  })
})
