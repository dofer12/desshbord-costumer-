import type { Task } from './model'

export const TASK_MESSAGES = {
  title: 'כתוב מה צריך לעשות, או מלא מספר הזמנה או שם לקוח.',
  contact: 'מלא לפחות אחד מהשדות: מספר הזמנה, מספר קריאת שירות, שם לקוח או טלפון.',
  dueNeedsDate: 'נבחרה שעה בלי תאריך. בחר גם תאריך טיפול.',
  dueInvalid: 'התאריך או השעה לא תקינים.',
  glassix: 'מלא את מזהה שיחת Glassix, או סמן "אין שיחה ב-Glassix".',
  product: 'בסוג איסוף חובה למלא שם מוצר.',
} as const

export type TaskErrors = Partial<Record<'title' | 'contact' | 'due' | 'glassix' | 'product', string>>

/**
 * The title of a task: the one that was typed, else one made from the order number or the
 * customer's name, as the old app did. Empty when there is nothing to make it from.
 */
export function fallbackTitle(task: Pick<Task, 'title' | 'order_number' | 'customer_name'>): string {
  const title = task.title.trim()
  if (title) return title
  const order = task.order_number.trim().replace(/^#\s*/, '')
  if (order) return `טיפול בהזמנה #${order}`
  const name = task.customer_name.trim()
  return name ? `לחזור אל ${name}` : ''
}

/** What is wrong with a task before it is saved. An empty object means that it can be saved. */
export function validateTask(task: Task, form: { dueDate: string; dueTime: string }): TaskErrors {
  const errors: TaskErrors = {}

  if (!fallbackTitle(task)) errors.title = TASK_MESSAGES.title

  const hasContact = [task.order_number, task.service_call_number, task.customer_name, task.customer_phone].some(
    (value) => value.trim() !== '',
  )
  if (!hasContact) errors.contact = TASK_MESSAGES.contact

  const date = form.dueDate.trim()
  const time = form.dueTime.trim()
  if (time && !date) {
    errors.due = TASK_MESSAGES.dueNeedsDate
  } else if (date) {
    try {
      toDueAt(date, time)
    } catch {
      errors.due = TASK_MESSAGES.dueInvalid
    }
  }

  if (!task.no_glassix && !task.glassix_conversation_id.trim()) errors.glassix = TASK_MESSAGES.glassix

  if (task.kind === 'pickup' && !task.product_name.trim()) errors.product = TASK_MESSAGES.product

  return errors
}

const ZONE = 'Asia/Jerusalem'
const DEFAULT_TIME = '09:00'
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

const zoneClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function clockParts(utcMs: number): Record<string, string> {
  return Object.fromEntries(zoneClock.formatToParts(utcMs).map((part) => [part.type, part.value]))
}

/** How many minutes Jerusalem is ahead of UTC at the given moment: 120 in winter, 180 in summer. */
function zoneOffsetMinutes(utcMs: number): number {
  const p = clockParts(utcMs)
  const clockAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((clockAsUtc - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

/**
 * The moment of a date and a time as they are on the wall in Jerusalem. A date without a time is
 * 09:00, as in the old app, and no date means no moment. Throws for a date or a time that cannot
 * exist. A time that the clock skips (02:30 when the clocks go forward) becomes the same minute
 * after the jump.
 */
export function toDueAt(date: string, time: string): string | null {
  const day = date.trim()
  if (!day) return null
  const d = DATE_PATTERN.exec(day)
  const t = TIME_PATTERN.exec(time.trim() || DEFAULT_TIME)
  if (!d || !t) throw new Error(`Invalid due date or time: "${date}" "${time}"`)

  const [year, month, dayOfMonth] = [+d[1], +d[2], +d[3]]
  const calendar = new Date(Date.UTC(year, month - 1, dayOfMonth))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== dayOfMonth) {
    throw new Error(`Invalid due date: "${date}"`)
  }

  // Treat the wall-clock time as if it were UTC, then correct it by the offset that was in force.
  // The offset is looked up twice, because the first guess can fall on the wrong side of a clock change.
  const wallAsUtc = Date.UTC(year, month - 1, dayOfMonth, +t[1], +t[2])
  const first = zoneOffsetMinutes(wallAsUtc)
  let moment = wallAsUtc - first * 60_000
  const second = zoneOffsetMinutes(moment)
  if (second !== first) moment = wallAsUtc - second * 60_000
  return new Date(moment).toISOString()
}

/** The date and the time on the wall in Jerusalem at a moment, as the form fields show them. */
export function fromDueAt(iso: string | null): { dueDate: string; dueTime: string } {
  const none = { dueDate: '', dueTime: '' }
  if (!iso) return none
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return none
  const p = clockParts(ms)
  return { dueDate: `${p.year}-${p.month}-${p.day}`, dueTime: `${p.hour}:${p.minute}` }
}

// A whole moment with a zone: "2026-10-20T11:30:00.000Z", seconds and milliseconds optional, "Z" or an offset.
const MOMENT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

/**
 * The moment that the address of a new card asks for (`?due=`), as an ISO string in UTC, or null when
 * there is none or it is not a real moment. The browser's own parser is too forgiving for this: it
 * reads "1" as a year, and moves the 30th of February to March. A value that someone typed by hand and
 * got wrong is left out, so the card opens empty and not on a date nobody chose.
 */
export function parseDuePreset(value: string | null): string | null {
  const parts = value === null ? null : MOMENT_PATTERN.exec(value)
  if (!parts || value === null) return null
  const [year, month, day] = [+parts[1], +parts[2], +parts[3]]
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * The address of a Glassix conversation: the template of the settings with {id} replaced by the
 * conversation id. Null unless the template is a web address that starts with https:// and has {id}.
 */
export function glassixUrl(template: string, id: string): string | null {
  const conversation = id.trim()
  const base = template.trim()
  if (!conversation || !/^https:\/\//i.test(base) || !base.includes('{id}')) return null
  const url = base.replaceAll('{id}', encodeURIComponent(conversation))
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
