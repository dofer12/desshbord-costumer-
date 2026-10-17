import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays,
  atTime,
  dayKey,
  dayStart,
  formatClock,
  formatSpan,
  minuteOfDay,
  relativeTo,
  startOfWeek,
  weekday,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
} from './time'

// Every answer here is about the calendar and the clock of Jerusalem, whatever zone the machine is
// in: the instants are fixed, so a CI machine in UTC and the owner's laptop must agree.

describe('whatever the zone of the device', () => {
  const original = process.env.TZ
  afterEach(() => {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  })

  it.each([
    ['UTC', 21],
    ['America/New_York', 17],
    ['Pacific/Auckland', 10],
    ['Asia/Jerusalem', 0],
  ])('gives the answers of Jerusalem when the device is in %s', (zone, deviceHour) => {
    process.env.TZ = zone
    // The switch has to have taken effect, or this test would prove nothing.
    expect(new Date('2026-10-16T21:30:00Z').getHours()).toBe(deviceHour)

    expect(dayKey('2026-10-16T21:30:00Z')).toBe('2026-10-17')
    expect(minuteOfDay('2026-10-16T21:30:00Z')).toBe(30)
    expect(formatClock('2026-10-16T21:30:00Z')).toBe('00:30')
    expect(dayStart('2026-10-25').toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(atTime('2026-10-16', '09:30').toISOString()).toBe('2026-10-16T06:30:00.000Z')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(weekday('2026-10-18')).toBe(0)
    expect(startOfWeek('2026-10-16')).toBe('2026-10-11')
  })
})

describe('dayKey', () => {
  it.each([
    ['2026-10-16T21:30:00Z', '2026-10-17'],
    ['2026-10-16T20:59:00Z', '2026-10-16'],
    ['2026-10-16T21:00:00Z', '2026-10-17'],
    // The end of summer time: 02:00 of 2026-10-25 becomes 01:00, so that day has 25 hours.
    ['2026-10-24T21:30:00Z', '2026-10-25'],
    ['2026-10-25T21:30:00Z', '2026-10-25'],
    ['2026-10-25T22:30:00Z', '2026-10-26'],
    // The start of summer time: 02:00 of 2026-03-27 becomes 03:00, so that day has 23 hours.
    ['2026-03-26T22:30:00Z', '2026-03-27'],
    ['2026-03-27T20:59:00Z', '2026-03-27'],
    ['2026-03-27T21:30:00Z', '2026-03-28'],
    ['2027-01-01T00:00:00Z', '2027-01-01'],
    ['2026-12-31T22:30:00Z', '2027-01-01'],
  ])('%s is the day %s in Jerusalem', (instant, key) => {
    expect(dayKey(instant)).toBe(key)
  })

  it('takes a Date, an ISO string and a number of milliseconds alike', () => {
    const ms = Date.parse('2026-10-16T21:30:00Z')
    expect(dayKey(new Date(ms))).toBe('2026-10-17')
    expect(dayKey(ms)).toBe('2026-10-17')
    expect(dayKey('2026-10-16T21:30:00Z')).toBe('2026-10-17')
  })
})

describe('addDays', () => {
  it.each([
    ['2026-10-24', 1, '2026-10-25'],
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-03-26', 1, '2026-03-27'],
    ['2026-03-27', 1, '2026-03-28'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-01'],
    ['2026-10-16', 0, '2026-10-16'],
    ['2026-10-16', 400, '2027-11-20'],
    ['2026-10-16', -400, '2025-09-11'],
  ])('%s plus %i days is %s', (key, n, expected) => {
    expect(addDays(key, n)).toBe(expected)
  })
})

describe('weekday and startOfWeek', () => {
  it('counts the days from Sunday, as the week is counted in Israel', () => {
    expect(weekday('2026-10-18')).toBe(0)
    expect(weekday('2026-10-19')).toBe(1)
    expect(weekday('2026-10-16')).toBe(5)
    expect(weekday('2026-10-17')).toBe(6)
  })

  it('finds the Sunday on or before a day', () => {
    expect(startOfWeek('2026-10-16')).toBe('2026-10-11')
    expect(startOfWeek('2026-10-17')).toBe('2026-10-11')
    expect(startOfWeek('2026-10-18')).toBe('2026-10-18')
    expect(startOfWeek('2026-10-24')).toBe('2026-10-18')
  })

  it('crosses the end of a month and of a year', () => {
    expect(startOfWeek('2027-01-02')).toBe('2026-12-27')
    expect(startOfWeek('2026-11-03')).toBe('2026-11-01')
    expect(startOfWeek('2026-03-01')).toBe('2026-03-01')
    expect(startOfWeek('2026-03-02')).toBe('2026-03-01')
  })

  it('has the names of the weekdays in the same order', () => {
    expect(WEEKDAY_SHORT).toEqual(['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'])
    expect(WEEKDAY_LONG).toEqual(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])
  })
})

describe('dayStart', () => {
  it('is midnight in Jerusalem as a moment', () => {
    expect(dayStart('2026-10-16').toISOString()).toBe('2026-10-15T21:00:00.000Z')
    expect(dayStart('2026-01-15').toISOString()).toBe('2026-01-14T22:00:00.000Z')
  })

  it('shows that the day the clocks go back is 25 hours long', () => {
    expect(dayStart('2026-10-25').toISOString()).toBe('2026-10-24T21:00:00.000Z')
    expect(dayStart('2026-10-26').toISOString()).toBe('2026-10-25T22:00:00.000Z')
    const hours = (dayStart('2026-10-26').getTime() - dayStart('2026-10-25').getTime()) / 3_600_000
    expect(hours).toBe(25)
  })

  it('shows that the day the clocks go forward is 23 hours long', () => {
    expect(dayStart('2026-03-27').toISOString()).toBe('2026-03-26T22:00:00.000Z')
    expect(dayStart('2026-03-28').toISOString()).toBe('2026-03-27T21:00:00.000Z')
    const hours = (dayStart('2026-03-28').getTime() - dayStart('2026-03-27').getTime()) / 3_600_000
    expect(hours).toBe(23)
  })
})

describe('atTime', () => {
  it('is a time on the wall in Jerusalem as a moment', () => {
    expect(atTime('2026-10-16', '09:30').toISOString()).toBe('2026-10-16T06:30:00.000Z')
    expect(atTime('2026-01-15', '09:30').toISOString()).toBe('2026-01-15T07:30:00.000Z')
    expect(atTime('2026-10-16', '00:00').getTime()).toBe(dayStart('2026-10-16').getTime())
  })

  it('throws for a day or a time that cannot exist', () => {
    expect(() => atTime('2026-02-30', '09:00')).toThrow()
    expect(() => atTime('2026-10-16', '25:00')).toThrow()
    expect(() => atTime('', '09:00')).toThrow()
  })
})

describe('minuteOfDay and formatClock', () => {
  it('counts the minutes of the wall clock in Jerusalem', () => {
    expect(minuteOfDay('2026-10-16T11:30:00Z')).toBe(14 * 60 + 30)
    expect(minuteOfDay('2026-10-15T21:00:00Z')).toBe(0)
    expect(minuteOfDay('2026-10-16T20:59:00Z')).toBe(1439)
    expect(minuteOfDay(Date.parse('2026-01-15T07:30:00Z'))).toBe(9 * 60 + 30)
    expect(minuteOfDay(new Date('2026-10-25T22:30:00Z'))).toBe(30)
  })

  it('writes the time with two digits', () => {
    expect(formatClock('2026-10-16T11:05:00Z')).toBe('14:05')
    expect(formatClock('2026-10-15T21:00:00Z')).toBe('00:00')
    expect(formatClock(new Date('2026-01-15T07:30:00Z'))).toBe('09:30')
  })
})

describe('formatSpan', () => {
  it.each([
    [0, '0 דק׳'],
    [0.4, '0 דק׳'],
    [1, '1 דק׳'],
    [59, '59 דק׳'],
    [59.6, 'שעה'],
    [60, 'שעה'],
    [61, 'שעה ו-1 דק׳'],
    [90, 'שעה ו-30 דק׳'],
    [120, '2 שע׳'],
    [125, '2 שע׳ ו-5 דק׳'],
    [1439, '23 שע׳ ו-59 דק׳'],
    [1440, 'יום'],
    [2000, 'יום'],
    [2880, '2 ימים'],
    [4319, '2 ימים'],
    [-5, '5 דק׳'],
    [-120, '2 שע׳'],
  ])('%s minutes is "%s"', (minutes, text) => {
    expect(formatSpan(minutes)).toBe(text)
  })
})

describe('relativeTo', () => {
  const NOW = new Date('2026-10-16T09:00:00Z')
  const from = (seconds: number) => relativeTo(new Date(NOW.getTime() + seconds * 1000), NOW)

  // A moment ahead is counted up to the next whole minute, so that it never says "in 0 minutes" before
  // it has come; a moment that has passed is counted down to the whole minute, and the first minute
  // after it is "now".
  it('says how long it is to a moment that is ahead, rounded up to the minute', () => {
    expect(from(45 * 60)).toEqual({ state: 'ahead', span: '45 דק׳' })
    expect(from(44 * 60 + 30)).toEqual({ state: 'ahead', span: '45 דק׳' })
    expect(from(61)).toEqual({ state: 'ahead', span: '2 דק׳' })
    expect(from(60)).toEqual({ state: 'ahead', span: '1 דק׳' })
    expect(from(1)).toEqual({ state: 'ahead', span: '1 דק׳' })
  })

  it('says "now" from the moment itself until a whole minute after it', () => {
    expect(from(0)).toEqual({ state: 'now', span: '' })
    expect(from(-1)).toEqual({ state: 'now', span: '' })
    expect(from(-59)).toEqual({ state: 'now', span: '' })
  })

  it('says how late it is once a whole minute has passed, rounded down', () => {
    expect(from(-60)).toEqual({ state: 'late', span: '1 דק׳' })
    expect(from(-119)).toEqual({ state: 'late', span: '1 דק׳' })
    expect(from(-120)).toEqual({ state: 'late', span: '2 דק׳' })
    expect(from(-2 * 3600)).toEqual({ state: 'late', span: '2 שע׳' })
  })

  it('uses hours and days for the longer spans', () => {
    expect(from(90 * 60)).toEqual({ state: 'ahead', span: 'שעה ו-30 דק׳' })
    expect(from(-3 * 24 * 3600)).toEqual({ state: 'late', span: '3 ימים' })
  })

  it('takes a date, a number or an ISO string for either moment', () => {
    const due = '2026-10-16T09:10:00.000Z'
    expect(relativeTo(due, NOW)).toEqual({ state: 'ahead', span: '10 דק׳' })
    expect(relativeTo(Date.parse(due), NOW.getTime())).toEqual({ state: 'ahead', span: '10 דק׳' })
    expect(relativeTo(new Date(due), NOW.toISOString())).toEqual({ state: 'ahead', span: '10 דק׳' })
  })
})
