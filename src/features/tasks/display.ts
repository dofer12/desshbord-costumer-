import { WEEKDAY_SHORT } from '../schedule/time'
import type { Task } from './model'
import { fallbackTitle, fromDueAt } from './validation'

/** A calendar day as a number of days since 1970, so that two days can be subtracted. */
function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/**
 * When a task is due, in a few words: "היום · 14:30", "מחר · 09:00", "ה׳ 22.10 · 09:00", and with
 * the year for a day in another year. The days are those of the calendar in Jerusalem, whatever
 * the time zone of the device. Empty for a moment that is not a date.
 */
export function formatDue(dueAt: string, now: Date): string {
  const due = fromDueAt(dueAt)
  if (!due.dueDate) return ''
  const today = fromDueAt(now.toISOString()).dueDate
  const apart = dayNumber(due.dueDate) - dayNumber(today)
  if (apart === 0) return `היום · ${due.dueTime}`
  if (apart === 1) return `מחר · ${due.dueTime}`
  if (apart === -1) return `אתמול · ${due.dueTime}`
  const [year, month, day] = due.dueDate.split('-').map(Number)
  if (year !== Number(today.slice(0, 4))) return `${day}.${month}.${year} · ${due.dueTime}`
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${weekday} ${day}.${month} · ${due.dueTime}`
}

/** The colour of a status that the directory does not know. */
export const UNKNOWN_STATUS_COLOR = '#8a9aa1'

export const TEXT_ON_DARK = '#ffffff'
export const TEXT_ON_LIGHT = '#14262e'

/** The relative luminance of a colour as WCAG defines it, or null for what is not #rgb or #rrggbb. */
function luminance(color: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1]
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The text colour that reads best on a status colour: white or the dark of the app, whichever has more contrast. */
export function statusTextColor(background: string): string {
  const light = luminance(background)
  if (light === null) return TEXT_ON_LIGHT
  const contrastWithWhite = 1.05 / (light + 0.05)
  const contrastWithDark = (light + 0.05) / ((luminance(TEXT_ON_LIGHT) ?? 0) + 0.05)
  return contrastWithWhite > contrastWithDark ? TEXT_ON_DARK : TEXT_ON_LIGHT
}

/** The address that makes a phone dial: the digits of the number, and a plus if it starts with one. Null when there is no number. */
export function dialHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`
}

/** The title to show: the one that was typed, else one made from the order or the customer. */
export const taskTitle = (task: Task) => fallbackTitle(task) || 'ללא כותרת'
