import type { Settings } from '../tasks/gateways'
import { fromDueAt } from '../tasks/validation'

/** A backup is due when the last one is this old. */
const DUE_AFTER_MS = 7 * 86_400_000

/** The name of the backup file: "יומן משימות מוקד – גיבוי 2026-10-17.csv", the day being the day in Jerusalem. */
export function backupFileName(now: Date): string {
  return `יומן משימות מוקד – גיבוי ${fromDueAt(now.toISOString()).dueDate}.csv`
}

/**
 * Whether the administrators are to be reminded to make a backup: there is at least one task, and there
 * is no backup, or the last one is seven days old or older. A date that cannot be read is no backup; a
 * last backup in the future (a clock that was wrong) is not old.
 */
export function backupDue(settings: Settings, taskCount: number, now: Date): boolean {
  if (taskCount < 1) return false
  const last = settings.last_backup_at === null ? Number.NaN : Date.parse(settings.last_backup_at)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= DUE_AFTER_MS
}
