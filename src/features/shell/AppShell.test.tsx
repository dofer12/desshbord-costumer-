import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeBackend } from '../../test/fakeBackend'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore } from '../auth/authStore'
import { AUTH_MESSAGES } from '../auth/errors'
import type { Profile } from '../auth/types'
import { createDirectoryStore } from '../tasks/directoryStore'
import { TasksContext } from '../tasks/tasksContext'
import { createTasksStore } from '../tasks/tasksStore'
import { AppShell } from './AppShell'

async function renderShell(options: { path?: string; profile?: Profile } = {}) {
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
  tasks.setState({ live: true })
  const view = render(
    <AuthProvider store={auth}>
      <TasksContext value={{ tasks, directory, attachments: fake.backend.attachments }}>
        <MemoryRouter initialEntries={[options.path ?? '/tasks']}>
          <Routes>
            <Route element={<AppShell serverHost="test.supabase.co" />}>
              <Route path="tasks" element={<p>the tasks page</p>} />
              <Route path="tasks/:id" element={<p>a task card</p>} />
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
  it('are in a navigation landmark, with the current one marked', async () => {
    await renderShell()
    const nav = screen.getByRole('navigation', { name: 'ניווט ראשי' })
    expect(within(nav).getByRole('link', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
  })

  it('keep the tasks tab current on the page of one task, and show the page that the route gives', async () => {
    await renderShell({ path: '/tasks/abc' })
    expect(screen.getByRole('link', { name: 'משימות' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('a task card')).toBeInTheDocument()
  })

  it('lead to the tasks screen', async () => {
    await renderShell({ path: '/tasks/abc' })
    await userEvent.setup().click(screen.getByRole('link', { name: 'משימות' }))
    expect(screen.getByText('the tasks page')).toBeInTheDocument()
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
    act(() => tasks.setState({ pending: 3 }))
    expect(screen.getByRole('status')).toHaveTextContent('3 שינויים ממתינים')
    act(() => tasks.setState({ pending: 1 }))
    expect(screen.getByRole('status')).toHaveTextContent('שינוי אחד ממתין')
    act(() => tasks.setState({ pending: 0 }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
