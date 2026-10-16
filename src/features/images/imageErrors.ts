import { isRetryable, SYNC_MESSAGES } from '../tasks/errors'

export const IMAGE_FAILURES = {
  addFailed: 'שמירת התמונה נכשלה. נסו שוב בעוד רגע.',
  addNotAllowed: 'אין הרשאה להוסיף תמונה.',
  removeFailed: 'מחיקת התמונה נכשלה. נסו שוב בעוד רגע.',
  removeNotAllowed: 'אין הרשאה למחוק את התמונה. מוחק רק מי שהעלה אותה, או מנהל.',
} as const

/** Why a picture could not be added or deleted, in words for the person. The text of the server is never shown. */
export function toHebrewImageFailure(error: unknown, action: 'add' | 'remove'): string {
  if (isRetryable(error)) return SYNC_MESSAGES.unreachable
  const status = error && typeof error === 'object' ? (error as { status?: number }).status : undefined
  if (status === 401 || status === 403) return action === 'add' ? IMAGE_FAILURES.addNotAllowed : IMAGE_FAILURES.removeNotAllowed
  return action === 'add' ? IMAGE_FAILURES.addFailed : IMAGE_FAILURES.removeFailed
}
