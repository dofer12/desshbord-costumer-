import type { Task } from '../tasks/model'
import { addDays, atTime, dayKey, dayStart } from './time'

// What the Today screen shows, worked out from the tasks alone. The old app computed the same things
// inside its rendering; here they are pure, so that the numbers can be tested against fixed moments,
// including the two days a year when the clocks change.

const MINUTE_MS = 60_000
/** A task that is due within this long is "soon". */
const SOON_MS = 60 * MINUTE_MS

export type DueState = 'done' | 'none' | 'late' | 'soon' | 'today' | 'later'

/** Where a task stands in time: done, without a time, late, within the hour, later today, or later. */
export function dueState(task: Task, now: Date): DueState {
  if (task.done_at !== null) return 'done'
  if (task.due_at === null) return 'none'
  const due = Date.parse(task.due_at)
  const at = now.getTime()
  if (due < at) return 'late'
  if (due - at <= SOON_MS) return 'soon'
  return dayKey(due) === dayKey(at) ? 'today' : 'later'
}

export interface WorkloadRow {
  /** The id of the assignee, or `'none'` for the tasks that nobody has. */
  key: string
  open: number
  late: number
  today: number
}

export interface TodayView {
  counts: {
    /** Open tasks whose time has passed. */
    late: number
    /** Open tasks due from now to the end of today. */
    remaining: number
    /** Those of the remaining that are due within the hour. */
    soon: number
    /** Open tasks without a due time. */
    undated: number
    /** Tasks done on today's date in Jerusalem. */
    doneToday: number
  }
  /** The queue to work through: the late tasks, then the rest of today, each by time. */
  queue: Task[]
  /** The open tasks without a due time, the oldest first. */
  undated: Task[]
  /** Open work per person, over everybody's tasks. */
  workload: WorkloadRow[]
}

const byDue = (a: Task, b: Task) => Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? '') || a.id.localeCompare(b.id)
const byCreated = (a: Task, b: Task) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)

/**
 * The Today screen for a moment. `scope.mine` limits the counts, the queue and the list without a
 * time to the tasks of `meId`; the workload table is always about everybody. Deleted tasks are
 * nowhere.
 */
export function buildToday(tasks: Task[], now: Date, scope: { meId: string; mine: boolean }): TodayView {
  const at = now.getTime()
  const today = dayKey(at)
  const endOfToday = dayStart(addDays(today, 1)).getTime()
  const alive = tasks.filter((task) => task.deleted_at === null)
  const open = alive.filter((task) => task.done_at === null)
  const mine = (task: Task) => !scope.mine || task.assignee_id === scope.meId
  const dueMs = (task: Task) => (task.due_at === null ? null : Date.parse(task.due_at))

  const late = open.filter((task) => mine(task) && (dueMs(task) ?? Infinity) < at).sort(byDue)
  const remaining = open
    .filter((task) => {
      const due = dueMs(task)
      return mine(task) && due !== null && due >= at && due < endOfToday
    })
    .sort(byDue)
  const undated = open.filter((task) => mine(task) && task.due_at === null).sort(byCreated)
  const soon = remaining.filter((task) => (dueMs(task) ?? Infinity) - at <= SOON_MS)
  const doneToday = alive.filter((task) => mine(task) && task.done_at !== null && dayKey(task.done_at) === today)

  const rows = new Map<string, WorkloadRow>()
  for (const task of open) {
    const key = task.assignee_id ?? 'none'
    const row = rows.get(key) ?? { key, open: 0, late: 0, today: 0 }
    row.open += 1
    const due = dueMs(task)
    if (due !== null && due < at) row.late += 1
    else if (due !== null && due < endOfToday) row.today += 1
    rows.set(key, row)
  }
  const workload = [...rows.values()].sort((a, b) => b.late - a.late || b.open - a.open || a.key.localeCompare(b.key))

  return {
    counts: { late: late.length, remaining: remaining.length, soon: soon.length, undated: undated.length, doneToday: doneToday.length },
    queue: [...late, ...remaining],
    undated,
    workload,
  }
}

export type PostponeChoice = '30' | '60' | 'tomorrow'

/**
 * The new due time for a task that is put off. Thirty minutes or an hour counts from the later of
 * now and the old due time, so that a late task moves ahead of the present and not to another moment
 * in the past; the seconds are dropped. "Tomorrow" is 09:00 on the next day in Jerusalem, from now.
 */
export function postponeTarget(task: Task, choice: PostponeChoice, now: Date): string {
  if (choice === 'tomorrow') return atTime(addDays(dayKey(now), 1), '09:00').toISOString()
  const from = Math.max(now.getTime(), task.due_at === null ? 0 : Date.parse(task.due_at))
  const moved = from + Number(choice) * MINUTE_MS
  return new Date(Math.floor(moved / MINUTE_MS) * MINUTE_MS).toISOString()
}

/** The number on the Today tab: the open tasks of the person that are due before the end of today, the late ones too. */
export function todayBadge(tasks: Task[], now: Date, meId: string): { count: number; late: boolean } {
  const at = now.getTime()
  const endOfToday = dayStart(addDays(dayKey(at), 1)).getTime()
  const mine = tasks.filter((task) => task.deleted_at === null && task.done_at === null && task.assignee_id === meId && task.due_at !== null)
  const due = mine.map((task) => Date.parse(task.due_at as string)).filter((ms) => ms < endOfToday)
  return { count: due.length, late: due.some((ms) => ms < at) }
}
