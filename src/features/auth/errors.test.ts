import { describe, expect, it } from 'vitest'
import { AUTH_MESSAGES, isNetworkError, toHebrewAuthError } from './errors'

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
