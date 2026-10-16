import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { newTask, type Task } from '../features/tasks/model'
import type { FakeBackend } from './fakeBackend'
import { DANA, OWNER } from './fakeGateway'
import type { Profile } from '../features/auth/types'
import { stubViewport } from './matchMedia'
import { renderApp } from './renderApp'

// What the tests of the card of a task have in common: the whole app, signed in as Dana, opened at the
// card of a task over a pretend server that holds the tasks that the test names.

/** A saved task, for Dana, that needs nothing more to be saved again. */
export function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    ...newTask(OWNER.id, id),
    title: `משימה ${id}`,
    customer_name: 'רונית כהן',
    no_glassix: true,
    assignee_id: DANA.id,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    ...patch,
  }
}

interface Options {
  /** Changes the pretend server before the app starts. */
  backend?: (fake: FakeBackend) => void
  /** Who is signed in. Dana, an employee, unless it says otherwise. */
  as?: Profile
}

/** The whole app on a wide screen, signed in as Dana, at the card of a task or at a new one. */
export function openCard(path: string, tasks: Task[] = [], options: Options = {}) {
  stubViewport('wide')
  const user = userEvent.setup()
  const app = renderApp({
    path,
    configure: (fake) => {
      fake.getStoredUserId.mockResolvedValue((options.as ?? DANA).id)
      fake.fetchProfile.mockResolvedValue(options.as ?? DANA)
    },
    configureBackend: (fake) => {
      for (const t of tasks) fake.tasks.rows.set(t.id, t)
      options.backend?.(fake)
    },
  })
  return { ...app, user }
}

export const findCard = () => screen.findByRole('dialog')
/** The card, which is the only dialog on the screen. */
export const card = () => within(screen.getByRole('dialog'))
export const lastUpsert = (fake: FakeBackend) => fake.tasks.upserts.at(-1)
export const type = (user: ReturnType<typeof userEvent.setup>, label: string, text: string) => user.type(card().getByLabelText(label), text)
