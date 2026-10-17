import { act, fireEvent, screen, within } from '@testing-library/react'
import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DANA, OWNER } from '../../test/fakeGateway'
import { at, mountScheduled, scheduled, settle, MIN, NOW } from '../../test/remindersHarness'
import { createMemoryNotifier } from './notifier'
import { snoozeKey } from './snooze'
import { useTasks } from '../tasks/tasksContext'
import { TodayPage } from './TodayPage'
import { scopeKey } from './todayScope'

// The Today screen: five counts, the queue of what is late and what is left of today, the tasks without
// a time, and how much work each person has. The moment is 12:00 on Friday in Jerusalem; today ends at
// 21:00 UTC, which is 720 minutes on.


/** What the store can do, taken out for the test to use: ask for the tasks again, and delete one. */
const taken: { load: () => Promise<void>; softDelete: (id: string, deleted: boolean) => void } = { load: async () => undefined, softDelete: () => undefined }
function Grab() {
  const load = useTasks((state) => state.load)
  const softDelete = useTasks((state) => state.softDelete)
  useEffect(() => {
    taken.load = load
    taken.softDelete = softDelete
  })
  return null
}

const page = (
  <>
    <Grab />
    <Routes>
      <Route path="today" element={<TodayPage />}>
        <Route path="new" element={<p>a new card</p>} />
        <Route path=":id" element={<p>a card</p>} />
      </Route>
    </Routes>
  </>
)

const mount = (options: Parameters<typeof mountScheduled>[1] = {}) => mountScheduled(page, { path: '/today', ...options })

/** The number under a label of the five counts. */
const count = (label: string) => {
  const term = screen.getByText(label, { selector: 'dt' })
  return within(term.parentElement as HTMLElement).getByRole('definition').textContent
}
const queue = () => screen.getByRole('list', { name: 'התור להיום' })
const queueTitles = () => within(queue()).getAllByRole('listitem').map((item) => within(item).getAllByRole('link')[0].textContent)
const item = (title: string) => within(queue()).getByRole('link', { name: title }).closest('li') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

/** A week of tasks, in which every count and every list has something to show. */
function week() {
  return [
    scheduled('late1', { due_at: at(-120), title: 'להתקשר ללקוח', priority: 'high', order_number: '10442', customer_name: 'רונית כהן', customer_phone: '050-123-4567', status_key: 'cargo' }),
    scheduled('late2', { due_at: at(-10), title: 'לשלוח חשבונית' }),
    scheduled('soon1', { due_at: at(45), title: 'לאסוף מקרר' }),
    scheduled('later1', { due_at: at(300), title: 'לחזור למשה' }),
    scheduled('tomorrow1', { due_at: at(24 * 60), title: 'למחר' }),
    scheduled('undated1', { due_at: null, remind_min: null, title: 'בלי מועד א', created_at: '2026-10-02T08:00:00.000Z' }),
    scheduled('undated2', { due_at: null, remind_min: null, title: 'בלי מועד ב', created_at: '2026-10-01T08:00:00.000Z' }),
    scheduled('done1', { due_at: at(-200), done_at: at(-30), title: 'בוצעה היום' }),
    scheduled('done0', { due_at: at(-3000), done_at: at(-1500), title: 'בוצעה אתמול' }),
    scheduled('theirs1', { due_at: at(-60), assignee_id: OWNER.id, title: 'של הבעלים' }),
    scheduled('nobody1', { due_at: at(100), assignee_id: null, title: 'של אף אחד' }),
    scheduled('gone', { due_at: at(-5), deleted_at: at(-4), title: 'נמחקה' }),
  ]
}

describe('TodayPage: the counts', () => {
  it('has the heading, and the five counts with the labels of the old app, for my tasks', async () => {
    await mount({ tasks: week() })
    expect(screen.getByRole('heading', { level: 2, name: 'היום' })).toBeInTheDocument()
    expect(count('באיחור')).toBe('2')
    expect(count('נותרו להיום')).toBe('2')
    expect(count('בשעה הקרובה')).toBe('1')
    expect(count('ללא מועד')).toBe('2')
    expect(count('בוצעו היום')).toBe('1')
  })

  it('counts everybody\'s tasks when the switch is on "everybody"', async () => {
    await mount({ tasks: week() })
    fireEvent.click(screen.getByRole('button', { name: 'כולם' }))
    expect(count('באיחור')).toBe('3')
    expect(count('נותרו להיום')).toBe('3')
    expect(count('בשעה הקרובה')).toBe('1')
    expect(count('ללא מועד')).toBe('2')
    expect(count('בוצעו היום')).toBe('1')
  })

  it('turns the late count red when something is late, and leaves it plain when nothing is', async () => {
    await mount({ tasks: week() })
    const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement
    expect(tile('באיחור')).toHaveClass('is-late')
    expect(tile('נותרו להיום')).not.toHaveClass('is-late')
  })

  it('leaves the late count plain when nothing is late', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(10) })] })
    expect(screen.getByText('באיחור', { selector: 'dt' }).parentElement).not.toHaveClass('is-late')
  })

  it('moves a task from "left today" to "late" when its time passes while the screen is open', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(10) })] })
    expect(count('באיחור')).toBe('0')
    expect(count('נותרו להיום')).toBe('1')
    expect(count('בשעה הקרובה')).toBe('1')
    await settle(11 * MIN)
    expect(count('באיחור')).toBe('1')
    expect(count('נותרו להיום')).toBe('0')
    expect(count('בשעה הקרובה')).toBe('0')
  })
})

describe('TodayPage: the queue', () => {
  it('has the late tasks first and then what is left of today, each in the order of its time, and nothing else', async () => {
    await mount({ tasks: week() })
    expect(queueTitles()).toEqual(['להתקשר ללקוח', 'לשלוח חשבונית', 'לאסוף מקרר', 'לחזור למשה'])
  })

  it('shows for each task when it is due, and how long it is to it or how late it is', async () => {
    await mount({ tasks: week() })
    expect(item('להתקשר ללקוח')).toHaveTextContent('היום · 10:00')
    expect(item('להתקשר ללקוח')).toHaveTextContent('באיחור 2 שע׳')
    expect(item('לשלוח חשבונית')).toHaveTextContent('באיחור 10 דק׳')
    expect(item('לאסוף מקרר')).toHaveTextContent('היום · 12:45')
    expect(item('לאסוף מקרר')).toHaveTextContent('בעוד 45 דק׳')
    expect(item('לחזור למשה')).toHaveTextContent('בעוד 5 שע׳')
  })

  it('says "now" for a task that is due this very minute', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(0), title: 'לחתום' })] })
    expect(item('לחתום')).toHaveTextContent('עכשיו')
  })

  it('has the title as a link to the card over Today', async () => {
    await mount({ tasks: week() })
    expect(within(queue()).getByRole('link', { name: 'לאסוף מקרר' })).toHaveAttribute('href', '/today/soon1')
  })

  it('marks what is urgent, and shows the status, the order number, the customer, the phone and who has it', async () => {
    await mount({ tasks: week() })
    const first = item('להתקשר ללקוח')
    expect(within(first).getByText('דחוף')).toBeInTheDocument()
    expect(within(first).getByText('Send to CARGO')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'העתקת מספר הזמנה: 10442' })).toBeInTheDocument()
    expect(within(first).getByText('רונית כהן')).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'העתקת טלפון: 050-123-4567' })).toBeInTheDocument()
    expect(first).toHaveTextContent('בטיפול של דנה')
    expect(within(item('לשלוח חשבונית')).queryByText('דחוף')).not.toBeInTheDocument()
  })

  it('says who has a task of somebody else when the switch is on "everybody", and that nobody has one that has no one', async () => {
    await mount({ tasks: week() })
    fireEvent.click(screen.getByRole('button', { name: 'כולם' }))
    expect(queueTitles()).toEqual(['להתקשר ללקוח', 'של הבעלים', 'לשלוח חשבונית', 'לאסוף מקרר', 'של אף אחד', 'לחזור למשה'])
    expect(item('של הבעלים')).toHaveTextContent('בטיפול של הבעלים')
    expect(item('של אף אחד')).toHaveTextContent('ללא שיוך')
  })

  it('has no deleted task and no done task in it', async () => {
    await mount({ tasks: week() })
    expect(queueTitles()).not.toContain('נמחקה')
    expect(queueTitles()).not.toContain('בוצעה היום')
  })

  it('keeps the words up to date as the minutes pass', async () => {
    await mount({ tasks: week() })
    expect(item('לאסוף מקרר')).toHaveTextContent('בעוד 45 דק׳')
    await settle(5 * MIN)
    expect(item('לאסוף מקרר')).toHaveTextContent('בעוד 40 דק׳')
  })
})

describe('TodayPage: done', () => {
  it('marks the task done through the store, takes it from the queue, and counts it among those done today', async () => {
    const { fake } = await mount({ tasks: week() })
    fireEvent.click(screen.getByRole('button', { name: 'בוצע: לשלוח חשבונית' }))
    await settle()
    expect(fake.tasks.upserts).toMatchObject([{ id: 'late2', patch: { done_at: expect.any(String) } }])
    expect(queueTitles()).toEqual(['להתקשר ללקוח', 'לאסוף מקרר', 'לחזור למשה'])
    expect(count('באיחור')).toBe('1')
    expect(count('בוצעו היום')).toBe('2')
  })
})

describe('TodayPage: postponing', () => {
  const choose = (title: string, value: string) => fireEvent.change(screen.getByLabelText(`דחיית ${title}`), { target: { value } })

  it('offers half an hour, an hour and tomorrow at nine, after a first line that asks nothing', async () => {
    await mount({ tasks: week() })
    const select = screen.getByLabelText('דחיית לאסוף מקרר')
    expect(within(select).getAllByRole('option').map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ['דחה…', ''],
      ['ב-30 דק׳', '30'],
      ['בשעה', '60'],
      ['למחר 09:00', 'tomorrow'],
    ])
    expect(select).toHaveValue('')
  })

  it('moves the task half an hour on from its time, and says when it is now', async () => {
    const { fake } = await mount({ tasks: week() })
    choose('לאסוף מקרר', '30')
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'soon1', patch: { due_at: at(75) } }])
    expect(screen.getByText('נדחה להיום · 13:15')).toBeInTheDocument()
    // The select is ready for the next time.
    expect(screen.getByLabelText('דחיית לאסוף מקרר')).toHaveValue('')
  })

  it('moves a late task half an hour on from now, and not to another moment in the past', async () => {
    const { fake } = await mount({ tasks: week() })
    choose('להתקשר ללקוח', '30')
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'late1', patch: { due_at: at(30) } }])
    expect(screen.getByText('נדחה להיום · 12:30')).toBeInTheDocument()
  })

  it('moves a task an hour on', async () => {
    const { fake } = await mount({ tasks: week() })
    choose('לשלוח חשבונית', '60')
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'late2', patch: { due_at: at(60) } }])
    expect(screen.getByText('נדחה להיום · 13:00')).toBeInTheDocument()
  })

  it('moves a task to nine in the morning of the next day in Jerusalem', async () => {
    const { fake } = await mount({ tasks: week() })
    choose('לאסוף מקרר', 'tomorrow')
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'soon1', patch: { due_at: '2026-10-17T06:00:00.000Z' } }])
    expect(screen.getByText('נדחה למחר · 09:00')).toBeInTheDocument()
  })

  it('takes the task from today\'s queue when it is put off to tomorrow, and the count follows', async () => {
    await mount({ tasks: week() })
    choose('לאסוף מקרר', 'tomorrow')
    await settle()
    expect(queueTitles()).toEqual(['להתקשר ללקוח', 'לשלוח חשבונית', 'לחזור למשה'])
    expect(count('נותרו להיום')).toBe('1')
    expect(count('בשעה הקרובה')).toBe('0')
  })

  it('counts from the real moment of the choice, even when the screen has not looked at the clock for a while', async () => {
    // The screen opens half a minute past the minute and looks at the clock once a minute after that.
    // A hundred seconds on it is still showing what it saw at 12:01:30, and the real time is 12:02:10.
    vi.setSystemTime(new Date(NOW.getTime() + 30_000))
    const { fake } = await mount({ tasks: [scheduled('a', { due_at: at(-10), title: 'מאחרת' })] })
    await settle(100_000)
    choose('מאחרת', '30')
    await settle()
    expect(fake.tasks.upserts).toEqual([{ id: 'a', patch: { due_at: at(32) } }])
  })

  it('forgets the snooze of a task that is put off, so that the new time starts clean', async () => {
    const soon = scheduled('soon1', { due_at: at(45), title: 'לאסוף מקרר' })
    localStorage.setItem(snoozeKey(DANA.id), JSON.stringify({ soon1: { until: NOW.getTime() + 8 * MIN, due: soon.due_at } }))
    await mount({ tasks: [soon] })
    expect(JSON.parse(localStorage.getItem(snoozeKey(DANA.id)) as string)).toHaveProperty('soon1')
    choose('לאסוף מקרר', '30')
    await settle()
    expect(JSON.parse(localStorage.getItem(snoozeKey(DANA.id)) as string)).not.toHaveProperty('soon1')
  })

  it('takes the words away after a few seconds', async () => {
    await mount({ tasks: week() })
    choose('לאסוף מקרר', '30')
    expect(screen.getByText('נדחה להיום · 13:15')).toBeInTheDocument()
    await settle(7_000)
    expect(screen.queryByText(/^נדחה ל/)).not.toBeInTheDocument()
  })
})

describe('TodayPage: the tasks without a time', () => {
  it('lists them, the oldest first, with the title as a link and the status', async () => {
    await mount({ tasks: week() })
    const list = screen.getByRole('list', { name: 'משימות ללא מועד' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['בלי מועד ב', 'בלי מועד א'])
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/today/undated2')
    expect(within(rows[0]).getByText('בטיפול')).toBeInTheDocument()
  })

  it('marks one done from the list', async () => {
    const { fake } = await mount({ tasks: week() })
    fireEvent.click(screen.getByRole('button', { name: 'בוצע: בלי מועד ב' }))
    await settle()
    expect(fake.tasks.upserts).toMatchObject([{ id: 'undated2', patch: { done_at: expect.any(String) } }])
    expect(count('ללא מועד')).toBe('1')
  })

  it('shows six, and a link that says how many more there are', async () => {
    const undated = Array.from({ length: 9 }, (_, i) => scheduled('u' + i, { due_at: null, remind_min: null, title: 'בלי מועד ' + i, created_at: `2026-10-0${1 + (i % 9)}T08:00:00.000Z` }))
    await mount({ tasks: undated })
    const rows = within(screen.getByRole('list', { name: 'משימות ללא מועד' })).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(count('ללא מועד')).toBe('9')
    expect(screen.getByRole('link', { name: 'ועוד 3 משימות ללא מועד' })).toHaveAttribute('href', '/tasks')
  })

  it('says "one more" in the singular', async () => {
    const undated = Array.from({ length: 7 }, (_, i) => scheduled('u' + i, { due_at: null, remind_min: null, title: 'בלי מועד ' + i }))
    await mount({ tasks: undated })
    expect(screen.getByRole('link', { name: 'ועוד משימה אחת ללא מועד' })).toBeInTheDocument()
  })

  it('has no link for more when there are six or fewer, and no list when there are none', async () => {
    await mount({ tasks: week() })
    expect(screen.queryByRole('link', { name: /ועוד .* ללא מועד/ })).not.toBeInTheDocument()
  })

  it('leaves the list out when nobody has a task without a time', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(10) })] })
    expect(screen.queryByRole('list', { name: 'משימות ללא מועד' })).not.toBeInTheDocument()
  })
})

describe('TodayPage: the work of each person', () => {
  const rows = () => within(screen.getByRole('table', { name: 'עומס לפי עובד' })).getAllByRole('row').slice(1)
  const cells = (row: HTMLElement) => [within(row).getByRole('rowheader').textContent, ...within(row).getAllByRole('cell').map((cell) => cell.textContent)]

  it('lists everybody who has open work, with what is open, late and left today, the most late first', async () => {
    await mount({ tasks: week() })
    expect(rows().map(cells)).toEqual([
      ['דנה', '7', '2', '2'],
      ['הבעלים', '1', '1', '0'],
      ['ללא שיוך', '1', '0', '1'],
    ])
  })

  it('is about everybody even when the switch is on my tasks', async () => {
    await mount({ tasks: week() })
    expect(rows()).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'כולם' }))
    expect(rows()).toHaveLength(3)
  })

  it('names a person who is not in the directory as unknown', async () => {
    await mount({ tasks: [scheduled('a', { assignee_id: 'u-stranger', due_at: at(10) })] })
    expect(rows().map(cells)).toEqual([['לא ידוע', '1', '0', '1']])
  })
})

describe('TodayPage: whose tasks', () => {
  it('shows my tasks at first, with the switch showing it', async () => {
    await mount({ tasks: week() })
    expect(screen.getByRole('button', { name: 'המשימות שלי' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'כולם' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('remembers the choice for the person on this device', async () => {
    await mount({ tasks: week() })
    fireEvent.click(screen.getByRole('button', { name: 'כולם' }))
    expect(screen.getByRole('button', { name: 'כולם' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem(scopeKey(DANA.id))).toBe('all')
    fireEvent.click(screen.getByRole('button', { name: 'המשימות שלי' }))
    expect(localStorage.getItem(scopeKey(DANA.id))).toBe('mine')
  })

  it('opens on what was chosen the last time', async () => {
    localStorage.setItem(scopeKey(DANA.id), 'all')
    await mount({ tasks: week() })
    expect(screen.getByRole('button', { name: 'כולם' })).toHaveAttribute('aria-pressed', 'true')
    expect(count('באיחור')).toBe('3')
  })

  it('does not take the choice of somebody else who uses the same device', async () => {
    localStorage.setItem(scopeKey(OWNER.id), 'all')
    await mount({ tasks: week() })
    expect(screen.getByRole('button', { name: 'המשימות שלי' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('TodayPage: when there is nothing', () => {
  it('says that there are no tasks yet when there are none at all', async () => {
    await mount({ tasks: [] })
    expect(screen.getByText(/^עדיין אין משימות/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'התור להיום' })).not.toBeInTheDocument()
  })

  it('says that there are no tasks when the last one has been deleted', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(10) })] })
    expect(queueTitles()).toEqual(['משימה a'])
    act(() => taken.softDelete('a', true))
    expect(screen.getByText(/^עדיין אין משימות/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'התור להיום' })).not.toBeInTheDocument()
  })

  it('says that nothing is late or left for today when the tasks are all for another day', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(24 * 60) })] })
    expect(screen.getByText('אין משימות באיחור או להיום.')).toBeInTheDocument()
    expect(count('באיחור')).toBe('0')
    expect(screen.queryByText(/^עדיין אין משימות/)).not.toBeInTheDocument()
  })

  it('says it also when the tasks of today are for somebody else, and the switch is on my tasks', async () => {
    await mount({ tasks: [scheduled('a', { due_at: at(10), assignee_id: OWNER.id })] })
    expect(screen.getByText('אין משימות באיחור או להיום.')).toBeInTheDocument()
  })
})

describe('TodayPage: loading, and failing to load', () => {
  it('says it while the tasks are on their way', async () => {
    let finish: () => void = () => undefined
    await mount({
      tasks: week(),
      wait: false,
      backend: (fake) => {
        const load = fake.tasks.gateway.loadInitial
        fake.tasks.gateway.loadInitial = (since) => new Promise((resolve) => (finish = () => resolve(load(since))))
      },
    })
    // Let the store ask for the tasks; the pretend server does not answer until it is told to.
    await settle(0)
    expect(screen.getByText('טוען משימות…')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('list', { name: 'התור להיום' })).not.toBeInTheDocument()
    finish()
    await settle()
    expect(screen.queryByText('טוען משימות…')).not.toBeInTheDocument()
    expect(queueTitles()).toHaveLength(4)
  })

  it('says what went wrong, and tries again when asked', async () => {
    await mount({
      tasks: week(),
      backend: (fake) => fake.tasks.failNext(new TypeError('Failed to fetch')),
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'התור להיום' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }))
    await settle()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(queueTitles()).toHaveLength(4)
  })
})

describe('TodayPage: when the tasks cannot be brought up to date', () => {
  it('keeps what is on the screen, says so, and tries again when asked', async () => {
    const { fake } = await mount({ tasks: week() })
    fake.tasks.failNext(new TypeError('Failed to fetch'))
    await act(async () => void (await taken.load()))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(queueTitles()).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'נסו שוב' }))
    await settle()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(queueTitles()).toHaveLength(4)
  })
})

describe('TodayPage: the rest of the screen', () => {
  it('has a link for a new task, which opens its card over Today', async () => {
    await mount({ tasks: week() })
    const link = screen.getByRole('link', { name: 'משימה חדשה' })
    expect(link).toHaveAttribute('href', '/today/new')
    fireEvent.click(link)
    expect(screen.getByText('a new card')).toBeInTheDocument()
    // The page is still there behind the card.
    expect(screen.getByRole('heading', { level: 2, name: 'היום' })).toBeInTheDocument()
  })

  it('asks to turn the notifications on, and the question goes when it is answered', async () => {
    const notifier = createMemoryNotifier('prompt')
    await mount({ tasks: week(), notifier })
    fireEvent.click(screen.getByRole('button', { name: 'הפעלת התראות' }))
    await settle()
    expect(screen.queryByRole('button', { name: 'הפעלת התראות' })).not.toBeInTheDocument()
  })
})
