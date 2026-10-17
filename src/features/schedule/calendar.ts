import type { Task } from '../tasks/model'
import { addDays, atTime, dayKey, minuteOfDay, startOfWeek, weekday, WEEKDAY_SHORT, type DayKey } from './time'

// The layout of the calendar, worked out from the tasks alone: where each task goes on its day, side by
// side with the ones that it overlaps, and what a click on an empty place means. A position is a
// minute of the wall clock of Jerusalem (never of the device), so a day with 23 or 25 hours loses
// nothing and doubles nothing.

const MINUTES_PER_DAY = 1440
const LENGTH_WHEN_UNKNOWN_MIN = 30
const SLOT_MIN = 30
const FIRST_HOUR = 7
const LAST_HOUR = 21

/** A task on a day, from the minute that it starts to the minute that it ends. */
export interface DayItem {
  task: Task
  start: number
  end: number
}

/** A task with its place among the ones that it overlaps: column `column` of `columns`. */
export interface PlacedItem extends DayItem {
  column: number
  columns: number
}

/**
 * Puts the tasks of a day side by side. The tasks that overlap, one after another, make a cluster; in
 * a cluster each takes the first column that is free, and all of them share the width of as many
 * columns as the cluster needed. A task that ends when another starts does not overlap it. A task that
 * is shorter than `minSpan` takes `minSpan` minutes for the packing, so that it is not hidden under
 * the one that comes next. They come out in the order of their start, the longer first.
 */
export function packDay(items: DayItem[], minSpan = 30): PlacedItem[] {
  const packedEnd = (item: DayItem) => Math.max(item.end, item.start + minSpan)
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.task.id.localeCompare(b.task.id))

  const placed: PlacedItem[] = []
  let cluster: PlacedItem[] = []
  let columnEnds: number[] = []
  let clusterEnd = -Infinity
  const closeCluster = () => {
    for (const item of cluster) item.columns = columnEnds.length
    placed.push(...cluster)
    cluster = []
    columnEnds = []
    clusterEnd = -Infinity
  }

  for (const item of sorted) {
    if (item.start >= clusterEnd) closeCluster()
    let column = columnEnds.findIndex((end) => end <= item.start)
    if (column === -1) column = columnEnds.push(0) - 1
    columnEnds[column] = packedEnd(item)
    clusterEnd = Math.max(clusterEnd, packedEnd(item))
    cluster.push({ ...item, column, columns: 0 })
  }
  closeCluster()
  return placed
}

export interface DayLayout {
  key: DayKey
  items: PlacedItem[]
}

export interface RangeLayout {
  days: DayLayout[]
  /** The first hour that is shown, and the hour at which the last one ends: 7 to 21, wider when a task is outside them. */
  fromHour: number
  toHour: number
}

/** 'me', 'all', 'none' (nobody has it) or the id of a person: whose tasks are wanted. */
function wanted(task: Task, assignee: string, meId: string): boolean {
  if (assignee === 'all') return true
  if (assignee === 'me') return task.assignee_id === meId
  if (assignee === 'none') return task.assignee_id === null
  return task.assignee_id === assignee
}

/**
 * The days of the range with their tasks in place. A task is on the day that it is in Jerusalem and
 * ends when its length is over, or at midnight; a length that is not a number above nought is half an
 * hour. A task without a time and a deleted task are not placed; a done one is. The hours that are
 * shown are 7 to 21, and more when a task starts before or ends after them.
 */
export function layoutRange(tasks: Task[], startKey: DayKey, days: number, options: { assignee: string; meId: string }): RangeLayout {
  const keys = Array.from({ length: days }, (_, i) => addDays(startKey, i))
  const byDay = new Map<DayKey, DayItem[]>(keys.map((key) => [key, []]))
  let fromHour = FIRST_HOUR
  let toHour = LAST_HOUR

  for (const task of tasks) {
    if (task.deleted_at !== null || task.due_at === null || !wanted(task, options.assignee, options.meId)) continue
    const day = byDay.get(dayKey(task.due_at))
    if (!day) continue
    const start = minuteOfDay(task.due_at)
    const end = Math.min(start + (task.duration_min > 0 ? task.duration_min : LENGTH_WHEN_UNKNOWN_MIN), MINUTES_PER_DAY)
    day.push({ task, start, end })
    fromHour = Math.min(fromHour, Math.floor(start / 60))
    toHour = Math.max(toHour, Math.ceil(end / 60))
  }

  return { days: keys.map((key) => ({ key, items: packDay(byDay.get(key) ?? []) })), fromHour, toHour }
}

/**
 * The moment that a click on a day at `minuteInDay` means for a new task: the nearest half hour, the
 * moment of that time in Jerusalem. A click in the last quarter of an hour would round to midnight of
 * the next day, and the new task would be on the wrong day, so it is held at half past eleven; an
 * offset before the day or after it is held to the day.
 */
export function slotToDue(key: DayKey, minuteInDay: number): string {
  const rounded = Math.round(minuteInDay / SLOT_MIN) * SLOT_MIN
  const held = Math.min(Math.max(rounded, 0), MINUTES_PER_DAY - SLOT_MIN)
  const clock = `${String(Math.floor(held / 60)).padStart(2, '0')}:${String(held % 60).padStart(2, '0')}`
  return atTime(key, clock).toISOString()
}

const dayAndMonth = (key: DayKey) => `${key.slice(8, 10)}.${key.slice(5, 7)}`
const year = (key: DayKey) => key.slice(0, 4)

/** "18.10 – 24.10/2026" for a range, "28.12/2026 – 03.01/2027" across a year, "יום א׳ 18.10/2026" for one day. */
export function rangeTitle(startKey: DayKey, days: number): string {
  if (days === 1) return `יום ${WEEKDAY_SHORT[weekday(startKey)]} ${dayAndMonth(startKey)}/${year(startKey)}`
  const endKey = addDays(startKey, days - 1)
  const from = year(startKey) === year(endKey) ? dayAndMonth(startKey) : `${dayAndMonth(startKey)}/${year(startKey)}`
  return `${from} – ${dayAndMonth(endKey)}/${year(endKey)}`
}

/** The first day of the range around a day: a week starts on Sunday; three days and one day start at the day itself. */
export function rangeStart(anchor: DayKey, days: number): DayKey {
  return days === 7 ? startOfWeek(anchor) : anchor
}

/** The day to move to, a whole range forward or back. */
export function shiftAnchor(anchor: DayKey, days: number, direction: -1 | 1): DayKey {
  return addDays(anchor, direction * days)
}
