import { act, fireEvent, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CALENDAR_THREE_DAYS_QUERY, CALENDAR_WEEK_QUERY } from '../../lib/useMediaQuery'
import { DANA, OWNER } from '../../test/fakeGateway'
import { stubMatchMedia } from '../../test/matchMedia'
import { at, mountScheduled, scheduled, settle, MIN, NOW } from '../../test/remindersHarness'
import { statusTextColor, UNKNOWN_STATUS_COLOR } from '../tasks/display'
import { useTasks } from '../tasks/tasksContext'
import { HOUR_PX } from './calendar'
import { CalendarPage } from './CalendarPage'

// The calendar screen: a week on a laptop, three days on a tablet, a day on a phone, with the tasks in
// place by the wall clock of Jerusalem. The moment is 12:00 on Friday 16 October 2026 there.

/** Changes how wide the screen is: 7 days, 3 days or 1 day. */
function viewport(days: 7 | 3 | 1) {
  return stubMatchMedia((query) => (query === CALENDAR_WEEK_QUERY && days === 7) || (query === CALENDAR_THREE_DAYS_QUERY && days >= 3))
}

/** The way to ask the store for the tasks again, taken out for the test to use. */
const taken: { load: () => Promise<void> } = { load: async () => undefined }
function Grab() {
  const load = useTasks((state) => state.load)
  useEffect(() => {
    taken.load = load
  })
  return null
}

const page = (
  <>
    <Grab />
    <Routes>
      <Route path="calendar" element={<CalendarPage />}>
        <Route path="new" element={<p>a new card</p>} />
        <Route path=":id" element={<p>a card</p>} />
      </Route>
    </Routes>
  </>
)

async function mount(days: 7 | 3 | 1, tasks = week(), options: Parameters<typeof mountScheduled>[1] = {}) {
  const media = viewport(days)
  const mounted = await mountScheduled(page, { path: '/calendar', tasks, ...options })
  return { ...mounted, media }
}

/** A task of Dana's on the calendar: an hour long, with no reminder, unless it says otherwise. */
const onCalendar = (id: string, due: string, over = {}) => scheduled(id, { due_at: due, remind_min: null, duration_min: 60, ...over })

function week() {
  return [
    // 09:00 to 10:00, and 09:30 to 10:30 beside it, and 10:00 to 10:30 after the first: all open and in the past.
    onCalendar('t1', '2026-10-16T06:00:00.000Z', { title: 'להתקשר ללקוח', customer_name: 'רונית כהן', status_key: 'processing' }),
    onCalendar('t2', '2026-10-16T06:30:00.000Z', { title: 'לשלוח חשבונית' }),
    onCalendar('t4', '2026-10-16T07:00:00.000Z', { title: 'לחזור למשה', duration_min: 30 }),
    // 11:00, done.
    onCalendar('t3', '2026-10-16T08:00:00.000Z', { title: 'כבר בוצעה', done_at: at(-30) }),
    // 14:00 of somebody else, and 15:00 of nobody.
    onCalendar('t7', '2026-10-16T11:00:00.000Z', { title: 'של הבעלים', assignee_id: OWNER.id }),
    onCalendar('t8', '2026-10-16T12:00:00.000Z', { title: 'של אף אחד', assignee_id: null }),
    // Saturday 10:00, and the next week.
    onCalendar('t5', '2026-10-17T07:00:00.000Z', { title: 'ביום שבת' }),
    onCalendar('t6', '2026-10-20T07:00:00.000Z', { title: 'בשבוע הבא' }),
  ]
}

const column = (name: string) => screen.getByRole('group', { name })
const FRIDAY = 'יום שישי 16.10'
const block = (name: string | RegExp) => screen.getByRole('button', { name })
const blockStyle = (name: string | RegExp, property: string) => block(name).style.getPropertyValue(property)
const title = (text: string) => screen.getByText(text)
// The hours are for the eye: a screen reader gets the time of each task from the task, so the list is hidden from it, and its name is not available to a query.
const hours = () => {
  const list = screen.getAllByRole('list', { hidden: true }).find((candidate) => candidate.getAttribute('aria-label') === 'שעות היום') as HTMLElement
  return within(list).getAllByRole('listitem', { hidden: true }).map((item) => item.textContent)
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarPage: the days', () => {
  it('shows a week from Sunday on a wide screen, with the headers, today marked and the title', async () => {
    await mount(7)
    expect(screen.getByRole('heading', { level: 2, name: 'יומן' })).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(7)
    for (const header of ['א׳ 11.10', 'ב׳ 12.10', 'ג׳ 13.10', 'ד׳ 14.10', 'ה׳ 15.10', 'ו׳ 16.10', 'ש׳ 17.10']) expect(title(header)).toBeInTheDocument()
    expect(title('ו׳ 16.10')).toHaveAttribute('aria-current', 'date')
    expect(title('א׳ 11.10')).not.toHaveAttribute('aria-current')
    expect(title('11.10 – 17.10/2026')).toBeInTheDocument()
  })

  it('shows three days from today on a screen of middle width', async () => {
    await mount(3)
    expect(screen.getAllByRole('group', { name: /^יום / }).map((c) => c.getAttribute('aria-label'))).toEqual(['יום שישי 16.10', 'יום שבת 17.10', 'יום ראשון 18.10'])
    expect(title('16.10 – 18.10/2026')).toBeInTheDocument()
    expect(title('ו׳ 16.10')).toHaveAttribute('aria-current', 'date')
  })

  it('shows one day on a phone', async () => {
    await mount(1)
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(1)
    expect(title('יום ו׳ 16.10/2026')).toBeInTheDocument()
    expect(title('ו׳ 16.10')).toHaveAttribute('aria-current', 'date')
  })

  it('changes the number of days when the screen changes, and stays at the day that it was at', async () => {
    const { media } = await mount(7)
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(title('18.10 – 24.10/2026')).toBeInTheDocument()
    act(() => media.set(() => false))
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(1)
    expect(title('יום ו׳ 23.10/2026')).toBeInTheDocument()
  })

  it.each([
    [7, '11.10 – 17.10/2026', '04.10 – 10.10/2026', '18.10 – 24.10/2026'],
    [3, '16.10 – 18.10/2026', '13.10 – 15.10/2026', '19.10 – 21.10/2026'],
    [1, 'יום ו׳ 16.10/2026', 'יום ה׳ 15.10/2026', 'יום ש׳ 17.10/2026'],
  ] as const)('moves a range of %s days back and forth by its own width, and back to today', async (days, now, before, after) => {
    await mount(days)
    fireEvent.click(screen.getByRole('button', { name: 'הקודם' }))
    expect(title(before)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'היום' }))
    expect(title(now)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(title(after)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    fireEvent.click(screen.getByRole('button', { name: 'היום' }))
    expect(title(now)).toBeInTheDocument()
  })

  it('follows today when midnight passes, as long as nobody has moved it', async () => {
    // 23:59:30 on Friday in Jerusalem.
    vi.setSystemTime(new Date('2026-10-16T20:59:30.000Z'))
    await mount(1)
    expect(title('יום ו׳ 16.10/2026')).toBeInTheDocument()
    await settle(2 * MIN)
    expect(title('יום ש׳ 17.10/2026')).toBeInTheDocument()
    expect(title('ש׳ 17.10')).toHaveAttribute('aria-current', 'date')
  })

  it('stays where it was moved to when midnight passes', async () => {
    vi.setSystemTime(new Date('2026-10-16T20:59:30.000Z'))
    await mount(1)
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(title('יום ש׳ 17.10/2026')).toBeInTheDocument()
    await settle(2 * MIN)
    expect(title('יום ש׳ 17.10/2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    await settle(2 * MIN)
    expect(title('יום א׳ 18.10/2026')).toBeInTheDocument()
  })

  it('follows today again once it has been brought back to it', async () => {
    vi.setSystemTime(new Date('2026-10-16T20:59:30.000Z'))
    await mount(1)
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    fireEvent.click(screen.getByRole('button', { name: 'היום' }))
    expect(title('יום ו׳ 16.10/2026')).toBeInTheDocument()
    await settle(2 * MIN)
    expect(title('יום ש׳ 17.10/2026')).toBeInTheDocument()
  })

  it('shows the tasks of the range that it moves to', async () => {
    await mount(7)
    expect(screen.queryByRole('button', { name: /בשבוע הבא/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(block(/בשבוע הבא/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /להתקשר ללקוח/ })).not.toBeInTheDocument()
  })

  it('has a button for a new task, which opens its card over the calendar', async () => {
    await mount(7)
    const link = screen.getByRole('link', { name: 'משימה חדשה' })
    expect(link).toHaveAttribute('href', '/calendar/new')
    fireEvent.click(link)
    expect(screen.getByText('a new card')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'יומן' })).toBeInTheDocument()
  })
})

describe('CalendarPage: the hours', () => {
  it('are seven to twenty-one when no task is outside them', async () => {
    await mount(7)
    const labels = hours()
    expect(labels[0]).toBe('07:00')
    expect(labels.at(-1)).toBe('20:00')
    expect(labels).toHaveLength(14)
  })

  it('start earlier and end later for a task that is outside them', async () => {
    await mount(7, [
      ...week(),
      // 05:30 and 22:10 in Jerusalem.
      onCalendar('early', '2026-10-16T02:30:00.000Z', { title: 'מוקדם' }),
      onCalendar('late', '2026-10-16T19:10:00.000Z', { title: 'מאוחר' }),
    ])
    const labels = hours()
    expect(labels[0]).toBe('05:00')
    expect(labels.at(-1)).toBe('23:00')
  })
})

describe('CalendarPage: a task', () => {
  it('is a button at the place and the height of its start and its length, named by its time, its title and its customer', async () => {
    await mount(7)
    // 09:00 for an hour: two hours below the first one, and as high as one.
    expect(blockStyle('09:00 להתקשר ללקוח, רונית כהן', '--top')).toBe(`${2 * HOUR_PX}px`)
    expect(blockStyle('09:00 להתקשר ללקוח, רונית כהן', '--height')).toBe(`${HOUR_PX}px`)
    // 10:00 for half an hour.
    expect(blockStyle('10:00 לחזור למשה', '--top')).toBe(`${3 * HOUR_PX}px`)
    expect(blockStyle('10:00 לחזור למשה', '--height')).toBe(`${HOUR_PX / 2}px`)
  })

  it('is on the column of its day, and on no other', async () => {
    await mount(7)
    expect(within(column(FRIDAY)).getByRole('button', { name: /להתקשר ללקוח/ })).toBeInTheDocument()
    expect(within(column('יום שבת 17.10')).getByRole('button', { name: /ביום שבת/ })).toBeInTheDocument()
    expect(within(column('יום שבת 17.10')).queryByRole('button', { name: /להתקשר ללקוח/ })).not.toBeInTheDocument()
  })

  it('has the colour of its status, with the text colour that reads on it', async () => {
    await mount(7)
    expect(block(/להתקשר ללקוח/)).toHaveStyle({ backgroundColor: '#22a559', color: statusTextColor('#22a559') })
  })

  it('is grey when its status is one that the directory does not know', async () => {
    await mount(7, [onCalendar('a', '2026-10-16T06:00:00.000Z', { title: 'סטטוס זר', status_key: 'mystery' })])
    expect(block(/סטטוס זר/)).toHaveStyle({ backgroundColor: UNKNOWN_STATUS_COLOR })
  })

  it('sits beside the ones that overlap it, each in its own column of the cluster', async () => {
    await mount(7)
    expect([blockStyle(/להתקשר ללקוח/, '--column'), blockStyle(/להתקשר ללקוח/, '--columns')]).toEqual(['0', '2'])
    expect([blockStyle(/לשלוח חשבונית/, '--column'), blockStyle(/לשלוח חשבונית/, '--columns')]).toEqual(['1', '2'])
    expect([blockStyle(/לחזור למשה/, '--column'), blockStyle(/לחזור למשה/, '--columns')]).toEqual(['0', '2'])
    // The one at eleven touches none of them, so it has the whole width.
    expect([blockStyle(/כבר בוצעה/, '--column'), blockStyle(/כבר בוצעה/, '--columns')]).toEqual(['0', '1'])
  })

  it('is marked late when it is open and its time has passed, muted when it is done, and plain when it is still to come', async () => {
    await mount(7)
    // (The task that is still to come is nobody's, so everybody's tasks are shown to look at all of them.)
    fireEvent.change(screen.getByLabelText('שיוך'), { target: { value: 'all' } })
    expect(block(/לחזור למשה/)).toHaveClass('is-late')
    expect(block(/כבר בוצעה/)).toHaveClass('is-done')
    expect(block(/כבר בוצעה/)).not.toHaveClass('is-late')
    expect(block(/של אף אחד/)).not.toHaveClass('is-late')
    expect(block(/של אף אחד/)).not.toHaveClass('is-done')
  })

  it('turns late when its time passes while the screen is open', async () => {
    await mount(7, [onCalendar('a', at(10), { title: 'עוד מעט' })])
    expect(block(/עוד מעט/)).not.toHaveClass('is-late')
    await settle(11 * MIN)
    expect(block(/עוד מעט/)).toHaveClass('is-late')
  })

  it('opens its card over the calendar when it is clicked', async () => {
    await mount(7)
    fireEvent.click(block(/להתקשר ללקוח/))
    expect(screen.getByTestId('where')).toHaveTextContent('/calendar/t1')
    expect(screen.getByText('a card')).toBeInTheDocument()
  })

  it('does not open a new task when it is clicked, as a click on the place under it would', async () => {
    await mount(7)
    fireEvent.click(block(/להתקשר ללקוח/), { clientY: 2 * HOUR_PX })
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/calendar\/t1$/)
  })

  it('is not shown when it is not the person\'s own, until everybody is asked for', async () => {
    await mount(7)
    expect(screen.queryByRole('button', { name: /של הבעלים/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /של אף אחד/ })).not.toBeInTheDocument()
  })
})

describe('CalendarPage: a click on an empty place', () => {
  it.each([
    // The offset from the top of the column, in pixels, and the half hour that it means.
    [2 * HOUR_PX + 0.5 * HOUR_PX, '2026-10-16T06:30:00.000Z'],
    [2 * HOUR_PX + 0.24 * HOUR_PX, '2026-10-16T06:00:00.000Z'],
    [2 * HOUR_PX + 0.26 * HOUR_PX, '2026-10-16T06:30:00.000Z'],
    [0, '2026-10-16T04:00:00.000Z'],
    [10 * HOUR_PX, '2026-10-16T14:00:00.000Z'],
  ])('opens a new task at the half hour that is nearest to %s px from the top', async (y, due) => {
    await mount(7)
    fireEvent.click(column(FRIDAY), { clientY: y })
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent(due)}`)
    expect(screen.getByText('a new card')).toBeInTheDocument()
  })

  it('counts the hours from the first one that is shown', async () => {
    await mount(7, [...week(), onCalendar('early', '2026-10-16T02:30:00.000Z', { title: 'מוקדם' })])
    // The day starts at 05:00 now, so the top of the column is 05:00.
    fireEvent.click(column(FRIDAY), { clientY: 0 })
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent('2026-10-16T02:00:00.000Z')}`)
  })

  it('counts from the top of the column, which is above the top of the screen when the calendar has been scrolled', async () => {
    await mount(7)
    const target = column(FRIDAY)
    // The column starts 96 px above the screen: a click 24 px down the screen is 120 px down the column, at half past nine.
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: -96 } as DOMRect)
    fireEvent.click(target, { clientY: 24 })
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent('2026-10-16T06:30:00.000Z')}`)
  })

  it('opens it on the day of the column that was clicked', async () => {
    await mount(7)
    fireEvent.click(column('יום שבת 17.10'), { clientY: 2 * HOUR_PX })
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent('2026-10-17T06:00:00.000Z')}`)
  })

  it('has a button for each day that opens a new task on that day, whichever it is', async () => {
    await mount(7)
    fireEvent.click(screen.getByRole('button', { name: 'משימה חדשה ביום שבת 17.10' }))
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent('2026-10-17T06:00:00.000Z')}`)
  })

  it('has a button for each day that is reached from the keyboard, for a new task at nine', async () => {
    await mount(7)
    const button = screen.getByRole('button', { name: 'משימה חדשה ביום שישי 16.10' })
    expect(screen.getAllByRole('button', { name: /^משימה חדשה ביום / })).toHaveLength(7)
    fireEvent.click(button)
    expect(screen.getByTestId('where')).toHaveTextContent(`/calendar/new?due=${encodeURIComponent('2026-10-16T06:00:00.000Z')}`)
  })
})

describe('CalendarPage: the line of now', () => {
  const lines = () => screen.queryAllByRole('separator', { name: 'עכשיו' })

  it('is on the column of today only, at the height of the time', async () => {
    await mount(7)
    expect(lines()).toHaveLength(1)
    expect(within(column(FRIDAY)).getByRole('separator', { name: 'עכשיו' })).toBeInTheDocument()
    // 12:00 is five hours below the first one that is shown.
    expect(lines()[0].style.getPropertyValue('--top')).toBe(`${5 * HOUR_PX}px`)
  })

  it('moves when the clock moves', async () => {
    await mount(7)
    await settle(30 * MIN)
    expect(lines()[0].style.getPropertyValue('--top')).toBe(`${5.5 * HOUR_PX}px`)
  })

  it('is not there when the range does not have today in it', async () => {
    await mount(7)
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    expect(lines()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'היום' }))
    expect(lines()).toHaveLength(1)
  })

  it('is not there when the time is after the hours that are shown', async () => {
    vi.setSystemTime(new Date('2026-10-16T20:30:00Z'))
    await mount(7)
    expect(lines()).toHaveLength(0)
  })

  it('is not there when the time is before the hours that are shown', async () => {
    // 06:00 in Jerusalem, and the hours start at seven.
    vi.setSystemTime(new Date('2026-10-16T03:00:00Z'))
    await mount(7)
    expect(lines()).toHaveLength(0)
  })

  it('is at the right height after the first hour shown has moved', async () => {
    await mount(7, [...week(), onCalendar('early', '2026-10-16T02:30:00.000Z', { title: 'מוקדם' })])
    expect(lines()[0].style.getPropertyValue('--top')).toBe(`${7 * HOUR_PX}px`)
  })
})

describe('CalendarPage: whose tasks', () => {
  const choose = (value: string) => fireEvent.change(screen.getByLabelText('שיוך'), { target: { value } })
  const names = () => screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((label) => label !== null && /^\d\d:\d\d /.test(label))

  it('offers my tasks, everybody, nobody and each person, and opens on my tasks', async () => {
    await mount(7)
    const select = screen.getByLabelText('שיוך')
    expect(select).toHaveValue('me')
    expect(within(select).getAllByRole('option').map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ['המשימות שלי', 'me'],
      ['כולם', 'all'],
      ['ללא שיוך', 'none'],
      ['הבעלים', OWNER.id],
      ['דנה', DANA.id],
    ])
  })

  it('does not offer a person who has left', async () => {
    await mount(7, week(), {
      backend: (fake) => {
        fake.directory.profiles = [...fake.directory.profiles, { ...DANA, id: 'u-gone', display_name: 'אבי שעזב', is_active: false }]
      },
    })
    const options = within(screen.getByLabelText('שיוך')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('דנה')
    expect(options).not.toContain('אבי שעזב')
  })

  it('shows my tasks at first, and the other sets when they are asked for', async () => {
    await mount(7)
    expect(names()).toHaveLength(5)
    choose('all')
    expect(names()).toHaveLength(7)
    choose('none')
    expect(names()).toEqual(['15:00 של אף אחד'])
    choose(OWNER.id)
    expect(names()).toEqual(['14:00 של הבעלים'])
    choose('me')
    expect(names()).toHaveLength(5)
  })
})

describe('CalendarPage: the first view', () => {
  it('is scrolled so that the current hour is in sight', async () => {
    await mount(7)
    // 12:00 is at 5 hours; the view starts an hour above it.
    expect(screen.getByRole('region', { name: 'לוח המשימות' }).scrollTop).toBe(4 * HOUR_PX)
  })

  it('is scrolled once, and does not take the person back when the screen is drawn again', async () => {
    await mount(7)
    const region = screen.getByRole('region', { name: 'לוח המשימות' })
    region.scrollTop = 17
    fireEvent.click(screen.getByRole('button', { name: 'הבא' }))
    fireEvent.change(screen.getByLabelText('שיוך'), { target: { value: 'all' } })
    await settle(2 * MIN)
    expect(screen.getByRole('region', { name: 'לוח המשימות' }).scrollTop).toBe(17)
  })

  it('is not scrolled when the day has not got to the first hour', async () => {
    vi.setSystemTime(new Date('2026-10-16T03:00:00Z'))
    await mount(7)
    expect(screen.getByRole('region', { name: 'לוח המשימות' }).scrollTop).toBe(0)
  })
})

describe('CalendarPage: when there is nothing, or something wrong', () => {
  it('says that there are no tasks in the range, and still has the days to click on', async () => {
    await mount(7, [])
    expect(screen.getByText('אין משימות בטווח הזה. אפשר ללחוץ על מקום ביומן כדי להוסיף משימה.')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(7)
  })

  it('says it also when the tasks are all in another range, or for somebody else', async () => {
    await mount(7, [onCalendar('a', '2026-10-30T07:00:00.000Z'), onCalendar('b', '2026-10-16T07:00:00.000Z', { assignee_id: OWNER.id })])
    expect(screen.getByText(/^אין משימות בטווח הזה/)).toBeInTheDocument()
  })

  it('does not say it when there are tasks in the range', async () => {
    await mount(7)
    expect(screen.queryByText(/^אין משימות בטווח הזה/)).not.toBeInTheDocument()
  })

  it('says that it is loading until the tasks have come', async () => {
    let finish: () => void = () => undefined
    await mount(7, week(), {
      wait: false,
      backend: (fake) => {
        const load = fake.tasks.gateway.loadInitial
        fake.tasks.gateway.loadInitial = (since) => new Promise((resolve) => (finish = () => resolve(load(since))))
      },
    })
    await settle(0)
    expect(screen.getByText('טוען משימות…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('group', { name: /^יום / })).not.toBeInTheDocument()
    finish()
    await settle()
    expect(screen.queryByText('טוען משימות…')).not.toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(7)
  })

  it('says what went wrong, and tries again when asked', async () => {
    await mount(7, week(), { backend: (fake) => fake.tasks.failNext(new TypeError('Failed to fetch')) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^יום / })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }))
    await settle()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(7)
  })

  it('keeps the calendar and says so when the tasks cannot be brought up to date', async () => {
    const { fake } = await mount(7)
    fake.tasks.failNext(new TypeError('Failed to fetch'))
    await act(async () => void (await taken.load()))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^יום / })).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }))
    await settle()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
