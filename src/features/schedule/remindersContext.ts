import { createContext, useContext } from 'react'
import type { Task } from '../tasks/model'
import type { Permission } from './notifier'
import type { Snoozed } from './reminders'

export const REMINDER_PROBLEM = 'לא הצלחנו לתזמן התראות במכשיר. התזכורות ממשיכות להופיע בתוך האפליקציה.'

/** What the screens get from the provider of the reminders. */
export interface RemindersValue {
  /** The reminders that are on now: the strip. */
  active: Task[]
  /** Task id to the moment until which it is quiet. */
  snoozed: Snoozed
  /** Quiets the reminder of a task for ten minutes. */
  snooze(taskId: string): void
  /** The state of the permission to show notifications, or null while it is being read. */
  permission: Permission | null
  requestPermission(): Promise<void>
  /** Android: whether exact alarms are allowed. Elsewhere, and where the platform cannot say, `unsupported`. */
  exactAlarms: 'granted' | 'denied' | 'unsupported'
  openExactAlarmSettings(): void
  /** Set when the notifications could not be planned on the device, until the next plan succeeds. */
  problem: string | null
}

export const RemindersContext = createContext<RemindersValue | null>(null)

export function useReminders(): RemindersValue {
  const value = useContext(RemindersContext)
  if (!value) throw new Error('useReminders must be used inside <RemindersProvider>')
  return value
}
