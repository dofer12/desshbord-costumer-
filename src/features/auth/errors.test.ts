import { describe, expect, it } from 'vitest'
import { AUTH_MESSAGES, classifyProfileFailure, isNetworkError, toHebrewAuthError } from './errors'

describe('toHebrewAuthError', () => {
  it('maps wrong credentials by error code', () => {
    expect(toHebrewAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      AUTH_MESSAGES.invalidCredentials,
    )
  })

  it('maps wrong credentials by message when the code is missing', () => {
    expect(toHebrewAuthError({ message: 'Invalid login credentials' })).toBe(AUTH_MESSAGES.invalidCredentials)
  })

  it('maps a deactivated (banned) user', () => {
    expect(toHebrewAuthError({ code: 'user_banned', message: 'User is banned' })).toBe(AUTH_MESSAGES.banned)
  })

  it('maps rate limiting by code and by status', () => {
    expect(toHebrewAuthError({ code: 'over_request_rate_limit' })).toBe(AUTH_MESSAGES.rateLimited)
    expect(toHebrewAuthError({ status: 429 })).toBe(AUTH_MESSAGES.rateLimited)
  })

  it('maps network failures to the offline message', () => {
    expect(toHebrewAuthError({ name: 'AuthRetryableFetchError', message: 'fetch failed' })).toBe(AUTH_MESSAGES.offline)
    expect(toHebrewAuthError(new TypeError('Failed to fetch'))).toBe(AUTH_MESSAGES.offline)
  })

  it('tells the owner when the account was created without confirming its email', () => {
    expect(toHebrewAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toBe(
      AUTH_MESSAGES.emailNotConfirmed,
    )
  })

  it('falls back to a generic message and never leaks raw error text', () => {
    const msg = toHebrewAuthError({ message: 'duplicate key value violates constraint "x_pkey"' })
    expect(msg).toBe(AUTH_MESSAGES.generic)
    expect(toHebrewAuthError(null)).toBe(AUTH_MESSAGES.generic)
    expect(toHebrewAuthError('boom')).toBe(AUTH_MESSAGES.generic)
  })
})

describe('isNetworkError', () => {
  it('recognises the shapes browsers and supabase-js produce', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError' })).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
    expect(isNetworkError({ message: 'Load failed' })).toBe(true)
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true)
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true)
  })

  it('does not mistake ordinary failures for network problems', () => {
    expect(isNetworkError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(false)
    expect(isNetworkError({ message: 'permission denied for table profiles' })).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
  })
})

describe('classifyProfileFailure', () => {
  it('treats a request that never got an answer as an unreachable server', () => {
    expect(classifyProfileFailure(new TypeError('Failed to fetch'))).toBe('unreachable')
    expect(classifyProfileFailure({ message: 'TypeError: Failed to fetch', status: 0 })).toBe('unreachable')
    expect(classifyProfileFailure({ status: 0 })).toBe('unreachable')
  })

  it('treats server trouble as unreachable too, so a bad moment on the server never signs anyone out', () => {
    for (const status of [500, 502, 503, 504, 520, 408, 429]) {
      expect(classifyProfileFailure({ message: 'boom', status }), String(status)).toBe('unreachable')
    }
  })

  it('treats a rejected token as an ended session', () => {
    expect(classifyProfileFailure({ code: 'PGRST301', message: 'JWT expired', status: 401 })).toBe('sessionInvalid')
  })

  it('treats a missing table or a missing grant as "not set up", the same as a missing profile', () => {
    expect(classifyProfileFailure({ code: 'PGRST205', message: "Could not find the table 'public.profiles'", status: 404 })).toBe('notSetUp')
    expect(classifyProfileFailure({ code: '42501', message: 'permission denied for table profiles', status: 403 })).toBe('notSetUp')
  })

  it('keeps every other failure generic', () => {
    expect(classifyProfileFailure({ message: 'bad request', status: 400 })).toBe('failed')
    expect(classifyProfileFailure({ message: 'no status at all' })).toBe('failed')
    expect(classifyProfileFailure(null)).toBe('failed')
    expect(classifyProfileFailure('boom')).toBe('failed')
  })
})
