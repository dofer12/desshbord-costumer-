import { classifyProfileFailure, isNetworkError } from '../auth/errors'

/**
 * True when a request failed for a reason that may pass: no connection, a slow or overloaded
 * server (status 0, 408, 429 or 5xx). A change that failed like this stays in the queue and is sent
 * again. Any other refusal (a rule of the database, no permission, an expired login) will not pass
 * by waiting.
 */
export function isRetryable(err: unknown): boolean {
  return classifyProfileFailure(err) === 'unreachable'
}

/**
 * True when the request did not get to the server, or no answer came back (status 0): whatever else is
 * waiting to be sent would fail the same way, so there is no use in trying it now.
 */
export function isConnectionLost(err: unknown): boolean {
  const status = err && typeof err === 'object' ? (err as { status?: unknown }).status : undefined
  return isNetworkError(err) || status === 0
}

/** What a request that was given up on looks like: like one that could not reach the server. */
export function noAnswerInTime(): Error {
  return Object.assign(new Error('The server did not answer in time.'), { status: 0 })
}

/** True when the tables are missing or not granted, which means that the setup SQL was not run. */
export function isNotSetUp(err: unknown): boolean {
  return classifyProfileFailure(err) === 'notSetUp'
}

export const SYNC_MESSAGES = {
  notSetUp: 'בסיס הנתונים עדיין לא הוכן לעבודה. פנו למנהל המערכת.',
  unreachable: 'אין חיבור לשרת, או שהשרת לא זמין כרגע. נסו שוב בעוד רגע.',
  loadFailed: 'לא הצלחנו לטעון את הנתונים. נסו שוב.',
  glassixRule: 'חסר מזהה שיחת Glassix, או סימון "אין שיחה ב-Glassix".',
  notAllowed: 'אין הרשאה לשמור את השינוי.',
  rejected: 'השרת סירב לשמור את השינוי.',
} as const

/** A message that is safe to show when loading failed. The text of the server is never shown. */
export function toHebrewLoadError(err: unknown): string {
  if (isNotSetUp(err)) return SYNC_MESSAGES.notSetUp
  if (isRetryable(err)) return SYNC_MESSAGES.unreachable
  return SYNC_MESSAGES.loadFailed
}

/** Why the server refused a change, in words for the person who made it. */
export function toHebrewSaveFailure(err: unknown): string {
  const e = err && typeof err === 'object' ? (err as { code?: string; status?: number; message?: string }) : null
  if (e?.code === '23514' && /tasks_glassix_rule/.test(String(e.message ?? ''))) return SYNC_MESSAGES.glassixRule
  if (e?.status === 401 || e?.status === 403 || e?.code === '42501') return SYNC_MESSAGES.notAllowed
  return SYNC_MESSAGES.rejected
}
