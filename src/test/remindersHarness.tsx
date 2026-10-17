import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { AuthProvider } from '../features/auth/AuthProvider'
import { createAuthStore } from '../features/auth/authStore'
import type { Profile } from '../features/auth/types'
import { createMemoryNotifier, type MemoryNotifier } from '../features/schedule/notifier'
import { RemindersProvider } from '../features/schedule/RemindersProvider'
import { BackendContext } from '../features/tasks/backend'
import { newTask, type Task } from '../features/tasks/model'
import { TasksProvider } from '../features/tasks/TasksProvider'
import { createFakeBackend, type FakeBackend } from './fakeBackend'
import { createFakeGateway, DANA, OWNER } from './fakeGateway'
import { Where } from './Where'

// What the tests of the screens that show reminders have in common: the app's providers over a pretend
// server, a signed-in person, a router and a clock that the test controls (it calls vi.useFakeTimers).

/** The moment of these tests: 12:00 in Jerusalem on Friday 16 October 2026 (09:00 UTC). */
export const NOW = new Date('2026-10-16T09:00:00Z')
export const MIN = 60_000
/** The ISO moment that is `minutes` after NOW (before it, when negative). */
export const at = (minutes: number) => new Date(NOW.getTime() + minutes * MIN).toISOString()

/** A task of Dana's, due in an hour, that reminds a quarter of an hour before it. */
export function scheduled(id: string, over: Partial<Task> = {}): Task {
  return {
    ...newTask(OWNER.id, id),
    title: `משימה ${id}`,
    no_glassix: true,
    assignee_id: DANA.id,
    due_at: at(60),
    remind_min: 15,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    ...over,
  }
}

/** Lets the promises settle and the fake clock run for a while. */
export const settle = (ms = 300) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

interface Options {
  tasks?: Task[]
  notifier?: MemoryNotifier
  /** The address to start at. */
  path?: string
  /** Who is signed in. Dana, unless it says otherwise. */
  as?: Profile
  /** Changes the pretend server before the app starts. */
  backend?: (fake: FakeBackend) => void
  /** Let the promises settle before returning. False to look at the screen while it is still loading. */
  wait?: boolean
}

/** Puts `ui` where the screens of the app are: signed in, with the tasks, the directory and the reminders, inside a router. */
export async function mountScheduled(ui: ReactNode, options: Options = {}) {
  const profile = options.as ?? DANA
  const gateway = createFakeGateway()
  gateway.getStoredUserId.mockResolvedValue(profile.id)
  gateway.fetchProfile.mockResolvedValue(profile)
  const auth = createAuthStore(gateway.gateway)
  await auth.getState().init()

  const fake = createFakeBackend({ tasks: options.tasks })
  options.backend?.(fake)
  const notifier = options.notifier ?? createMemoryNotifier('granted')
  const view = render(
    <AuthProvider store={auth}>
      <BackendContext value={fake.backend}>
        <MemoryRouter initialEntries={[options.path ?? '/']}>
          <TasksProvider>
            <RemindersProvider notifier={notifier}>
              {ui}
              <Where />
            </RemindersProvider>
          </TasksProvider>
        </MemoryRouter>
      </BackendContext>
    </AuthProvider>,
  )
  if (options.wait !== false) await settle(0)
  return { notifier, fake, view, auth }
}
