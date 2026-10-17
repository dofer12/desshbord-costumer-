import { gotNoAnswer } from '../auth/errors'

/** What an administrator is told when a change to the data of the team could not be saved. Never the text of the error. */
export const WRITE_MESSAGES = {
  network: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.',
  session: 'ההפעלה הסתיימה. התנתקו והתחברו מחדש.',
  forbidden: 'אין לכם הרשאה לבצע את הפעולה הזאת.',
  gone: 'הפריט לא נמצא. ייתכן שמנהל אחר שינה אותו: רעננו את הרשימה.',
  conflict: 'כבר יש פריט כזה. נסו שוב.',
  invalid: 'הערך שהוזן אינו מתאים. בדקו אותו ונסו שוב.',
  failed: 'השמירה נכשלה. נסו שוב.',
} as const

export type WriteFailure = keyof typeof WRITE_MESSAGES

interface ErrorLike {
  code?: string
  status?: number
  message?: string
}

/** Which of the cases of WRITE_MESSAGES a failed write is, by what the database API says: the status and the code. */
export function classifyWriteFailure(err: unknown): WriteFailure {
  if (typeof err !== 'object' || err === null) return 'failed'
  const e = err as ErrorLike
  const status = typeof e.status === 'number' ? e.status : null
  // No answer: no connection, a request that took too long, a server in trouble.
  if (gotNoAnswer(e)) return 'network'
  if (status === 401 || e.code === 'PGRST301') return 'session'
  if (status === 403 || e.code === '42501') return 'forbidden'
  // "No rows", asked for one; or a table or a row that is not there.
  if (e.code === 'PGRST116' || status === 404 || status === 406) return 'gone'
  if (e.code === '23505' || status === 409) return 'conflict'
  // A rule of the database that the value breaks, a value of the wrong kind, a request that is not understood.
  if (status === 400 || (typeof e.code === 'string' && /^2[23]/.test(e.code))) return 'invalid'
  return 'failed'
}

export function toAdminWriteMessage(err: unknown): string {
  return WRITE_MESSAGES[classifyWriteFailure(err)]
}
