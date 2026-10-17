import { describe, expect, it } from 'vitest'
import {
  AUTH_MESSAGES,
  classifyPasswordFailure,
  classifyProfileFailure,
  classifyProfileSaveFailure,
  isNetworkError,
  PASSWORD_MESSAGES,
  PROFILE_MESSAGES,
  toHebrewAuthError,
  toPasswordMessage,
  toProfileMessage,
} from './errors'

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

// What a person is told when choosing a password, or saving their profile, goes wrong. The shapes below
// are the ones that supabase-js and the database API really produce (supabaseGateway.contract.test.ts
// checks them against the real client).

const SECRET = 'correct-horse-battery-staple'

/** Every sentence of a map: in Hebrew, ending in a full stop, and each of its own. */
function expectSentences(messages: Record<string, string>) {
  const sentences = Object.values(messages)
  expect(new Set(sentences).size).toBe(sentences.length)
  for (const sentence of sentences) {
    expect(sentence).toMatch(/[א-ת]/)
    expect(sentence.trim()).toBe(sentence)
    expect(sentence).toMatch(/[.]$/)
    // No raw error text, no code, and no English word that could be the password itself.
    expect(sentence).not.toMatch(/[a-z]{3,}/i)
    // Plural imperatives for everybody ("נסו", not "נסה").
    expect(sentence).not.toMatch(/(^|\s)(נסה|בחר|התחבר|התנתק|בדוק|הזן|לחץ)(\s|[.,:]|$)/)
  }
}

describe('what a person is told about a password that could not be set', () => {
  it('has a sentence for each case', () => {
    expect(Object.keys(PASSWORD_MESSAGES).sort()).toEqual(['generic', 'incomplete', 'network', 'same_password', 'session', 'weak_password'])
    expectSentences(PASSWORD_MESSAGES)
  })

  it('tells the person what to do in each case', () => {
    expect(PASSWORD_MESSAGES.same_password).toMatch(/אחרת/)
    expect(PASSWORD_MESSAGES.weak_password).toMatch(/10/)
    expect(PASSWORD_MESSAGES.session).toMatch(/התנתקו/)
    expect(PASSWORD_MESSAGES.session).toMatch(/התחברו/)
    expect(PASSWORD_MESSAGES.network).toMatch(/אינטרנט/)
    expect(PASSWORD_MESSAGES.incomplete).toMatch(/הוחלפה/)
    expect(PASSWORD_MESSAGES.incomplete).toMatch(/שוב/)
  })

  it.each([
    ['the password that the server already has (as it says it)', { name: 'AuthApiError', code: 'same_password', status: 422, message: 'New password should be different from the old password.' }, 'same_password'],
    ['the same password, from a server that sends no code', { status: 422, message: 'New password should be different from the old password.' }, 'same_password'],
    ['a password that is too weak (as supabase-js names the error)', { name: 'AuthWeakPasswordError', status: 422, reasons: ['length'], message: 'Password should be at least 10 characters.' }, 'weak_password'],
    ['a password that is too weak, by its code', { code: 'weak_password', status: 422 }, 'weak_password'],
    ['a session that is not there', { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }, 'session'],
    ['a token that the server rejects', { name: 'AuthApiError', code: 'bad_jwt', status: 401, message: 'invalid JWT' }, 'session'],
    ['a session that the server no longer has', { name: 'AuthApiError', code: 'session_not_found', status: 403 }, 'session'],
    ['a token that expired, for the database API', { code: 'PGRST301', status: 401, message: 'JWT expired' }, 'session'],
    ['a user who is no longer a member', { code: '42501', status: 403, message: 'only an active member can change their profile' }, 'session'],
    ['a user who was blocked', { code: 'user_banned', status: 403 }, 'session'],
    ['a refusal with a status and no code that we know: not allowed', { status: 403 }, 'session'],
    ['a refusal with a status and no code that we know: not signed in', { status: 401 }, 'session'],
    ['a refresh token that the server does not know', { code: 'refresh_token_not_found', status: 400 }, 'session'],
    ['a request that did not get there', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'network'],
    ['a browser that is offline', new TypeError('Failed to fetch'), 'network'],
    ['no status at all, from the database API', { status: 0, message: 'TypeError: Failed to fetch' }, 'network'],
    ['trouble on the server', { status: 503 }, 'network'],
    ['a gateway that timed out', { status: 504 }, 'network'],
    ['a request that took too long', { status: 408 }, 'network'],
    ['too many requests', { code: 'over_request_rate_limit', status: 429 }, 'generic'],
    ['a refusal that nobody foresaw', { code: 'validation_failed', status: 400, message: 'Password cannot be longer than 72 characters' }, 'generic'],
    ['a plain Error', new Error('boom'), 'generic'],
    ['nothing', null, 'generic'],
    ['a string', 'boom', 'generic'],
  ])('reads %s as %s', (_what, error, expected) => {
    expect(classifyPasswordFailure(error)).toBe(expected)
    expect(toPasswordMessage(error)).toBe(PASSWORD_MESSAGES[expected as keyof typeof PASSWORD_MESSAGES])
  })

  it.each([
    'session_not_found',
    'session_expired',
    'refresh_token_not_found',
    'refresh_token_already_used',
    'bad_jwt',
    'no_authorization',
    'user_not_found',
    'user_banned',
    'PGRST301',
    '42501',
  ])('reads the code %s as a session that is over, whatever the status that came with it', (code) => {
    expect(classifyPasswordFailure({ code, status: 400 })).toBe('session')
    expect(classifyProfileSaveFailure({ code, status: 400 })).toBe('session')
  })

  it('never repeats what the error says, so that a password inside an error cannot reach the screen', () => {
    for (const error of [
      { code: 'weak_password', message: `Password ${SECRET} is known to be weak` },
      { code: 'same_password', message: SECRET },
      { status: 401, message: `JWT for ${SECRET} expired` },
      new TypeError(`Failed to fetch ${SECRET}`),
      new Error(SECRET),
      { message: SECRET, reasons: [SECRET] },
    ]) {
      expect(toPasswordMessage(error)).not.toContain(SECRET)
    }
  })
})

describe('what a person is told about a profile that could not be saved', () => {
  it('has a sentence for each case', () => {
    expect(Object.keys(PROFILE_MESSAGES).sort()).toEqual(['generic', 'invalid', 'name_taken', 'network', 'session'])
    expectSentences(PROFILE_MESSAGES)
  })

  it('says it plainly when the name is taken by a colleague', () => {
    expect(PROFILE_MESSAGES.name_taken).toContain('השם הזה כבר תפוס')
  })

  it.each([
    ['a name that a colleague has (the unique index of the names)', { code: '23505', status: 409, message: 'duplicate key value violates unique constraint "profiles_display_name_key"' }, 'name_taken'],
    ['another unique index', { code: '23505', status: 409, message: 'duplicate key value violates unique constraint "profiles_pkey"' }, 'generic'],
    ['a name or a reminder that the database refuses', { code: '22023', status: 400, message: 'the display name cannot be empty' }, 'invalid'],
    ['a token that expired', { code: 'PGRST301', status: 401, message: 'JWT expired' }, 'session'],
    ['a user who is no longer a member', { code: '42501', status: 403, message: 'only an active member can change their profile' }, 'session'],
    ['a session that is not there', { name: 'AuthSessionMissingError', status: 400 }, 'session'],
    ['a request that did not get there', new TypeError('Failed to fetch'), 'network'],
    ['trouble on the server', { status: 502 }, 'network'],
    ['something nobody foresaw', { code: 'XX000', status: 400, message: 'boom' }, 'generic'],
    ['nothing', undefined, 'generic'],
  ])('reads %s as %s', (_what, error, expected) => {
    expect(classifyProfileSaveFailure(error)).toBe(expected)
    expect(toProfileMessage(error)).toBe(PROFILE_MESSAGES[expected as keyof typeof PROFILE_MESSAGES])
  })

  it('never repeats what the error says', () => {
    for (const error of [{ code: '23505', message: `duplicate key value ${SECRET} "profiles_display_name_key"` }, new Error(SECRET), { status: 401, message: SECRET }]) {
      expect(toProfileMessage(error)).not.toContain(SECRET)
    }
  })
})
