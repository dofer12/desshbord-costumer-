import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeBackend } from '../../test/fakeBackend'
import { refusal } from '../../test/fakeTasksGateways'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore } from '../auth/authStore'
import { AUTH_MESSAGES } from '../auth/errors'
import type { Profile } from '../auth/types'
import { createDirectoryStore } from '../tasks/directoryStore'
import { newTask, type Task } from '../tasks/model'
import { TasksContext } from '../tasks/tasksContext'
import { createTasksStore } from '../tasks/tasksStore'
import { AppShell } from './AppShell'

/** Friday 16 October 2026, 12:00 in Jerusalem (summer time): today ends at 21:00 UTC. */
const NOON = '2026-10-16T09:00:00.000Z'

async function renderShell(options: { path?: string; profile?: Profile; tasks?: Task[]; now?: string } = {}) {
  // Only the clock is pretended, so that the tabs can be tried at a time of the day; the timers are real.
  if (options.now) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(options.now))
  }
  const profile = options.profile ?? DANA
  const gateway = createFakeGateway()
  gateway.getStoredUserId.mockResolvedValue(profile.id)
  gateway.fetchProfile.mockResolvedValue(profile)
  const auth = createAuthStore(gateway.gateway)
  await auth.getState().init()
  gateway.fetchProfile.mockClear()

  const fake = createFakeBackend()
  const tasks = createTasksStore({ gateway: fake.tasks.gateway, storage: fake.backend.outbox(profile.id) })
  const directory = createDirectoryStore(fake.directory.gateway)
  // The store reads what an earlier run left in its storage in its first moments, and that would
  // overwrite the counts that a test puts in. The normal state of the app is a live connection.
  await tasks.getState().flush()
  tasks.setState({ live: true, tasks: Object.fromEntries((options.tasks ?? []).map((t) => [t.id, t])) })
  const view = render(
    <AuthProvider store={auth}>
      <TasksContext value={{ tasks, directory, attachments: fake.backend.attachments, history: fake.backend.tasks.loadHistory }}>
        <MemoryRouter initialEntries={[options.path ?? '/tasks']}>
          <Routes>
            <Route element={<AppShell serverHost="test.supabase.co" />}>
              <Route path="today" element={<p>the today page</p>} />
              <Route path="today/:id" element={<p>a today card</p>} />
              <Route path="tasks" element={<p>the tasks page</p>} />
              <Route path="tasks/:id" element={<p>a task card</p>} />
              <Route path="calendar" element={<p>the calendar page</p>} />
              <Route path="calendar/:id" element={<p>a calendar card</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TasksContext>
    </AuthProvider>,
  )
  return { auth, gateway, tasks, directory, fake, view }
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('the tabs', () => {
  const tabs = () => within(screen.getByRole('navigation', { name: 'ניווט ראשי' })).getAllByRole('link')
  const current = () => tabs().filter((tab) => tab.getAttribute('aria-current') === 'page').map((tab) => tab.textContent)

  it('are Today, Tasks and Calendar, in this order, in a navigation landmark', async () => {
    await renderShell()
    expect(tabs().map((tab) => tab.textContent)).toEqual(['היום', 'משימות', 'יומן'])
    expect(tabs().map((tab) => tab.getAttribute('href'))).toEqual(['/today', '/tasks', '/calendar'])
  })

  it.each([
    ['/today', 'היום'],
    ['/tasks', 'משימות'],
    ['/calendar', 'יומן'],
  ])('mark %s as the current one, and no other', async (path, label) => {
    await renderShell({ path })
    expect(current()).toEqual([label])
  })

  it.each([
    ['/today/abc', 'היום', 'a today card'],
    ['/tasks/abc', 'משימות', 'a task card'],
    ['/calendar/abc', 'יומן', 'a calendar card'],
  ])('keep the tab current on the page of one task at %s, and show the page that the route gives', async (path, label, page) => {
    await renderShell({ path })
    expect(current()).toEqual([label])
    expect(screen.getByText(page)).toBeInTheDocument()
  })

  it.each([
    ['היום', 'the today page'],
    ['משימות', 'the tasks page'],
    ['יומן', 'the calendar page'],
  ])('lead to the %s screen', async (label, page) => {
    await renderShell({ path: '/tasks/abc' })
    await userEvent.setup().click(screen.getByRole('link', { name: label }))
    expect(screen.getByText(page)).toBeInTheDocument()
    expect(current()).toEqual([label])
  })
})

describe('the numbers on the tabs', () => {
  // Friday noon in Jerusalem. Today ends at 21:00 UTC.
  const own = (id: string, patch: Partial<Task> = {}): Task => ({ ...newTask(DANA.id, id), title: id, assignee_id: DANA.id, ...patch })
  const link = (name: string) => screen.getByRole('link', { name })
  const badge = (name: string) => within(link(name)).queryByText(/^\d+\+?$/)

  const week: Task[] = [
    own('late', { due_at: '2026-10-16T05:00:00.000Z' }),
    own('later', { due_at: '2026-10-16T15:00:00.000Z' }),
    own('tomorrow', { due_at: '2026-10-17T07:00:00.000Z' }),
    own('undated'),
    own('done', { due_at: '2026-10-16T06:00:00.000Z', done_at: '2026-10-16T07:00:00.000Z' }),
    own('deleted', { due_at: '2026-10-16T06:00:00.000Z', deleted_at: '2026-10-16T07:00:00.000Z' }),
    own('theirs', { due_at: '2026-10-16T06:00:00.000Z', assignee_id: OWNER.id }),
    own('nobodys', { due_at: '2026-10-16T06:00:00.000Z', assignee_id: null }),
  ]

  it('show how many of my tasks are due today or late on Today, and how many of my tasks are open on Tasks', async () => {
    await renderShell({ tasks: week, now: NOON })
    expect(badge('היום')).toHaveTextContent('2')
    expect(badge('משימות')).toHaveTextContent('4')
    // The calendar has no number.
    expect(within(link('יומן')).queryByText(/\d/)).not.toBeInTheDocument()
  })

  it('say the same in words to a screen reader, and leave the names of the tabs alone', async () => {
    await renderShell({ tasks: week, now: NOON })
    expect(link('היום')).toHaveAccessibleDescription('2 משימות להיום, יש באיחור')
    expect(link('משימות')).toHaveAccessibleDescription('4 משימות פתוחות')
    expect(badge('היום')).toHaveAttribute('aria-hidden', 'true')
    expect(badge('משימות')).toHaveAttribute('aria-hidden', 'true')
  })

  it('turn red on Today when something is late, and only then', async () => {
    await renderShell({ tasks: week, now: NOON })
    expect(badge('היום')).toHaveClass('tab-badge-late')
    expect(badge('משימות')).not.toHaveClass('tab-badge-late')
  })

  it('are not red when what is due today is still to come', async () => {
    await renderShell({ tasks: [own('later', { due_at: '2026-10-16T15:00:00.000Z' })], now: NOON })
    expect(badge('היום')).toHaveTextContent('1')
    expect(badge('היום')).not.toHaveClass('tab-badge-late')
    expect(link('היום')).toHaveAccessibleDescription('משימה אחת להיום')
    expect(link('משימות')).toHaveAccessibleDescription('משימה פתוחה אחת')
  })

  it('are not there when there is nothing to count, and the tabs have no description then', async () => {
    await renderShell({ tasks: [own('done', { done_at: '2026-10-16T07:00:00.000Z' }), own('theirs', { assignee_id: OWNER.id })], now: NOON })
    expect(badge('היום')).not.toBeInTheDocument()
    expect(badge('משימות')).not.toBeInTheDocument()
    expect(link('היום')).not.toHaveAttribute('aria-describedby')
    expect(link('משימות')).not.toHaveAttribute('aria-describedby')
    expect(link('היום')).toHaveTextContent(/^היום$/)
  })

  it('count the tasks of the person who is signed in', async () => {
    await renderShell({ tasks: week, now: NOON, profile: OWNER })
    expect(badge('היום')).toHaveTextContent('1')
    expect(link('היום')).toHaveAccessibleDescription('משימה אחת להיום, יש באיחור')
    expect(badge('משימות')).toHaveTextContent('1')
  })

  it('show 99+ for a long list, and say the exact number in words', async () => {
    const many = Array.from({ length: 120 }, (_, i) => own('t' + i, { due_at: '2026-10-16T15:00:00.000Z' }))
    await renderShell({ tasks: many, now: NOON })
    expect(badge('היום')).toHaveTextContent('99+')
    expect(badge('משימות')).toHaveTextContent('99+')
    expect(link('היום')).toHaveAccessibleDescription('120 משימות להיום')
    expect(link('משימות')).toHaveAccessibleDescription('120 משימות פתוחות')
  })

  it('show exactly 99 as 99', async () => {
    const ninetyNine = Array.from({ length: 99 }, (_, i) => own('t' + i))
    await renderShell({ tasks: ninetyNine, now: NOON })
    expect(badge('משימות')).toHaveTextContent(/^99$/)
  })

  it('follow the tasks as they change', async () => {
    const { tasks } = await renderShell({ tasks: [own('a', { due_at: '2026-10-16T15:00:00.000Z' })], now: NOON })
    expect(badge('משימות')).toHaveTextContent('1')
    act(() => tasks.setState({ tasks: { ...tasks.getState().tasks, b: own('b'), c: own('c', { due_at: '2026-10-16T05:00:00.000Z' }) } }))
    expect(badge('משימות')).toHaveTextContent('3')
    expect(badge('היום')).toHaveTextContent('2')
    expect(badge('היום')).toHaveClass('tab-badge-late')
    act(() => tasks.setState({ tasks: { a: tasks.getState().tasks.a } }))
    expect(badge('משימות')).toHaveTextContent('1')
    expect(badge('היום')).not.toHaveClass('tab-badge-late')
  })
})

describe('the numbers on the tabs as time passes', () => {
  const own = (id: string, patch: Partial<Task> = {}): Task => ({ ...newTask(DANA.id, id), title: id, assignee_id: DANA.id, ...patch })
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it('turn red when the time of a task passes while the screen is left open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOON))
    await renderShell({ tasks: [own('soon', { due_at: '2026-10-16T09:30:00.000Z' })] })
    expect(screen.getByRole('link', { name: 'היום' })).toHaveAccessibleDescription('משימה אחת להיום')
    await advance(29 * 60_000)
    expect(screen.getByRole('link', { name: 'היום' })).toHaveAccessibleDescription('משימה אחת להיום')
    await advance(2 * 60_000)
    expect(screen.getByRole('link', { name: 'היום' })).toHaveAccessibleDescription('משימה אחת להיום, יש באיחור')
  })

  it('count a task that was tomorrow once the clock in Jerusalem passes midnight', async () => {
    // 23:59:30 on Friday in Jerusalem; the task is for 00:30 on Saturday.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T20:59:30.000Z'))
    await renderShell({ tasks: [own('night', { due_at: '2026-10-16T21:30:00.000Z' })] })
    expect(within(screen.getByRole('link', { name: 'היום' })).queryByText(/\d/)).not.toBeInTheDocument()
    await advance(60_000)
    expect(within(screen.getByRole('link', { name: 'היום' })).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'היום' })).toHaveAccessibleDescription('משימה אחת להיום')
  })
})

describe('the strip of reminders', () => {
  // A reminder that is on at noon: the task is due in ten minutes and reminds a quarter of an hour before.
  const reminding = (id: string, patch: Partial<Task> = {}): Task => ({
    ...newTask(DANA.id, id),
    title: id,
    assignee_id: DANA.id,
    due_at: '2026-10-16T09:10:00.000Z',
    remind_min: 15,
    ...patch,
  })
  const strip = () => screen.queryByRole('region', { name: 'תזכורות פעילות' })

  it.each(['/today', '/tasks', '/calendar'])('is above the page at %s', async (path) => {
    await renderShell({ path, tasks: [reminding('a')], now: NOON })
    expect(within(strip() as HTMLElement).getByRole('link', { name: 'a' })).toHaveAttribute('href', '/today/a')
    const main = screen.getByRole('main')
    expect(strip()?.compareDocumentPosition(main)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows the reminders of the person who is signed in, and not of another', async () => {
    await renderShell({ path: '/tasks', tasks: [reminding('mine'), reminding('theirs', { assignee_id: OWNER.id })], now: NOON })
    const links = within(strip() as HTMLElement).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['mine'])
  })

  it('is not there when nothing reminds', async () => {
    await renderShell({ path: '/tasks', tasks: [reminding('later', { due_at: '2026-10-16T15:00:00.000Z' })], now: NOON })
    expect(strip()).not.toBeInTheDocument()
  })
})

describe('the title', () => {
  it('names the app', async () => {
    await renderShell()
    expect(screen.getByRole('heading', { level: 1, name: 'יומן משימות מוקד' })).toBeInTheDocument()
  })
})

describe('the indicator of waiting changes', () => {
  it('is not there when nothing waits', async () => {
    await renderShell()
    expect(screen.queryByText(/שינויים ממתינים|שינוי אחד ממתין/)).not.toBeInTheDocument()
  })

  it('shows how many changes wait, and goes away when none does', async () => {
    const { tasks } = await renderShell()
    // (The strip of reminders keeps a status region of its own, which is empty, so the message is found by what it says.)
    act(() => tasks.setState({ pending: 3 }))
    expect(screen.getByText('3 שינויים ממתינים')).toHaveAttribute('role', 'status')
    act(() => tasks.setState({ pending: 1 }))
    expect(screen.getByText('שינוי אחד ממתין')).toHaveAttribute('role', 'status')
    act(() => tasks.setState({ pending: 0 }))
    expect(screen.queryByText(/שינויים ממתינים|שינוי אחד ממתין/)).not.toBeInTheDocument()
  })

  it('says when changes were refused, and offers to send them again', async () => {
    const { tasks } = await renderShell()
    const retryFailed = vi.fn()
    act(() => tasks.setState({ failed: [{ id: 'a', message: 'x' }, { id: 'b', message: 'y' }], retryFailed }))
    expect(screen.getByRole('alert')).toHaveTextContent('2 שינויים לא נשמרו')
    await userEvent.setup().click(screen.getByRole('button', { name: 'נסו שוב' }))
    expect(retryFailed).toHaveBeenCalledTimes(1)

    act(() => tasks.setState({ failed: [{ id: 'a', message: 'x' }] }))
    expect(screen.getByRole('alert')).toHaveTextContent('שינוי אחד לא נשמר')
    act(() => tasks.setState({ failed: [] }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('a change that the server refused', () => {
    const refused = (id: string, title: string, over: Partial<Task> = {}): Task => ({ ...newTask('u-dana', id), no_glassix: true, title, ...over })

    it('says which task it is, and why the server did not take it', async () => {
      const { tasks } = await renderShell({ tasks: [refused('a', 'לטפל בהחזר'), refused('b', 'לחזור ללקוח')] })
      act(() =>
        tasks.setState({
          failed: [
            { id: 'a', message: 'אין הרשאה לשמור את השינוי.' },
            { id: 'b', message: 'חסר מזהה שיחת Glassix, או סימון "אין שיחה ב-Glassix".' },
          ],
        }),
      )
      const list = within(screen.getByRole('alert')).getByRole('list')
      const [first, second] = within(list).getAllByRole('listitem')
      expect(first).toHaveTextContent('לטפל בהחזר')
      expect(first).toHaveTextContent('אין הרשאה לשמור את השינוי.')
      expect(second).toHaveTextContent('לחזור ללקוח')
      expect(second).toHaveTextContent('חסר מזהה שיחת Glassix')
    })

    it('opens the task, so that what the server did not like can be mended', async () => {
      const { tasks } = await renderShell({ tasks: [refused('a', 'לטפל בהחזר')] })
      act(() => tasks.setState({ failed: [{ id: 'a', message: 'x' }] }))
      await userEvent.setup().click(within(screen.getByRole('alert')).getByRole('link', { name: 'פתיחת המשימה: לטפל בהחזר' }))
      expect(screen.getByText('a task card')).toBeInTheDocument()
    })

    it('has no link for a task that is not here, and still can be given up', async () => {
      const { tasks } = await renderShell()
      act(() => tasks.setState({ failed: [{ id: 'gone', message: 'x' }] }))
      expect(within(screen.getByRole('alert')).queryByRole('link')).not.toBeInTheDocument()
      expect(within(screen.getByRole('alert')).getByRole('button', { name: /ביטול השינוי/ })).toBeInTheDocument()
    })

    it('is given up only after the person has said yes, since what was typed is lost', async () => {
      const { tasks } = await renderShell({ tasks: [refused('a', 'לטפל בהחזר')] })
      const discardFailed = vi.fn()
      act(() => tasks.setState({ failed: [{ id: 'a', message: 'x' }], discardFailed }))
      const user = userEvent.setup()
      const alert = () => within(screen.getByRole('alert'))

      await user.click(alert().getByRole('button', { name: 'ביטול השינוי: לטפל בהחזר' }))
      expect(discardFailed).not.toHaveBeenCalled()
      expect(alert().getByText(/לבטל את השינוי/)).toBeInTheDocument()

      await user.click(alert().getByRole('button', { name: 'לא, להשאיר' }))
      expect(discardFailed).not.toHaveBeenCalled()
      expect(alert().queryByText(/לבטל את השינוי/)).not.toBeInTheDocument()

      await user.click(alert().getByRole('button', { name: 'ביטול השינוי: לטפל בהחזר' }))
      await user.click(alert().getByRole('button', { name: 'כן, לבטל' }))
      expect(discardFailed).toHaveBeenCalledExactlyOnceWith('a')
    })

    it('puts the focus on the safe answer, and gives it back to the button that asked when the answer is no', async () => {
      const { tasks } = await renderShell({ tasks: [refused('a', 'לטפל בהחזר')] })
      act(() => tasks.setState({ failed: [{ id: 'a', message: 'x' }] }))
      const user = userEvent.setup()
      const alert = () => within(screen.getByRole('alert'))
      await user.click(alert().getByRole('button', { name: 'ביטול השינוי: לטפל בהחזר' }))
      expect(alert().getByRole('button', { name: 'לא, להשאיר' })).toHaveFocus()
      await user.click(alert().getByRole('button', { name: 'לא, להשאיר' }))
      expect(alert().getByRole('button', { name: 'ביטול השינוי: לטפל בהחזר' })).toHaveFocus()
    })

    it('goes through the real store: a refused change is shown, given up, and the task is what the server has again', async () => {
      const { tasks, fake } = await renderShell()
      fake.tasks.rows.set('a', refused('a', 'לטפל בהחזר', { notes: 'on the server' }))
      await tasks.getState().load()
      fake.tasks.failNext(refusal(400, 'violates check constraint "tasks_glassix_rule"', '23514'))
      tasks.getState().update('a', { notes: 'typed here' })
      await tasks.getState().flush()

      const alert = () => within(screen.getByRole('alert'))
      expect(alert().getByText(/לטפל בהחזר/)).toBeInTheDocument()
      expect(alert().getByText(/מזהה שיחת Glassix/)).toBeInTheDocument()
      expect(tasks.getState().tasks.a.notes).toBe('typed here')

      const user = userEvent.setup()
      await user.click(alert().getByRole('button', { name: 'ביטול השינוי: לטפל בהחזר' }))
      await user.click(alert().getByRole('button', { name: 'כן, לבטל' }))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(tasks.getState().tasks.a.notes).toBe('on the server')
    })
  })
})

describe('the banner of a lost connection', () => {
  it('is not there while the connection is live', async () => {
    await renderShell()
    expect(screen.queryByText(/אין חיבור חי/)).not.toBeInTheDocument()
  })

  it('says that changes of others will wait while the live connection is down, and is gone when it is back', async () => {
    const { tasks } = await renderShell()
    act(() => tasks.setState({ live: false }))
    expect(screen.getByText(/אין חיבור חי/)).toBeInTheDocument()
    act(() => tasks.setState({ live: true }))
    expect(screen.queryByText(/אין חיבור חי/)).not.toBeInTheDocument()
  })
})

describe('the user menu', () => {
  it('is closed at first, and opens with the name, the role, the version and the server', async () => {
    await renderShell()
    expect(screen.queryByText('התנתקות')).not.toBeInTheDocument()
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'דנה' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('תפקיד: עובד')).toBeInTheDocument()
    expect(screen.getByText(__APP_VERSION__)).toBeInTheDocument()
    expect(screen.getByText('test.supabase.co')).toBeInTheDocument()
  })

  it('calls an administrator a manager', async () => {
    await renderShell({ profile: OWNER })
    await userEvent.setup().click(screen.getByRole('button', { name: OWNER.display_name }))
    expect(screen.getByText('תפקיד: מנהל')).toBeInTheDocument()
  })

  it('has a link to the profile of the person, and closes behind it', async () => {
    await renderShell()
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'דנה' })
    expect(screen.queryByRole('link', { name: 'הפרופיל שלי' })).not.toBeInTheDocument()
    await user.click(toggle)
    const link = screen.getByRole('link', { name: 'הפרופיל שלי' })
    expect(link).toHaveAttribute('href', '/profile')
    await user.click(link)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on the Escape key and again on the same button', async () => {
    await renderShell()
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'דנה' })
    await user.click(toggle)
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes when the person clicks somewhere else', async () => {
    await renderShell()
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: 'דנה' })
    await user.click(toggle)
    await user.click(screen.getByText('the tasks page'))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('listens for clicks elsewhere only while it is open, and leaves nothing behind', async () => {
    const user = userEvent.setup()
    await renderShell()
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const pointerdowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'pointerdown').length
    try {
      const toggle = screen.getByRole('button', { name: 'דנה' })
      expect([pointerdowns(add), pointerdowns(remove)]).toEqual([0, 0])
      await user.click(toggle)
      expect([pointerdowns(add), pointerdowns(remove)]).toEqual([1, 0])
      await user.keyboard('{Escape}')
      expect([pointerdowns(add), pointerdowns(remove)]).toEqual([1, 1])
      await user.click(toggle)
      await user.click(toggle)
      expect([pointerdowns(add), pointerdowns(remove)]).toEqual([2, 2])
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })

  it('signs out, without a message', async () => {
    const { auth, gateway } = await renderShell()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'דנה' }))
    await user.click(screen.getByRole('button', { name: 'התנתקות' }))
    expect(gateway.signOut).toHaveBeenCalledTimes(1)
    expect(auth.getState()).toMatchObject({ status: 'signedOut', error: null })
  })
})

describe('the check that the user is still a member', () => {
  const visible = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('looks at the profile when the app becomes visible, and not when it is hidden', async () => {
    const { gateway } = await renderShell()
    visible('hidden')
    expect(gateway.fetchProfile).not.toHaveBeenCalled()
    visible('visible')
    expect(gateway.fetchProfile).toHaveBeenCalledWith(DANA.id)
  })

  it('signs the user out, with the reason, when the profile has been deactivated', async () => {
    const { auth, gateway } = await renderShell()
    gateway.fetchProfile.mockResolvedValue({ ...DANA, is_active: false })
    visible('visible')
    await vi.waitFor(() => expect(auth.getState().status).toBe('signedOut'))
    expect(auth.getState().error).toBe(AUTH_MESSAGES.notMember)
  })

  it('leaves the user signed in when the server cannot be reached', async () => {
    const { auth, gateway } = await renderShell()
    gateway.fetchProfile.mockRejectedValue(new TypeError('Failed to fetch'))
    visible('visible')
    await vi.waitFor(() => expect(gateway.fetchProfile).toHaveBeenCalled())
    await act(async () => undefined)
    expect(auth.getState().status).toBe('signedIn')
    expect(gateway.signOut).not.toHaveBeenCalled()
  })

  it('looks again every five minutes', async () => {
    vi.useFakeTimers()
    const { gateway } = await renderShell()
    expect(gateway.fetchProfile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000)
    expect(gateway.fetchProfile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(gateway.fetchProfile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(gateway.fetchProfile).toHaveBeenCalledTimes(2)
  })

  it('stops looking, on the clock and when the app comes to the front, once the shell has gone away', async () => {
    vi.useFakeTimers()
    const { gateway, view } = await renderShell()
    view.unmount()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    visible('visible')
    expect(gateway.fetchProfile).not.toHaveBeenCalled()
  })
})
