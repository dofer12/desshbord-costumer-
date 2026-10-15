import { describe, expect, it } from 'vitest'
import { SYNC_MESSAGES, isNotSetUp, isRetryable, toHebrewLoadError, toHebrewSaveFailure } from './errors'

const failure = (status: number, extra: object = {}) => Object.assign(new Error('failed'), { status, ...extra })

describe('toHebrewLoadError', () => {
  it('says that the database is not set up when the table is missing or not granted', () => {
    expect(toHebrewLoadError(failure(404, { code: 'PGRST205' }))).toBe(SYNC_MESSAGES.notSetUp)
    expect(toHebrewLoadError(failure(403, { code: '42501' }))).toBe(SYNC_MESSAGES.notSetUp)
  })

  it('says that the server cannot be reached for a connection or server problem', () => {
    expect(toHebrewLoadError(failure(0))).toBe(SYNC_MESSAGES.unreachable)
    expect(toHebrewLoadError(failure(503))).toBe(SYNC_MESSAGES.unreachable)
    expect(toHebrewLoadError(new TypeError('Failed to fetch'))).toBe(SYNC_MESSAGES.unreachable)
  })

  it('gives a plain message for anything else, never the text of the server', () => {
    const message = toHebrewLoadError(failure(400, { code: '22P02' }))
    expect(message).toBe(SYNC_MESSAGES.loadFailed)
    expect(toHebrewLoadError(null)).toBe(SYNC_MESSAGES.loadFailed)
  })
})

describe('toHebrewSaveFailure', () => {
  it('explains the Glassix rule', () => {
    const error = failure(400, {
      code: '23514',
      message: 'new row for relation "tasks" violates check constraint "tasks_glassix_rule"',
    })
    expect(toHebrewSaveFailure(error)).toBe(SYNC_MESSAGES.glassixRule)
  })

  it('says that there is no permission', () => {
    expect(toHebrewSaveFailure(failure(403, { code: '42501' }))).toBe(SYNC_MESSAGES.notAllowed)
    expect(toHebrewSaveFailure(failure(401))).toBe(SYNC_MESSAGES.notAllowed)
  })

  it('gives a plain message for any other refusal', () => {
    expect(toHebrewSaveFailure(failure(400, { code: '23514', message: 'violates check constraint "tasks_kind_check"' }))).toBe(
      SYNC_MESSAGES.rejected,
    )
    expect(toHebrewSaveFailure(failure(409, { code: '23505' }))).toBe(SYNC_MESSAGES.rejected)
    expect(toHebrewSaveFailure(null)).toBe(SYNC_MESSAGES.rejected)
  })
})

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
