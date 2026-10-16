import { formatDue, taskTitle } from '../tasks/display'
import type { Task } from '../tasks/model'

// When a person is reminded of a task, and what the notifications of the next two days are. The
// rules are those of the old app (the strip of reminders and its snooze) with the one change that the
// spec asks for: a reminder is for the person the task is assigned to and for nobody else.

const MINUTE_MS = 60_000

/** How long "snooze" keeps a reminder quiet. */
export const SNOOZE_MS = 10 * MINUTE_MS
/** A reminder is still shown this long after the task was due. */
export const REMINDER_AFTER_DUE_MS = 12 * 60 * MINUTE_MS
/** How far ahead notifications are planned. */
export const PLAN_HORIZON_MS = 48 * 60 * MINUTE_MS
/** The most notifications that are planned at once. */
export const PLAN_MAX = 60

/** Task id to the moment (epoch milliseconds) until which its reminder is quiet. */
export type Snoozed = Record<string, number>

/** The moment a person is to be reminded of a task, or null when the task has no due time or no reminder. */
export function reminderAt(task: Task): Date | null {
  if (task.due_at === null || task.remind_min === null) return null
  return new Date(Date.parse(task.due_at) - task.remind_min * MINUTE_MS)
}

/** Whether the task is one that reminds `meId`: open, not deleted, assigned to them, with a due time and a reminder (zero minutes included). */
export function isReminderTask(task: Task, meId: string): boolean {
  return task.done_at === null && task.deleted_at === null && task.assignee_id === meId && reminderAt(task) !== null
}

const byDue = (a: Task, b: Task) => Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? '') || a.id.localeCompare(b.id)

/** The reminders that are on now: from the reminder time to twelve hours after the due time, minus those that are snoozed. */
export function activeReminders(tasks: Task[], now: Date, snoozed: Snoozed, meId: string): Task[] {
  const at = now.getTime()
  return tasks
    .filter((task) => {
      if (!isReminderTask(task, meId)) return false
      const remindAt = (reminderAt(task) as Date).getTime()
      const due = Date.parse(task.due_at as string)
      return at >= remindAt && at <= due + REMINDER_AFTER_DUE_MS && !((snoozed[task.id] ?? 0) > at)
    })
    .sort(byDue)
}

const MAX_ID = 2_147_483_647

/** The first number from `start` up that is not taken, going round to 1 after the top of the range of a notification id. */
export function nextFreeId(start: number, taken: ReadonlySet<number>): number {
  let id = start
  while (taken.has(id)) id = id >= MAX_ID ? 1 : id + 1
  return id
}

/**
 * The number a platform knows the notification of a task by. It is made from the task id, so that
 * planning the same task again names the same notification and replaces it, and it fits the 31 bits
 * that Android allows. A number that is taken by another notification of the plan is moved on.
 */
export function notificationId(taskId: string, taken: ReadonlySet<number> = new Set()): number {
  // FNV-1a, 32 bits.
  let hash = 0x811c9dc5
  for (let i = 0; i < taskId.length; i++) {
    hash ^= taskId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const id = (hash & MAX_ID) || 1
  return nextFreeId(id, taken)
}

export interface PlannedNotification {
  id: number
  taskId: string
  at: Date
  title: string
  body: string
}

/**
 * The notifications to have pending, as a whole plan: the next 48 hours, at most 60, the earliest
 * first. A plan replaces what was planned before, so a task that was done, deleted, moved or given to
 * somebody else drops out of it by itself. A reminder time that has passed is not planned again (it
 * has fired, or the strip shows it); a snoozed task is planned for the end of its snooze. The text
 * is the title and the time, and nothing more, because a lock screen is not private.
 */
export function planNotifications(
  tasks: Task[],
  now: Date,
  snoozed: Snoozed,
  meId: string,
  options: { horizonMs?: number; max?: number } = {},
): PlannedNotification[] {
  const at = now.getTime()
  const horizon = at + (options.horizonMs ?? PLAN_HORIZON_MS)
  const due: Array<{ task: Task; when: number }> = []
  for (const task of tasks) {
    if (!isReminderTask(task, meId)) continue
    const when = Math.max((reminderAt(task) as Date).getTime(), snoozed[task.id] ?? 0)
    if (when <= at || when > horizon) continue
    if (when > Date.parse(task.due_at as string) + REMINDER_AFTER_DUE_MS) continue
    due.push({ task, when })
  }
  due.sort((a, b) => a.when - b.when || a.task.id.localeCompare(b.task.id))

  const taken = new Set<number>()
  return due.slice(0, options.max ?? PLAN_MAX).map(({ task, when }) => {
    const id = notificationId(task.id, taken)
    taken.add(id)
    return {
      id,
      taskId: task.id,
      at: new Date(when),
      title: `תזכורת: ${taskTitle(task)}`,
      // The day is the one it is when the notification arrives, not when it was planned.
      body: formatDue(task.due_at as string, new Date(when)),
    }
  })
}
