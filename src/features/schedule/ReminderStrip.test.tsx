import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { at, mountScheduled, scheduled, settle, MIN, NOW } from '../../test/remindersHarness'
import { OWNER } from '../../test/fakeGateway'
import { ReminderStrip } from './ReminderStrip'

// The strip of reminders is above every page: the reminders of the signed-in person that are on now,
// at most three, each with how long it is to the task or how late it is, a button for done and one to
// be reminded again in ten minutes.

const strip = () => screen.queryByRole('region', { name: 'תזכורות פעילות' })
const items = () => within(screen.getByRole('region', { name: 'תזכורות פעילות' })).getAllByRole('listitem')
const said = () => screen.getByRole('status').textContent

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ReminderStrip: what it shows', () => {
  it('lists the reminders that are on, the earliest task first, and leaves out the rest', async () => {
    await mountScheduled(<ReminderStrip />, {
      tasks: [
        scheduled('a', { due_at: at(10) }),
        scheduled('b', { due_at: at(5) }),
        // Not for this person, not yet, done, and without a reminder: none of these is on.
        scheduled('c', { due_at: at(10), assignee_id: OWNER.id }),
        scheduled('d', { due_at: at(60) }),
        scheduled('e', { due_at: at(10), done_at: at(-1) }),
        scheduled('f', { due_at: at(10), remind_min: null }),
      ],
    })
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה b', 'משימה a'])
  })

  it('says how long it is to the task, that it is now, or how late it is', async () => {
    await mountScheduled(<ReminderStrip />, {
      tasks: [scheduled('late', { due_at: at(-5) }), scheduled('now', { due_at: at(0) }), scheduled('ahead', { due_at: at(10) })],
    })
    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringContaining('באיחור של 5 דק׳'),
      expect.stringContaining('עכשיו'),
      expect.stringContaining('בעוד 10 דק׳'),
    ])
  })

  it('keeps the words up to date as the minutes pass', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) })] })
    expect(items()[0]).toHaveTextContent('בעוד 10 דק׳')
    await settle(5 * MIN)
    expect(items()[0]).toHaveTextContent('בעוד 5 דק׳')
    await settle(5 * MIN)
    expect(items()[0]).toHaveTextContent('עכשיו')
    await settle(3 * MIN)
    expect(items()[0]).toHaveTextContent('באיחור של 3 דק׳')
  })

  it('has the title as a link to the card of the task over Today, and goes there when it is clicked', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) })], path: '/tasks' })
    const link = screen.getByRole('link', { name: 'משימה a' })
    expect(link).toHaveAttribute('href', '/today/a')
    fireEvent.click(link)
    expect(screen.getByTestId('where')).toHaveTextContent('/today/a')
  })

  it('names a task without a title as one without a title', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { title: '', order_number: '', customer_name: '', due_at: at(10) })] })
    expect(screen.getByRole('link', { name: 'ללא כותרת' })).toBeInTheDocument()
  })

  it('shows nothing, and says nothing, when there is no reminder', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('d', { due_at: at(60) })] })
    expect(strip()).not.toBeInTheDocument()
    expect(said()).toBe('')
  })

  it('shows the reminders as a list in a named region', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) })] })
    const region = screen.getByRole('region', { name: 'תזכורות פעילות' })
    expect(within(region).getByRole('list')).toBeInTheDocument()
  })
})

describe('ReminderStrip: more than three', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => scheduled('t' + i, { due_at: at(1 + i) }))

  it('shows three, and says how many more there are, with a link to Today', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: many(5) })
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה t0', 'משימה t1', 'משימה t2'])
    const more = screen.getByRole('link', { name: 'ועוד 2 תזכורות פעילות' })
    expect(more).toHaveAttribute('href', '/today')
  })

  it('says "one more" in the singular', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: many(4) })
    expect(items()).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'ועוד תזכורת פעילה אחת' })).toHaveAttribute('href', '/today')
  })

  it('has no link for more when there are three or fewer', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: many(3) })
    expect(items()).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /ועוד/ })).not.toBeInTheDocument()
  })

  it('brings the next one up when one is done', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: many(4) })
    fireEvent.click(screen.getByRole('button', { name: 'בוצע: משימה t0' }))
    await settle()
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה t1', 'משימה t2', 'משימה t3'])
    expect(screen.queryByRole('link', { name: /ועוד/ })).not.toBeInTheDocument()
  })
})

describe('ReminderStrip: done', () => {
  it('marks the task done through the store, and the reminder goes', async () => {
    const { fake } = await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) }), scheduled('b', { due_at: at(14) })] })
    fireEvent.click(screen.getByRole('button', { name: 'בוצע: משימה a' }))
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'a', patch: { done_at: NOW.toISOString() } }])
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה b'])
  })

  it('has a button for each reminder, named after its task', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) }), scheduled('b', { due_at: at(14) })] })
    expect(screen.getAllByRole('button', { name: /^בוצע: / }).map((b) => b.textContent)).toEqual(['בוצע', 'בוצע'])
    expect(screen.getByRole('button', { name: 'בוצע: משימה b' })).toBeInTheDocument()
  })
})

describe('ReminderStrip: snooze', () => {
  const quiet = 'אזכיר שוב בעוד 10 דקות'

  it('hides the reminder, says when it comes again, and brings it back after ten minutes', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) }), scheduled('b', { due_at: at(14) })] })
    fireEvent.click(screen.getByRole('button', { name: 'נודניק 10 דק׳: משימה a' }))
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה b'])
    expect(said()).toBe(quiet)

    await settle(9 * MIN)
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה b'])
    await settle(2 * MIN)
    expect(items().map((item) => within(item).getByRole('link').textContent)).toEqual(['משימה a', 'משימה b'])
  })

  it('takes the words away after a few seconds', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) }), scheduled('b', { due_at: at(14) })] })
    fireEvent.click(screen.getByRole('button', { name: 'נודניק 10 דק׳: משימה a' }))
    expect(said()).toBe(quiet)
    await settle(5_000)
    expect(said()).toBe(quiet)
    await settle(2_000)
    expect(said()).toBe('')
  })

  it('says it even when the last reminder was the one that was put off, and the strip is gone', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) })] })
    fireEvent.click(screen.getByRole('button', { name: 'נודניק 10 דק׳: משימה a' }))
    expect(strip()).not.toBeInTheDocument()
    expect(said()).toBe(quiet)
  })

  it('counts the ten minutes from the moment of the second snooze, not the first', async () => {
    await mountScheduled(<ReminderStrip />, { tasks: [scheduled('a', { due_at: at(10) })] })
    fireEvent.click(screen.getByRole('button', { name: 'נודניק 10 דק׳: משימה a' }))
    await settle(10 * MIN + 1_000)
    fireEvent.click(screen.getByRole('button', { name: 'נודניק 10 דק׳: משימה a' }))
    await settle(9 * MIN)
    expect(strip()).not.toBeInTheDocument()
    await settle(2 * MIN)
    expect(strip()).toBeInTheDocument()
  })
})
