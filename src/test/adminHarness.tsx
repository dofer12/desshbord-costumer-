import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TEMP_PASSWORD_ALPHABET, TEMP_PASSWORD_LENGTH } from '../../supabase/functions/admin-users/logic'
import type { Profile } from '../features/auth/types'
import type { Task } from '../features/tasks/model'
import { stubClipboard } from './clipboard'
import type { FakeBackend } from './fakeBackend'
import { DANA, OWNER } from './fakeGateway'
import { renderApp } from './renderApp'

// What the tests of the screens of the administrator have in common: the whole app, signed in as an
// administrator, over a pretend server that holds the people that the test names.

const person = (id: string, name: string, patch: Partial<Profile> = {}): Profile => ({
  id,
  email: `${id.replace(/^u-/, '')}@example.com`,
  display_name: name,
  role: 'employee',
  is_active: true,
  must_change_password: false,
  default_remind_min: 15,
  ...patch,
})

/** An employee, active. */
export const AVI = person('u-avi', 'אבי לוי')
/** An employee who has been blocked. */
export const MICHAL = person('u-michal', 'מיכל ברק', { is_active: false })
/** An employee who has not yet chosen a password of their own. */
export const NOAM = person('u-noam', 'נועם שמש', { must_change_password: true })
/** A second administrator. */
export const YAEL = person('u-yael', 'יעל גולן', { role: 'admin' })

interface Options {
  path?: string
  /** Who is signed in: the owner, an administrator, unless it says otherwise. */
  as?: Profile
  /** Everyone that the pretend server holds. The person who is signed in and Dana, unless it says otherwise. */
  people?: Profile[]
  dataRouter?: boolean
  /** The tasks that the pretend server holds. */
  tasks?: Task[]
  /** Changes the pretend server before the app starts. */
  backend?: (fake: FakeBackend) => void
}

export async function openAdmin(options: Options = {}) {
  const me = options.as ?? OWNER
  const user = userEvent.setup()
  // The clipboard is put in place after userEvent.setup(), which puts one of its own.
  const clipboard = stubClipboard()
  const app = renderApp({
    path: options.path ?? '/admin/employees',
    dataRouter: options.dataRouter,
    configure: (fake) => {
      fake.getStoredUserId.mockResolvedValue(me.id)
      fake.fetchProfile.mockResolvedValue(me)
    },
    configureBackend: (backend) => {
      backend.directory.profiles = (options.people ?? [me, DANA]).map((p) => ({ ...p }))
      backend.actAs(me.id)
      for (const task of options.tasks ?? []) backend.tasks.rows.set(task.id, task)
      options.backend?.(backend)
    },
  })
  await app.ready
  return { ...app, user, clipboard, me }
}

/** The rows of the list of the employees. */
const rows = () => within(screen.getByRole('list', { name: 'רשימת העובדים' })).getAllByRole('listitem')

/** The row of a person in the list of the employees. */
export function rowOf(name: string): HTMLElement {
  const row = rows().find((item) => item.querySelector('.person-name')?.textContent === name)
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

export const inRow = (name: string) => within(rowOf(name))

/** The names in the list, in the order that they are shown. */
export function namesShown(): string[] {
  return rows().map((item) => item.querySelector('.person-name')?.textContent ?? '')
}

/** The temporary password that the dialog shows. */
export function temporaryPassword(): string {
  const group = within(screen.getByRole('group', { name: 'הסיסמה הזמנית' }))
  return group.getByText(new RegExp(`^[${TEMP_PASSWORD_ALPHABET}]{${TEMP_PASSWORD_LENGTH}}$`)).textContent ?? ''
}
