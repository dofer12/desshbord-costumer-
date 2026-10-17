import type { Profile, Role } from '../auth/types'
import type { AdminErrorCode } from '../../../supabase/functions/admin-users/logic'

// What the screens of the administrator need from outside the app, as plain interfaces: the real thing
// calls the Edge Function admin-users and the tables of the project (supabaseAdminGateway.ts), and the demo
// and the tests use the pretend server of memoryAdminGateway.ts. More of it is added by the tasks that
// follow (statuses, settings, the backup, the tasks that were deleted).

export type { AdminErrorCode }

/** What a call about a person can fail with: what the function says, and the two things that it cannot say itself. */
export type UserFailureCode = AdminErrorCode | 'network' | 'not_deployed'

export type UserOutcome =
  /** `tempPassword` comes only with a new person and with a reset, once: it is for the administrator to hand over. */
  | { ok: true; user: Profile; tempPassword?: string }
  /** `field` names what is wrong when the function says so. */
  | { ok: false; code: UserFailureCode; field?: string }

export type UserFailure = Extract<UserOutcome, { ok: false }>

export interface AdminUsersGateway {
  create(input: { email: string; display_name: string; role: Role }): Promise<UserOutcome>
  resetPassword(userId: string): Promise<UserOutcome>
  setActive(userId: string, isActive: boolean): Promise<UserOutcome>
  setRole(userId: string, role: Role): Promise<UserOutcome>
  rename(userId: string, displayName: string): Promise<UserOutcome>
}

export interface AdminGateway {
  users: AdminUsersGateway
}

/** What an administrator is told when a call about a person fails: in the plural of the imperative, with no word of the server. */
export const ADMIN_MESSAGES: Record<UserFailureCode, string> = {
  unauthenticated: 'ההפעלה הסתיימה. התחברו מחדש.',
  forbidden: 'אין לכם הרשאה לבצע את הפעולה הזאת.',
  invalid: 'הפרטים שהוזנו אינם תקינים. בדקו אותם ונסו שוב.',
  email_taken: 'כתובת האימייל הזאת כבר רשומה במערכת.',
  name_taken: 'השם הזה כבר תפוס. בחרו שם אחר.',
  not_found: 'המשתמש לא נמצא. ייתכן שהוא כבר לא קיים: רעננו את הרשימה.',
  last_admin: 'זה המנהל הפעיל האחרון, ולכן אי אפשר לחסום אותו או להפוך אותו לעובד. הגדירו קודם מנהל נוסף.',
  failed: 'הפעולה נכשלה. נסו שוב בעוד רגע.',
  network: 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.',
  not_deployed: 'פונקציית הניהול עדיין לא הותקנה בשרת. פעלו לפי שלב 8 במדריך ההתקנה.',
}

/** When the function says which field is wrong, what is wrong with it. */
const INVALID_BY_FIELD: Record<string, string> = {
  email: 'כתובת האימייל אינה תקינה.',
  display_name: 'השם חייב להכיל בין תו אחד ל-60 תווים, בלי תווי בקרה.',
  role: 'התפקיד שנבחר אינו תקין.',
  // The only way to reach this from the screens: an administrator who is the one that the action is about.
  user_id: 'את הפעולה הזאת אי אפשר לעשות על החשבון שלכם עצמכם. את הסיסמה אפשר לשנות בדף "הפרופיל שלי".',
}

/** The sentence for a failure. What the server wrote is never repeated: only its code, and a field that is on the list. */
export function adminMessage(failure: UserFailure): string {
  if (failure.code === 'invalid' && failure.field !== undefined && Object.hasOwn(INVALID_BY_FIELD, failure.field)) {
    return INVALID_BY_FIELD[failure.field]
  }
  return ADMIN_MESSAGES[failure.code]
}
