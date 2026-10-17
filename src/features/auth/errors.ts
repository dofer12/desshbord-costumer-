export const AUTH_MESSAGES = {
  invalidCredentials: 'האימייל או הסיסמה שגויים.',
  banned: 'המשתמש הושבת. פנו למנהל המערכת.',
  emailNotConfirmed: 'האימייל של המשתמש טרם אושר. פנו למנהל המערכת.',
  rateLimited: 'בוצעו יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.',
  offline: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.',
  notMember: 'המשתמש אינו פעיל או שלא הוגדר במערכת. פנו למנהל המערכת.',
  sessionEnded: 'ההפעלה הסתיימה. התחברו מחדש.',
  generic: 'לא הצלחנו להתחבר. נסו שוב.',
} as const

interface ErrorLike {
  code?: string
  name?: string
  status?: number
  message?: string
}

function asErrorLike(err: unknown): ErrorLike | null {
  return err && typeof err === 'object' ? (err as ErrorLike) : null
}

const NETWORK_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

/** True when the request never reached the server (offline, DNS, server down). */
export function isNetworkError(err: unknown): boolean {
  const e = asErrorLike(err)
  if (!e) return false
  if (e.name === 'AuthRetryableFetchError') return true
  return NETWORK_MESSAGE.test(String(e.message ?? ''))
}

/** A message that is safe to show on the login screen. Raw backend text is never shown. */
export function toHebrewAuthError(err: unknown): string {
  const e = asErrorLike(err)
  if (!e) return AUTH_MESSAGES.generic
  const message = String(e.message ?? '')
  if (e.code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return AUTH_MESSAGES.invalidCredentials
  }
  if (e.code === 'user_banned' || /\bbanned\b/i.test(message)) return AUTH_MESSAGES.banned
  if (e.code === 'email_not_confirmed') return AUTH_MESSAGES.emailNotConfirmed
  if (e.code === 'over_request_rate_limit' || e.status === 429) return AUTH_MESSAGES.rateLimited
  if (isNetworkError(e)) return AUTH_MESSAGES.offline
  return AUTH_MESSAGES.generic
}

/** The request got no usable answer: there is no connection, it took too long, or the server is in trouble. */
export function gotNoAnswer(e: ErrorLike): boolean {
  const status = typeof e.status === 'number' ? e.status : null
  return isNetworkError(e) || status === 0 || status === 408 || (status !== null && status >= 500)
}

export type ProfileFailure = 'unreachable' | 'sessionInvalid' | 'notSetUp' | 'failed'

/**
 * What a failed request for the signed-in user's own profile means. Only a clear "no" from the
 * server may end the session: a server that is down, slow or overloaded must not sign anyone out.
 */
export function classifyProfileFailure(err: unknown): ProfileFailure {
  const e = asErrorLike(err)
  if (!e) return 'failed'
  const status = typeof e.status === 'number' ? e.status : null
  if (gotNoAnswer(e) || status === 429) return 'unreachable'
  if (status === 401) return 'sessionInvalid'
  // A missing table or grant (the setup SQL was not run) answers 404 or 403: the user is not set up.
  if (status === 403 || status === 404) return 'notSetUp'
  return 'failed'
}

const SESSION_OVER = 'ההפעלה הסתיימה. התנתקו והתחברו מחדש.'
const NO_SERVER = 'לא הצלחנו להגיע לשרת. בדקו את האינטרנט ונסו שוב.'

/** What a person is told when the password they chose could not be set. Never the text of the error. */
export const PASSWORD_MESSAGES = {
  same_password: 'הסיסמה החדשה זהה לסיסמה הנוכחית. בחרו סיסמה אחרת.',
  weak_password: 'הסיסמה אינה מתאימה: היא קצרה או קלה לניחוש. בחרו סיסמה אחרת, של 10 תווים לפחות.',
  session: SESSION_OVER,
  network: NO_SERVER,
  incomplete: 'הסיסמה הוחלפה, אבל לא הצלחנו לסיים את ההגדרה. לחצו שוב על הכפתור.',
  generic: 'לא הצלחנו להחליף את הסיסמה. נסו שוב.',
} as const

/** What a person is told when their profile could not be saved. Never the text of the error. */
export const PROFILE_MESSAGES = {
  name_taken: 'השם הזה כבר תפוס. בחרו שם אחר.',
  invalid: 'השם או התזכורת אינם תקינים. בדקו ונסו שוב.',
  session: SESSION_OVER,
  network: NO_SERVER,
  generic: 'לא הצלחנו לשמור. נסו שוב.',
} as const

export type PasswordFailure = keyof typeof PASSWORD_MESSAGES
export type ProfileSaveFailure = keyof typeof PROFILE_MESSAGES

const SESSION_CODES = new Set([
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'no_authorization',
  'user_not_found',
  'user_banned',
  // The database API: a token that expired, and a person who is no longer an active member.
  'PGRST301',
  '42501',
])

/** The session behind a request is gone, or is no longer allowed to do what was asked. */
function sessionRefused(e: ErrorLike): boolean {
  if (e.name === 'AuthSessionMissingError') return true
  if (e.code !== undefined && SESSION_CODES.has(e.code)) return true
  return e.status === 401 || e.status === 403
}

/** Which of the cases of PASSWORD_MESSAGES a failed attempt to set a password is. */
export function classifyPasswordFailure(err: unknown): Exclude<PasswordFailure, 'incomplete'> {
  const e = asErrorLike(err)
  if (!e) return 'generic'
  if (e.code === 'same_password' || /different from the old password/i.test(String(e.message ?? ''))) return 'same_password'
  if (e.code === 'weak_password' || e.name === 'AuthWeakPasswordError') return 'weak_password'
  if (sessionRefused(e)) return 'session'
  if (gotNoAnswer(e)) return 'network'
  return 'generic'
}

export function toPasswordMessage(err: unknown): string {
  return PASSWORD_MESSAGES[classifyPasswordFailure(err)]
}

/** Which of the cases of PROFILE_MESSAGES a failed attempt to save the profile is. */
export function classifyProfileSaveFailure(err: unknown): ProfileSaveFailure {
  const e = asErrorLike(err)
  if (!e) return 'generic'
  // The unique index on the names of the people, whatever the case of the letters.
  if (e.code === '23505' && /profiles_display_name_key/.test(String(e.message ?? ''))) return 'name_taken'
  // The function refuses an empty name and a reminder that is not a number of minutes.
  if (e.code === '22023') return 'invalid'
  if (sessionRefused(e)) return 'session'
  if (gotNoAnswer(e)) return 'network'
  return 'generic'
}

export function toProfileMessage(err: unknown): string {
  return PROFILE_MESSAGES[classifyProfileSaveFailure(err)]
}
