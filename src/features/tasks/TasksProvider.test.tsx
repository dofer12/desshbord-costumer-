import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { createAuthStore, type AuthStore } from '../auth/authStore'
import { createFakeBackend, type FakeBackend } from '../../test/fakeBackend'
import { createFakeGateway, DANA, OWNER } from '../../test/fakeGateway'
import { BackendContext } from './backend'
import { newTask, type Task } from './model'
import { useAttachments, useDirectory, useTasks } from './tasksContext'
import { TasksProvider } from './TasksProvider'

function task(id: string, patch: Partial<Task> = {}): Task {
  return { ...newTask('user-1', id), no_glassix: true, title: `task ${id}`, ...patch }
}

/** Shows what the stores hold, so that a test can see that the provider loaded and started them. */
function Probe() {
  const status = useTasks((s) => s.status)
  const count = useTasks((s) => Object.keys(s.tasks).length)
  const live = useTasks((s) => s.live)
  const statuses = useDirectory((s) => s.statuses.length)
  const flush = useTasks((s) => s.flush)
  return (
    <div>
      <p data-testid="tasks">{`${status}:${count}`}</p>
      <p data-testid="directory">{statuses}</p>
      <p data-testid="live">{String(live)}</p>
      <button type="button" onClick={() => void flush()}>
        send
      </button>
    </div>
  )
}

async function signedIn(profile = DANA) {
  const gateway = createFakeGateway()
  gateway.getStoredUserId.mockResolvedValue(profile.id)
  gateway.fetchProfile.mockResolvedValue(profile)
  const auth = createAuthStore(gateway.gateway)
  await auth.getState().init()
  return { auth, gateway }
}

function renderProvider(auth: AuthStore, fake: FakeBackend) {
  return render(
    <AuthProvider store={auth}>
      <BackendContext value={fake.backend}>
        <TasksProvider>
          <Probe />
        </TasksProvider>
      </BackendContext>
    </AuthProvider>,
  )
}

describe('TasksProvider', () => {
  it('loads the tasks and the directory for the signed-in user', async () => {
    const { auth } = await signedIn()
    const fake = createFakeBackend({ tasks: [task('a'), task('b')] })
    renderProvider(auth, fake)
    expect(await screen.findByText('ready:2')).toBeInTheDocument()
    expect(screen.getByTestId('directory')).toHaveTextContent('4')
  })

  it('starts listening, and shows what arrives through the live connection', async () => {
    const { auth } = await signedIn()
    const fake = createFakeBackend({ tasks: [task('a')] })
    renderProvider(auth, fake)
    await screen.findByText('ready:1')
    expect(fake.tasks.subscribers).toBe(1)

    act(() => fake.tasks.setLive(true))
    expect(screen.getByTestId('live')).toHaveTextContent('true')
    act(() => fake.tasks.pushRemote(task('b', { updated_at: '2026-10-09T00:00:00.000Z' })))
    expect(screen.getByTestId('tasks')).toHaveTextContent('ready:2')
  })

  it('reloads the directory when something in it changes', async () => {
    const { auth } = await signedIn()
    const fake = createFakeBackend()
    renderProvider(auth, fake)
    await screen.findByText('ready:0')
    fake.directory.statuses.push({ key: 'new', name_he: 'חדש', color: '#123456', sort: 20, is_active: true })
    await act(async () => fake.directory.changed())
    expect(await screen.findByText('5')).toBeInTheDocument()
  })

  it('stops listening when it goes away', async () => {
    const { auth } = await signedIn()
    const fake = createFakeBackend({ tasks: [task('a')] })
    const view = renderProvider(auth, fake)
    await screen.findByText('ready:1')
    expect(fake.tasks.subscribers).toBe(1)
    expect(fake.directory.subscribers).toBe(1)
    view.unmount()
    expect(fake.tasks.subscribers).toBe(0)
    expect(fake.directory.subscribers).toBe(0)
  })

  it('sends the waiting changes of the signed-in user, from a storage that is theirs alone', async () => {
    const { auth } = await signedIn(DANA)
    const fake = createFakeBackend({ tasks: [task('a')] })
    const outbox = vi.spyOn(fake.backend, 'outbox')
    // Dana left a change waiting last time, and so did the owner.
    await fake.backend.outbox(DANA.id).save([{ id: 'a', patch: { notes: 'dana left this' }, queuedAt: 1, attempts: 0 }])
    await fake.backend.outbox(OWNER.id).save([{ id: 'a', patch: { notes: 'the owner left this' }, queuedAt: 1, attempts: 0 }])
    outbox.mockClear()

    renderProvider(auth, fake)
    await screen.findByText('ready:1')
    await userEvent.setup().click(screen.getByRole('button', { name: 'send' }))
    await vi.waitFor(() => expect(fake.tasks.rows.get('a')?.notes).toBe('dana left this'))
    expect(outbox).toHaveBeenCalledWith(DANA.id)
    expect(outbox).not.toHaveBeenCalledWith(OWNER.id)
    expect(await fake.backend.outbox(OWNER.id).load()).toHaveLength(1)
  })

  it('follows the person who is signed in: nothing after a sign-out, and new stores for the next person', async () => {
    const { auth, gateway } = await signedIn(DANA)
    const fake = createFakeBackend({ tasks: [task('a')] })
    renderProvider(auth, fake)
    await screen.findByText('ready:1')

    await act(async () => auth.getState().signOut())
    expect(screen.queryByTestId('tasks')).not.toBeInTheDocument()
    expect(fake.tasks.subscribers).toBe(0)
    expect(fake.directory.subscribers).toBe(0)

    gateway.fetchProfile.mockResolvedValue(OWNER)
    gateway.signIn.mockResolvedValue(OWNER.id)
    const outbox = vi.spyOn(fake.backend, 'outbox')
    await act(async () => auth.getState().signIn('owner@example.com', 'secret-pass-1'))
    expect(await screen.findByText('ready:1')).toBeInTheDocument()
    expect(outbox).toHaveBeenCalledWith(OWNER.id)
    expect(fake.tasks.subscribers).toBe(1)
  })

  it('shows nothing when nobody is signed in', async () => {
    const gateway = createFakeGateway()
    const auth = createAuthStore(gateway.gateway)
    await auth.getState().init()
    const fake = createFakeBackend()
    renderProvider(auth, fake)
    expect(screen.queryByTestId('tasks')).not.toBeInTheDocument()
    expect(fake.tasks.subscribers).toBe(0)
  })
})

describe('the hooks', () => {
  it('give the gateway of the pictures that the backend has', async () => {
    const { auth } = await signedIn()
    const fake = createFakeBackend()
    const seen: unknown[] = []
    function Spy() {
      const attachments = useAttachments()
      useEffect(() => {
        seen.push(attachments)
      }, [attachments])
      return null
    }
    render(
      <AuthProvider store={auth}>
        <BackendContext value={fake.backend}>
          <TasksProvider>
            <Spy />
          </TasksProvider>
        </BackendContext>
      </AuthProvider>,
    )
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toBe(fake.backend.attachments)
  })

  it('say what is wrong when they are used outside the provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow(/TasksProvider/)
    errors.mockRestore()
  })
})
