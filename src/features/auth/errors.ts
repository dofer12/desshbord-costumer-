export const AUTH_MESSAGES = {
  invalidCredentials: 'האימייל או הסיסמה שגויים.',
  banned: 'המשתמש הושבת. פנו למנהל המערכת.',
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
  if (e.code === 'over_request_rate_limit' || e.status === 429) return AUTH_MESSAGES.rateLimited
  if (isNetworkError(e)) return AUTH_MESSAGES.offline
  return AUTH_MESSAGES.generic
}
