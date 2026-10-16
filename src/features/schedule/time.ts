import { fromDueAt, toDueAt } from '../tasks/validation'

// The days, weeks and clock of the Today and Calendar screens. Everything is by the calendar of
// Jerusalem (the helpers of validation.ts use `Intl` with that zone), never by the zone of the
// device, so that a phone abroad and a laptop at the desk show the same "today". A day is not
// always 24 hours: 2026-03-27 has 23 and 2026-10-25 has 25. Positions within a day are therefore
// minutes of the wall clock.

/** A calendar day in Jerusalem, as `2026-10-16`. */
export type DayKey = string

/** Sunday first, as the week is counted in Israel. */
export const WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const
export const WEEKDAY_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const

type Moment = Date | string | number

const toIso = (at: Moment) => new Date(at).toISOString()

/** The day in Jerusalem that a moment falls on. */
export function dayKey(at: Moment): DayKey {
  return fromDueAt(toIso(at)).dueDate
}

function parts(key: DayKey): [number, number, number] {
  const [year, month, day] = key.split('-').map(Number)
  return [year, month, day]
}

/** The day `n` days after (or, when negative, before) a day. Calendar arithmetic: the clocks do not matter. */
export function addDays(key: DayKey, n: number): DayKey {
  const [year, month, day] = parts(key)
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10)
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(key: DayKey): number {
  const [year, month, day] = parts(key)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** The Sunday on or before a day. */
export function startOfWeek(key: DayKey): DayKey {
  return addDays(key, -weekday(key))
}

/** A time on the wall in Jerusalem (`09:30`) on a day, as a moment. Throws for a day or a time that cannot exist. */
export function atTime(key: DayKey, time: string): Date {
  const moment = toDueAt(key, time)
  if (moment === null) throw new Error(`Invalid day: "${key}"`)
  return new Date(moment)
}

/** Midnight in Jerusalem at the start of a day, as a moment. */
export function dayStart(key: DayKey): Date {
  return atTime(key, '00:00')
}

/** The minutes that the wall clock in Jerusalem has counted since midnight, 0 to 1439. */
export function minuteOfDay(at: Moment): number {
  const [hours, minutes] = fromDueAt(toIso(at)).dueTime.split(':').map(Number)
  return hours * 60 + minutes
}

/** The time on the wall in Jerusalem, as `14:05`. */
export function formatClock(at: Moment): string {
  return fromDueAt(toIso(at)).dueTime
}

/** A length of time in a few words: "5 דק׳", "שעה ו-10 דק׳", "2 שע׳", "יום", "3 ימים". The sign is ignored. */
export function formatSpan(minutes: number): string {
  const total = Math.abs(Math.round(minutes))
  if (total < 60) return `${total} דק׳`
  if (total < 1440) {
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return (hours === 1 ? 'שעה' : `${hours} שע׳`) + (rest ? ` ו-${rest} דק׳` : '')
  }
  const days = Math.floor(total / 1440)
  return days === 1 ? 'יום' : `${days} ימים`
}
