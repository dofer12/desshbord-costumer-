import { describe, expect, it } from 'vitest'
import { isNotSetUp, isRetryable } from './errors'

const failure = (status: number, extra: object = {}) => Object.assign(new Error('failed'), { status, ...extra })

describe('isRetryable', () => {
  it.each([0, 408, 429, 500, 502, 503, 504])('is true for status %i, which may pass', (status) => {
    expect(isRetryable(failure(status))).toBe(true)
  })

  it.each([400, 401, 403, 404, 406, 409, 413, 422])('is false for status %i, which waiting will not change', (status) => {
    expect(isRetryable(failure(status))).toBe(false)
  })

  it('is true when the request never reached the server', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryable(new Error('TypeError: NetworkError when attempting to fetch resource.'))).toBe(true)
  })

  it('is false for something that is not an error with a status', () => {
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
    expect(isRetryable('boom')).toBe(false)
    expect(isRetryable(new Error('Too many tasks to load'))).toBe(false)
  })
})

describe('isNotSetUp', () => {
  it('is true for a missing table or a missing grant', () => {
    expect(isNotSetUp(failure(404, { code: 'PGRST205' }))).toBe(true)
    expect(isNotSetUp(failure(403, { code: '42501' }))).toBe(true)
  })

  it('is false for everything else', () => {
    expect(isNotSetUp(failure(400, { code: '23514' }))).toBe(false)
    expect(isNotSetUp(failure(500))).toBe(false)
    expect(isNotSetUp(failure(0))).toBe(false)
    expect(isNotSetUp(null)).toBe(false)
  })
})
