import type { Task } from './model'
import { normalizeQuery, phoneNeedle } from './search'

export interface TaskFilter {
  /** A status key, or null for every status. */
  statusKey: string | null
  /** 'me', 'all', 'none' (nobody is assigned), or the id of a person. */
  assignee: string
  /** A shipping method, or null for every method. */
  shipMethod: string | null
  state: 'open' | 'done' | 'all'
  /** The text of the search box. It looks in the same fields as the search on the server. */
  text: string
}

const TEXT_FIELDS = [
  'title',
  'customer_name',
  'order_number',
  'service_call_number',
  'glassix_conversation_id',
  'cargo_number',
  'product_sku',
] as const

function matchesText(task: Task, text: string, phoneDigits: string | null): boolean {
  if (TEXT_FIELDS.some((field) => task[field].toLowerCase().includes(text))) return true
  // A task that is only here has no digits yet: the database makes them.
  const digits = task.customer_phone_digits || task.customer_phone.replace(/\D/g, '')
  return phoneDigits !== null && digits.includes(phoneDigits)
}

/** The tasks that pass the filter. A deleted task never does. */
export function filterTasks(tasks: Task[], filter: TaskFilter, meId: string): Task[] {
  const text = normalizeQuery(filter.text).toLowerCase()
  const phoneDigits = phoneNeedle(filter.text)
  return tasks.filter((task) => {
    if (task.deleted_at !== null) return false
    if (filter.statusKey !== null && task.status_key !== filter.statusKey) return false
    if (filter.assignee === 'me' && task.assignee_id !== meId) return false
    if (filter.assignee === 'none' && task.assignee_id !== null) return false
    if (filter.assignee !== 'all' && filter.assignee !== 'me' && filter.assignee !== 'none' && task.assignee_id !== filter.assignee) {
      return false
    }
    if (filter.shipMethod !== null && task.ship_method !== filter.shipMethod) return false
    if (filter.state === 'open' && task.done_at !== null) return false
    if (filter.state === 'done' && task.done_at === null) return false
    return text === '' || matchesText(task, text, phoneDigits)
  })
}

export type SortKey = 'due' | 'title' | 'updated'
export type SortDirection = 'asc' | 'desc'
/** The orders that the screen offers, each a key and a direction: 'due-asc' is the nearest date first. */
export type SortChoice = 'due-asc' | 'due-desc' | 'title-asc' | 'updated-desc' | 'updated-asc'

const dueMs = (task: Task) => (task.due_at === null ? null : Date.parse(task.due_at))

/**
 * The tasks in the order asked for, as a new list. By due date the open tasks come before the done
 * ones and a task without a date comes last, whichever way the dates run. A tie is settled by the
 * id, so that the order never jumps around.
 */
export function sortTasks(tasks: Task[], key: SortKey, direction: SortDirection): Task[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    let result = 0
    if (key === 'due') {
      const doneLast = Number(a.done_at !== null) - Number(b.done_at !== null)
      if (doneLast !== 0) return doneLast
      const [x, y] = [dueMs(a), dueMs(b)]
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1
      } else {
        result = (x - y) * sign
      }
    } else if (key === 'title') {
      result = a.title.localeCompare(b.title, 'he', { numeric: true }) * sign
    } else {
      result = (Date.parse(a.updated_at) - Date.parse(b.updated_at)) * sign
    }
    return result || a.id.localeCompare(b.id)
  })
}

/** The tasks in the order of one of the choices of the screen. */
export function sortByChoice(tasks: Task[], choice: SortChoice): Task[] {
  const [key, direction] = choice.split('-') as [SortKey, SortDirection]
  return sortTasks(tasks, key, direction)
}

/** An open task whose time has passed. */
export function isOverdue(task: Task, now: Date): boolean {
  return task.due_at !== null && task.done_at === null && Date.parse(task.due_at) < now.getTime()
}

/** How many of the tasks have each status. */
export function statusCounts(tasks: Task[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const task of tasks) counts[task.status_key] = (counts[task.status_key] ?? 0) + 1
  return counts
}

export interface Page<T> {
  items: T[]
  /** The page that is shown, counted from 1. */
  page: number
  pageCount: number
  total: number
}

/** One page of a long list. A page that is not there becomes the nearest one that is. */
export function paginate<T>(items: T[], page: number, size = 100): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size))
  const shown = Number.isFinite(page) ? Math.min(Math.max(1, Math.trunc(page)), pageCount) : 1
  return { items: items.slice((shown - 1) * size, shown * size), page: shown, pageCount, total: items.length }
}
