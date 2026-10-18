import type { Profile, Role } from '../auth/types'
import type { Settings, Status } from '../tasks/gateways'
import type { Task } from '../tasks/model'
import type { AdminErrorCode } from '../../../supabase/functions/admin-users/logic'
import type { ImportItem } from './legacyFormat'

// What the screens of the administrator need from outside the app, as plain interfaces: the real thing
// calls the Edge Function admin-users and the tables of the project (supabaseAdminGateway.ts), and the demo
// and the tests use the pretend server of memoryAdminGateway.ts. More of it is added by the tasks that
// follow (settings, the backup, the tasks that were deleted).

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

/** The columns of a status that can be changed. The key never is: tasks keep their status by it. */
export type StatusPatch = Partial<Pick<Status, 'name_he' | 'color' | 'sort' | 'is_active'>>

/** What a new status is made of. The key, the place and the state are not the caller's to say. */
export interface NewStatus {
  name_he: string
  color: string
}

/**
 * The statuses of the tasks, which the administrators change in the tables themselves: the policies of
 * the database let only them. A write that fails throws an error that carries `code` and `status` of the
 * answer of the database API (see writeErrors.ts); a status is never deleted, so there is no way to.
 */
export interface AdminStatusesGateway {
  /** Makes an active status at the end of the list, with a key of its own. Resolves with the row that was made. */
  add(input: NewStatus): Promise<Status>
  /** Changes the columns that are given, and resolves with the status as it is now. */
  update(key: string, patch: StatusPatch): Promise<Status>
  /** Writes the places 1, 2, 3 and so on, in the order of the keys. A key that is not on the list keeps its place. */
  reorder(keys: string[]): Promise<void>
}

/**
 * The settings of the team (the rows of `app_settings`), written by the app itself with the token of the
 * session, as the statuses are: the policies of the database let only an administrator do it. A write that
 * fails throws an error that carries `code` and `status` (see writeErrors.ts).
 */
export interface AdminSettingsGateway {
  /** Writes the settings that are given, one row each, in one request. Nothing is sent for an empty patch. */
  save(patch: Partial<Settings>): Promise<void>
}

/** What an import came to. */
export interface ImportOutcome {
  /** Tasks that were made. */
  added: number
  /** Items that the database had already, by the id of the old app or of the task: they are left as they are. */
  already: number
  /** Items that could not be written, each with what to tell about it. `key` is the old id of the item, or its order number. */
  failed: Array<{ key: string; message: string }>
}

/** The keys that tasks already have, for telling a new task from one that is here. */
export interface ExistingKeys {
  /** The ids that a file may call a task by: the ids of the old app and the ids of the tasks here. */
  legacyIds: Set<string>
  /** The order numbers of the tasks that are not deleted, without a leading "#". */
  orderNumbers: Set<string>
}

/** The tasks that an import reads and writes. */
export interface AdminTasksGateway {
  /** How many tasks there are in the system, done and deleted ones too. */
  count(): Promise<number>
  /**
   * Every task, done and deleted ones too, in pages of 1000 ordered by the time they were made and then by
   * their id; `onPage` hears how many have been read. A page that fails is read once more and then the whole
   * call fails, so that there is never half a list.
   */
  loadAll(onPage: (loaded: number) => void): Promise<Task[]>
  existingKeys(): Promise<ExistingKeys>
  /**
   * Makes the tasks, in chunks of 100 (`onProgress` hears how many are done after each chunk). Whatever the
   * database has already (by the id of the old app) is left as it is, so that a file imported twice, or at the
   * same moment from two places, adds nothing the second time. A chunk that fails is tried once more, and then its
   * items are reported while the next chunks still run. A write that cannot start at all throws.
   */
  importMany(items: ImportItem[], onProgress: (done: number, total: number) => void): Promise<ImportOutcome>
}

export interface AdminGateway {
  users: AdminUsersGateway
  statuses: AdminStatusesGateway
  settings: AdminSettingsGateway
  tasks: AdminTasksGateway
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
