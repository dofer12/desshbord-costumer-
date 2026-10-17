import { describe, expect, it } from 'vitest'
import { classifyWriteFailure, toAdminWriteMessage, WRITE_MESSAGES } from './writeErrors'

// What an administrator is told when a change that they made to the data of the team (a status, a setting, a
// task that was deleted) could not be saved: in words that say what happened and, when there is something to
// do, what. The shapes below are the ones that the database API gives (the screens that use this module are
// tried with them, and supabaseStatuses.contract.test.ts with the real client).

const SECRET = 'connection to 10.0.0.5 refused (key sb_secret_abc)'

describe('WRITE_MESSAGES', () => {
  const sentences = Object.values(WRITE_MESSAGES)

  it('has a sentence for each case, in Hebrew, ending in a full stop, each its own', () => {
    expect(Object.keys(WRITE_MESSAGES).sort()).toEqual(['conflict', 'failed', 'forbidden', 'gone', 'invalid', 'network', 'session'])
    expect(new Set(sentences).size).toBe(sentences.length)
    for (const sentence of sentences) {
      expect(sentence).toMatch(/[א-ת]/)
      expect(sentence.trim()).toBe(sentence)
      expect(sentence).toMatch(/[.]$/)
      expect(sentence).not.toMatch(/[a-z]{3,}/i)
      // The plural of the imperative, for everybody.
      expect(sentence).not.toMatch(/(^|\s)(נסה|בדוק|רענן|התחבר|התנתק|בחר)(\s|[.,:]|$)/)
    }
  })

  it('tells what to do where there is something to do', () => {
    expect(WRITE_MESSAGES.network).toMatch(/אינטרנט/)
    expect(WRITE_MESSAGES.session).toMatch(/התחברו/)
    expect(WRITE_MESSAGES.gone).toMatch(/רעננו/)
    expect(WRITE_MESSAGES.failed).toMatch(/נסו שוב/)
  })
})

describe('classifyWriteFailure', () => {
  it.each([
    ['a browser that is offline', new TypeError('Failed to fetch'), 'network'],
    ['no status from the database API', { status: 0, message: 'TypeError: Failed to fetch' }, 'network'],
    ['a server in trouble', { status: 503 }, 'network'],
    ['a gateway that timed out', { status: 504 }, 'network'],
    ['a request that took too long', { status: 408 }, 'network'],
    ['a token that expired', { code: 'PGRST301', status: 401, message: 'JWT expired' }, 'session'],
    ['a refusal by the policies of the database', { code: '42501', status: 403, message: 'new row violates row-level security policy' }, 'forbidden'],
    ['a refusal with a status and no code', { status: 403 }, 'forbidden'],
    ['no row that fits, where one was asked for', { code: 'PGRST116', status: 406, message: 'JSON object requested, multiple (or no) rows returned' }, 'gone'],
    ['a table that is not there', { status: 404, code: 'PGRST205' }, 'gone'],
    ['a key that exists', { code: '23505', status: 409, message: 'duplicate key value violates unique constraint "statuses_pkey"' }, 'conflict'],
    ['a rule of the database that the value breaks', { code: '23514', status: 400 }, 'invalid'],
    ['a value of the wrong kind', { code: '22P02', status: 400 }, 'invalid'],
    ['a missing value', { code: '23502', status: 400 }, 'invalid'],
    ['a request that is not understood', { status: 400, code: 'PGRST102' }, 'invalid'],
    ['a token that expired, as the status alone says it', { status: 401 }, 'session'],
    ['a token that expired, as the code alone says it', { code: 'PGRST301' }, 'session'],
    ['a refusal, as the code alone says it', { code: '42501' }, 'forbidden'],
    ['no row that fits, as the code alone says it', { code: 'PGRST116' }, 'gone'],
    ['no row that fits, as the status alone says it', { status: 406 }, 'gone'],
    ['a table that is not there, as the status alone says it', { status: 404 }, 'gone'],
    ['a key that exists, as the status alone says it', { status: 409 }, 'conflict'],
    ['a key that exists, as the code alone says it', { code: '23505' }, 'conflict'],
    ['a rule of the database, as the code alone says it', { code: '23514' }, 'invalid'],
    ['a value of the wrong kind, as the code alone says it', { code: '22P02' }, 'invalid'],
    ['a code of another class that has 22 in it', { code: 'XX220' }, 'failed'],
    ['a code of the class after those of the values', { code: '24000' }, 'failed'],
    ['too many requests', { status: 429 }, 'failed'],
    ['something nobody foresaw', { code: 'XX000', status: 418 }, 'failed'],
    ['an error with nothing in it', new Error('boom'), 'failed'],
    ['nothing', null, 'failed'],
    ['a string', 'boom', 'failed'],
  ])('reads %s as %s', (_what, error, expected) => {
    expect(classifyWriteFailure(error)).toBe(expected)
    expect(toAdminWriteMessage(error)).toBe(WRITE_MESSAGES[expected as keyof typeof WRITE_MESSAGES])
  })

  it('never repeats what the error says, so that a word of the server or a key cannot reach the screen', () => {
    for (const error of [
      new Error(SECRET),
      { code: '23505', status: 409, message: SECRET },
      { status: 403, message: SECRET },
      { status: 503, message: SECRET },
      new TypeError(`Failed to fetch ${SECRET}`),
      { message: SECRET, details: SECRET, hint: SECRET },
    ]) {
      expect(toAdminWriteMessage(error)).not.toMatch(/10\.0\.0\.5|sb_secret|connection to/)
    }
  })
})
