import { describe, expect, it } from 'vitest'
import { dialHref, formatDue, statusTextColor, taskTitle, TEXT_ON_DARK, TEXT_ON_LIGHT } from './display'
import { newTask } from './model'

// Thursday 15 October 2026, 15:00 in Jerusalem (summer time, UTC+3).
const NOW = new Date('2026-10-15T12:00:00.000Z')

describe('formatDue', () => {
  it('says today, tomorrow and yesterday in words, with the time on the wall in Jerusalem', () => {
    expect(formatDue('2026-10-15T11:30:00.000Z', NOW)).toBe('היום · 14:30')
    expect(formatDue('2026-10-16T06:00:00.000Z', NOW)).toBe('מחר · 09:00')
    expect(formatDue('2026-10-14T06:00:00.000Z', NOW)).toBe('אתמול · 09:00')
  })

  it('counts the days by the calendar of Jerusalem, not by hours and not by the date in UTC', () => {
    // 00:30 on Friday in Jerusalem is still Thursday in UTC, and it is tomorrow for the person.
    expect(formatDue('2026-10-15T21:30:00.000Z', NOW)).toBe('מחר · 00:30')
    // 23:50 tonight is today, though it is in the evening of the same UTC day.
    expect(formatDue('2026-10-15T20:50:00.000Z', NOW)).toBe('היום · 23:50')
    // The same calendar day, whatever the hour of "now".
    expect(formatDue('2026-10-15T21:30:00.000Z', new Date('2026-10-15T21:10:00.000Z'))).toBe('היום · 00:30')
  })

  it('gives the weekday and the date for other days of the year, without a leading zero', () => {
    expect(formatDue('2026-10-20T06:00:00.000Z', NOW)).toBe('ג׳ 20.10 · 09:00')
    expect(formatDue('2026-12-01T07:00:00.000Z', NOW)).toBe('ג׳ 1.12 · 09:00')
    expect(formatDue('2026-10-18T06:00:00.000Z', NOW)).toBe('א׳ 18.10 · 09:00')
    expect(formatDue('2026-10-17T06:00:00.000Z', NOW)).toBe('ש׳ 17.10 · 09:00')
    expect(formatDue('2026-10-09T06:00:00.000Z', NOW)).toBe('ו׳ 9.10 · 09:00')
  })

  it('gives the year, and no weekday, for a day in another year', () => {
    expect(formatDue('2027-01-05T07:00:00.000Z', NOW)).toBe('5.1.2027 · 09:00')
    expect(formatDue('2025-12-31T07:00:00.000Z', NOW)).toBe('31.12.2025 · 09:00')
  })

  it('knows the winter time of Jerusalem', () => {
    expect(formatDue('2026-12-01T07:00:00.000Z', NOW)).toContain('09:00')
    expect(formatDue('2026-07-01T06:00:00.000Z', NOW)).toContain('09:00')
  })

  it('says nothing for a moment that is not a date', () => {
    expect(formatDue('garbage', NOW)).toBe('')
    expect(formatDue('', NOW)).toBe('')
  })
})

describe('statusTextColor', () => {
  it('puts dark text on a light colour and white text on a dark one', () => {
    expect(statusTextColor('#ffffff')).toBe(TEXT_ON_LIGHT)
    expect(statusTextColor('#e9a45c')).toBe(TEXT_ON_LIGHT)
    expect(statusTextColor('#22a559')).toBe(TEXT_ON_LIGHT)
    expect(statusTextColor('#000000')).toBe(TEXT_ON_DARK)
    expect(statusTextColor('#3a4250')).toBe(TEXT_ON_DARK)
    expect(statusTextColor('#c2185b')).toBe(TEXT_ON_DARK)
    expect(statusTextColor('#1e88c9')).toBe(TEXT_ON_LIGHT)
  })

  it('reads the short form and capital letters', () => {
    expect(statusTextColor('#fff')).toBe(TEXT_ON_LIGHT)
    expect(statusTextColor('#000')).toBe(TEXT_ON_DARK)
    expect(statusTextColor('#3A4250')).toBe(TEXT_ON_DARK)
  })

  it('takes dark text for what is not a colour', () => {
    for (const bad of ['', 'red', '#12', '#gggggg', '22a559', '#22a5591']) expect(statusTextColor(bad)).toBe(TEXT_ON_LIGHT)
  })
})

describe('dialHref', () => {
  it('keeps the digits, and a plus at the start', () => {
    expect(dialHref('050-123-4567')).toBe('tel:0501234567')
    expect(dialHref('+972 50 123 4567')).toBe('tel:+972501234567')
    expect(dialHref('(02) 123-4567')).toBe('tel:021234567')
    expect(dialHref(' 972501234567 ')).toBe('tel:972501234567')
  })

  it('keeps a plus only at the start, and only one', () => {
    expect(dialHref('050+1234567')).toBe('tel:0501234567')
    expect(dialHref('++972501234567')).toBe('tel:+972501234567')
  })

  it('is nothing when there is no number to dial', () => {
    expect(dialHref('')).toBeNull()
    expect(dialHref('אין')).toBeNull()
    expect(dialHref('+')).toBeNull()
    expect(dialHref('---')).toBeNull()
  })
})

describe('taskTitle', () => {
  const task = (patch: Partial<ReturnType<typeof newTask>>) => ({ ...newTask('u', 'a'), ...patch })

  it('is the title that was typed', () => {
    expect(taskTitle(task({ title: '  לחזור אל רונית ', order_number: '77' }))).toBe('לחזור אל רונית')
  })

  it('is made from the order number or the name of the customer when there is no title', () => {
    expect(taskTitle(task({ order_number: '#77' }))).toBe('טיפול בהזמנה #77')
    expect(taskTitle(task({ customer_name: 'רונית כהן' }))).toBe('לחזור אל רונית כהן')
  })

  it('says that there is no title when there is nothing to make one from', () => {
    expect(taskTitle(task({}))).toBe('ללא כותרת')
  })
})
