import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { card, findCard, lastUpsert, openCard, task, type } from '../../test/cardHarness'
import { DANA, OWNER } from '../../test/fakeGateway'
import type { Profile } from '../auth/types'

// The card of a task opens over any of the three pages: Today, the list and the calendar. It closes back to
// the page it was opened from, it can be opened on a moment that was clicked on the calendar, and a new task
// starts with the default reminder of the person who makes it.

const PAGES = [
  ['/today', 'היום'],
  ['/tasks', 'משימות'],
  ['/calendar', 'יומן'],
] as const

const heading = (name: string) => screen.getByRole('heading', { level: 2, name })

describe('the card over each page', () => {
  it.each(PAGES)('opens a new task over %s, and goes back to that page when it is closed', async (base, name) => {
    const { user } = openCard(`${base}/new`)
    expect(await screen.findByRole('dialog', { name: 'משימה חדשה' })).toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()

    await user.click(card().getByRole('button', { name: 'סגירה' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()
    expect(screen.getByRole('link', { name, current: 'page' })).toBeInTheDocument()
  })

  it.each(PAGES)('opens a task over %s, and goes back to that page on the Escape key', async (base, name) => {
    const { user } = openCard(`${base}/a`, [task('a', { title: 'לחזור ללקוח' })])
    expect(await screen.findByRole('dialog', { name: 'לחזור ללקוח' })).toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()
    expect(screen.getByRole('link', { name, current: 'page' })).toBeInTheDocument()
  })

  it.each(PAGES)('goes back to %s after a new task is saved there', async (base, name) => {
    const { user, backend } = openCard(`${base}/new`)
    await findCard()
    await type(user, 'כותרת', 'להתקשר ללקוח')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(backend.tasks.upserts).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()
  })

  it.each(PAGES)('goes back to %s from the notice for a task that is not there', async (base, name) => {
    const { user } = openCard(`${base}/nothing-like-it`)
    expect(await screen.findByText('המשימה לא נמצאה ברשימה.')).toBeInTheDocument()

    await user.click(card().getByRole('button', { name: 'סגירה' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(heading(name)).toBeInTheDocument()
  })

  it('goes back to the page after a task is deleted from its card', async () => {
    const { user } = openCard('/calendar/a', [task('a', { title: 'למחיקה' })])
    await findCard()
    await user.click(card().getByRole('button', { name: 'מחק משימה' }))
    await user.click(card().getByRole('button', { name: 'כן, למחוק' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(heading('יומן')).toBeInTheDocument()
  })
})

describe('the moment in the address of a new task', () => {
  it('fills the date and the time as they are on the wall in Jerusalem, in summer and in winter', async () => {
    openCard('/calendar/new?due=2026-10-20T11:30:00.000Z')
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('2026-10-20')
    expect(card().getByLabelText('שעה')).toHaveValue('14:30')
  })

  it('uses the offset of winter time when the moment is in winter', async () => {
    openCard('/calendar/new?due=2026-12-20T11:30:00.000Z')
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('2026-12-20')
    expect(card().getByLabelText('שעה')).toHaveValue('13:30')
  })

  it('moves to the next day when the moment is late at night in Jerusalem', async () => {
    openCard('/calendar/new?due=2026-10-20T21:15:00.000Z')
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('2026-10-21')
    expect(card().getByLabelText('שעה')).toHaveValue('00:15')
  })

  it('saves that moment with the task', async () => {
    const { user, backend } = openCard('/calendar/new?due=2026-10-20T11:30:00.000Z')
    await findCard()
    await type(user, 'כותרת', 'להתקשר ללקוח')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ due_at: '2026-10-20T11:30:00.000Z' }))
  })

  it('is not a change that the person made: closing the card does not ask whether to throw it away', async () => {
    const { user } = openCard('/calendar/new?due=2026-10-20T11:30:00.000Z')
    await findCard()
    await user.click(card().getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(heading('יומן')).toBeInTheDocument()
  })

  it.each([
    ['a word', 'banana'],
    ['nothing', ''],
    ['a day that does not exist', '2026-02-30T10:00:00Z'],
    ['a date without a time', '2026-10-20'],
    ['a time without a zone', '2026-10-20T11:30:00'],
  ])('is left out when it is %s: the date and the time are empty', async (_name, due) => {
    openCard(`/calendar/new?due=${encodeURIComponent(due)}`)
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('')
    expect(card().getByLabelText('שעה')).toHaveValue('')
  })

  it('is left out when the address has none', async () => {
    openCard('/today/new')
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('')
    expect(card().getByLabelText('שעה')).toHaveValue('')
  })

  it('does not change the date of a task that exists', async () => {
    openCard('/calendar/a?due=2026-10-20T11:30:00.000Z', [task('a', { due_at: '2026-10-16T06:00:00.000Z' })])
    await findCard()
    expect(card().getByLabelText('תאריך')).toHaveValue('2026-10-16')
    expect(card().getByLabelText('שעה')).toHaveValue('09:00')
  })
})

describe('the reminder of a new task', () => {
  const as = (default_remind_min: unknown): Profile => ({ ...DANA, default_remind_min }) as unknown as Profile

  it.each([
    [15, '15'],
    [5, '5'],
    [60, '60'],
    // Nought is "at the time of the task", a reminder like any other, and is kept.
    [0, '0'],
  ])('starts as the default reminder of the person, %s minutes', async (minutes, value) => {
    openCard('/today/new', [], { as: as(minutes) })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue(value)
  })

  it.each([30, 0])('is saved with the task: %s minutes', async (minutes) => {
    const { user, backend } = openCard('/calendar/new?due=2026-10-20T11:30:00.000Z', [], { as: as(minutes) })
    await findCard()
    await type(user, 'כותרת', 'להתקשר ללקוח')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ remind_min: minutes }))
  })

  it('is saved as none when the person has none', async () => {
    const { user, backend } = openCard('/calendar/new?due=2026-10-20T11:30:00.000Z', [], { as: as(undefined) })
    await findCard()
    await type(user, 'כותרת', 'להתקשר ללקוח')
    await type(user, 'שם לקוח', 'משה')
    await user.click(card().getByLabelText('אין שיחה ב-Glassix'))
    await user.click(card().getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(lastUpsert(backend)?.patch).toMatchObject({ remind_min: null }))
  })

  it.each([
    ['has no default reminder at all, as a profile from an old fixture does', undefined],
    ['has none, as the database says it', null],
    // A reminder after the time of the task makes no sense; the database does not allow one either.
    ['has a negative one', -5],
  ])('is none when the profile %s', async (_name, minutes) => {
    openCard('/today/new', [], { as: as(minutes) })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('')
  })

  it('is the default of the person who is signed in, and not of anybody else', async () => {
    openCard('/today/new', [], { as: { ...OWNER, default_remind_min: 5 } })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('5')
  })

  it('does not replace the reminder of a task that exists', async () => {
    openCard('/today/a', [task('a', { remind_min: 7 })], { as: as(15) })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('7')
  })

  it('does not put one on a task that exists and has none', async () => {
    openCard('/today/b', [task('b', { remind_min: null })], { as: as(15) })
    await findCard()
    expect(card().getByLabelText('תזכורת')).toHaveValue('')
  })

  it('is not a change that the person made: closing the card does not ask whether to throw it away', async () => {
    const { user } = openCard('/today/new', [], { as: as(15) })
    await findCard()
    await user.click(card().getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
