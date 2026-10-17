import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AVI, inRow, MICHAL, namesShown, NOAM, openAdmin, rowOf, temporaryPassword, YAEL } from '../../test/adminHarness'
import { DANA, OWNER } from '../../test/fakeGateway'
import type { Profile } from '../auth/types'
import { ADMIN_MESSAGES } from './gateways'

// The screen where an administrator looks after the team: who is in it, and how a person gets in.

const list = () => screen.findByRole('list', { name: 'רשימת העובדים' })
const newEmployee = () => screen.getByRole('button', { name: 'עובד חדש' })

describe('the list of the employees', () => {
  it('shows every person, with the name, the e-mail, the role, and whether they are active', async () => {
    await openAdmin({ people: [OWNER, DANA, AVI, MICHAL, NOAM] })
    await list()

    expect(inRow('הבעלים').getByText('owner@example.com')).toBeInTheDocument()
    expect(inRow('הבעלים').getByText('מנהל')).toBeInTheDocument()
    expect(inRow('הבעלים').getByText('פעיל')).toBeInTheDocument()
    expect(inRow('דנה').getByText('עובד')).toBeInTheDocument()
    expect(inRow('דנה').getByText('dana@example.com')).toBeInTheDocument()
    // A blocked person is still on the list, and says so.
    expect(inRow('מיכל ברק').getByText('מושבת')).toBeInTheDocument()
    expect(inRow('מיכל ברק').queryByText('פעיל')).not.toBeInTheDocument()
  })

  it('says of the person who has not chosen a password yet that it is waiting for them, and of nobody else', async () => {
    await openAdmin({ people: [OWNER, DANA, NOAM] })
    await list()
    expect(inRow('נועם שמש').getByText('ממתין להחלפת סיסמה')).toBeInTheDocument()
    expect(inRow('דנה').queryByText('ממתין להחלפת סיסמה')).not.toBeInTheDocument()
    expect(screen.getAllByText('ממתין להחלפת סיסמה')).toHaveLength(1)
  })

  it('shows the active people first, each group in the order of the alphabet, and marks the person who is looking', async () => {
    await openAdmin({ people: [MICHAL, OWNER, NOAM, DANA, AVI] })
    await list()
    expect(namesShown()).toEqual(['אבי לוי', 'דנה', 'הבעלים', 'נועם שמש', 'מיכל ברק'])
    expect(inRow('הבעלים').getByText('אתם')).toBeInTheDocument()
    expect(screen.getAllByText('אתם')).toHaveLength(1)
  })

  it('shows two hundred people, and a name that is very long, without leaving anybody out', async () => {
    const crowd: Profile[] = Array.from({ length: 200 }, (_, i) => ({
      ...AVI,
      id: `u-${i}`,
      email: `person${i}@example.com`,
      display_name: `עובד מספר ${String(i).padStart(3, '0')}`,
    }))
    const long = { ...AVI, id: 'u-long', email: 'long@example.com', display_name: 'ש'.repeat(60) }
    await openAdmin({ people: [OWNER, long, ...crowd] })
    await list()
    expect(namesShown()).toHaveLength(202)
    expect(rowOf('ש'.repeat(60))).toBeInTheDocument()
    expect(rowOf('עובד מספר 199')).toBeInTheDocument()
  })

  it('has the heading of the screen, and a way to add somebody', async () => {
    await openAdmin()
    expect(await screen.findByRole('heading', { level: 3, name: 'עובדים' })).toBeInTheDocument()
    expect(newEmployee()).toBeEnabled()
  })

  it('is brought up to date by what other administrators do, as the live connection tells it', async () => {
    const { backend } = await openAdmin()
    await list()
    expect(screen.queryByText('אבי לוי')).not.toBeInTheDocument()

    act(() => {
      backend.directory.profiles = [...backend.directory.profiles, { ...AVI }]
      backend.directory.changed()
    })
    expect(await screen.findByText('אבי לוי')).toBeInTheDocument()

    act(() => {
      backend.directory.profiles = backend.directory.profiles.map((p) => (p.id === AVI.id ? { ...p, display_name: 'אבי כהן', is_active: false } : p))
      backend.directory.changed()
    })
    expect(await screen.findByText('אבי כהן')).toBeInTheDocument()
    expect(screen.queryByText('אבי לוי')).not.toBeInTheDocument()
    expect(inRow('אבי כהן').getByText('מושבת')).toBeInTheDocument()
  })

  it('says that it is loading while the people are on their way, and shows no list yet', async () => {
    await openAdmin({
      backend: (fake) => {
        fake.directory.gateway.load = () => new Promise(() => undefined)
      },
    })
    expect(await screen.findByText('טוען…')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'רשימת העובדים' })).not.toBeInTheDocument()
  })

  it('says that the people could not be loaded at the start, shows no list, and loads them when the person asks', async () => {
    const { user, backend } = await openAdmin({ backend: (fake) => fake.directory.setOffline(true) })
    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent('אין חיבור לשרת')
    expect(screen.queryByRole('list', { name: 'רשימת העובדים' })).not.toBeInTheDocument()
    backend.directory.setOffline(false)
    await user.click(within(note).getByRole('button', { name: 'נסו שוב' }))
    expect(await list()).toBeInTheDocument()
    expect(namesShown()).toEqual(['דנה', 'הבעלים'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says that the people could not be loaded, and loads them again when the person asks', async () => {
    const { backend, user } = await openAdmin({ people: [OWNER, DANA] })
    await list()
    backend.directory.failNext(new TypeError('Failed to fetch'))
    // The screen has the people it had; a load that fails is told in a line, and the next one puts it right.
    await act(async () => {
      backend.directory.changed()
    })
    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent('אין חיבור לשרת')
    await user.click(within(note).getByRole('button', { name: 'נסו שוב' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(namesShown()).toEqual(['דנה', 'הבעלים'])
  })
})

describe('a new employee', () => {
  async function openForm() {
    const app = await openAdmin()
    await list()
    await app.user.click(newEmployee())
    return { ...app, dialog: within(await screen.findByRole('dialog', { name: 'עובד חדש' })) }
  }

  it('is asked for in a form with a name, an e-mail and a role, which is an employee unless it says otherwise', async () => {
    const { dialog } = await openForm()
    expect(dialog.getByLabelText('שם')).toHaveFocus()
    expect(dialog.getByLabelText('אימייל')).toHaveAttribute('type', 'email')
    expect(dialog.getByLabelText('אימייל')).toHaveAttribute('dir', 'ltr')
    expect(dialog.getByLabelText('תפקיד')).toHaveValue('employee')
    expect(within(dialog.getByLabelText('תפקיד')).getAllByRole('option').map((o) => o.textContent)).toEqual(['עובד', 'מנהל'])
    expect(dialog.getByRole('button', { name: 'יצירה' })).toBeEnabled()
  })

  it('asks again for what is missing or wrong, with the cursor on the first, and does not call the function', async () => {
    const { dialog, user, backend } = await openForm()
    const create = vi.spyOn(backend.backend.admin.users, 'create')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    expect(dialog.getByText('הזינו שם.')).toBeInTheDocument()
    expect(dialog.getByText('הזינו כתובת אימייל.')).toBeInTheDocument()
    expect(dialog.getByLabelText('שם')).toHaveFocus()
    expect(dialog.getByLabelText('שם')).toBeInvalid()

    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    expect(dialog.getByText('כתובת האימייל אינה תקינה.')).toBeInTheDocument()
    expect(dialog.queryByText('הזינו שם.')).not.toBeInTheDocument()
    expect(dialog.getByLabelText('אימייל')).toHaveFocus()
    expect(create).not.toHaveBeenCalled()
  })

  it('makes the person, and shows the temporary password once, in a dialog of its own', async () => {
    const { dialog, user, backend, clipboard } = await openForm()
    await user.type(dialog.getByLabelText('שם'), '  רינה כהן ')
    await user.type(dialog.getByLabelText('אימייל'), '  Rina@Example.com ')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))

    const created = await screen.findByRole('dialog', { name: 'העובד נוצר' })
    expect(screen.queryByRole('dialog', { name: 'עובד חדש' })).not.toBeInTheDocument()
    expect(created).toHaveTextContent('רינה כהן')
    const password = temporaryPassword()
    expect(password).toHaveLength(16)

    // It is on the screen once, copied by a button, and goes where the person puts it.
    await user.click(within(created).getByRole('button', { name: 'העתקת הסיסמה' }))
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(password)
    expect(await within(created).findByText('הועתק')).toBeInTheDocument()

    // The address was made as the sign-in reads it, and the name as it was typed, trimmed.
    expect(backend.directory.profiles.find((p) => p.email === 'rina@example.com')).toMatchObject({
      display_name: 'רינה כהן',
      role: 'employee',
      is_active: true,
      must_change_password: true,
    })

    await user.click(within(created).getByRole('button', { name: 'סגירה' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(password)
    expect(document.body.innerHTML).not.toContain(password)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(password)
    expect(location.href).not.toContain(password)
  })

  it('shows the new person in the list, as one who has still to choose a password', async () => {
    const { dialog, user } = await openForm()
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'העובד נוצר' })).getByRole('button', { name: 'סגירה' }))
    expect(inRow('רינה כהן').getByText('ממתין להחלפת סיסמה')).toBeInTheDocument()
    expect(inRow('רינה כהן').getByText('rina@example.com')).toBeInTheDocument()
  })

  it('may be an administrator', async () => {
    const { dialog, user, backend } = await openForm()
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await user.selectOptions(dialog.getByLabelText('תפקיד'), 'admin')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    await screen.findByRole('dialog', { name: 'העובד נוצר' })
    expect(backend.directory.profiles.find((p) => p.email === 'rina@example.com')?.role).toBe('admin')
  })

  it.each([
    ['an e-mail that is in use', { email: 'dana@example.com', name: 'רינה כהן' }, ADMIN_MESSAGES.email_taken, 'אימייל'],
    ['a name that is in use', { email: 'rina@example.com', name: 'דנה' }, ADMIN_MESSAGES.name_taken, 'שם'],
  ])('says so, and keeps the form with what was typed, after %s', async (_what, typed, message, field) => {
    const { dialog, user, backend } = await openForm()
    const before = backend.directory.profiles.length
    await user.type(dialog.getByLabelText('שם'), typed.name)
    await user.type(dialog.getByLabelText('אימייל'), typed.email)
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(dialog.getByLabelText(field)).toBeInvalid()
    expect(dialog.getByLabelText('שם')).toHaveValue(typed.name)
    expect(dialog.getByLabelText('אימייל')).toHaveValue(typed.email)
    expect(dialog.getByRole('button', { name: 'יצירה' })).toBeEnabled()
    expect(screen.queryByRole('dialog', { name: 'העובד נוצר' })).not.toBeInTheDocument()
    expect(backend.directory.profiles).toHaveLength(before)
  })

  it.each([
    ['network', ADMIN_MESSAGES.network],
    ['not_deployed', ADMIN_MESSAGES.not_deployed],
    ['forbidden', ADMIN_MESSAGES.forbidden],
    ['failed', ADMIN_MESSAGES.failed],
  ] as const)('says what is wrong, and stays usable, when the function answers "%s"', async (code, message) => {
    const { dialog, user, backend } = await openForm()
    vi.spyOn(backend.backend.admin.users, 'create').mockResolvedValue({ ok: false, code })
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(message)
    expect(dialog.getByRole('button', { name: 'יצירה' })).toBeEnabled()
    expect(dialog.getByLabelText('שם')).toHaveValue('רינה כהן')
  })

  it('sends one request for a double click, and the buttons wait for the answer', async () => {
    const { dialog, user, backend } = await openForm()
    let answer: (outcome: Awaited<ReturnType<typeof backend.backend.admin.users.create>>) => void = () => undefined
    const create = vi.spyOn(backend.backend.admin.users, 'create').mockReturnValue(new Promise((resolve) => (answer = resolve)))
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await user.dblClick(dialog.getByRole('button', { name: 'יצירה' }))
    expect(await dialog.findByRole('button', { name: 'מבצע…' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'ביטול' })).toBeDisabled()
    answer({ ok: false, code: 'failed' })
    expect(await dialog.findByRole('alert')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('is given up with the button or the Escape key, and nothing is made', async () => {
    const { dialog, user, backend } = await openForm()
    const create = vi.spyOn(backend.backend.admin.users, 'create')
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.click(dialog.getByRole('button', { name: 'ביטול' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(newEmployee()).toHaveFocus()

    await user.click(newEmployee())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
    // A form that was given up starts empty the next time.
    await user.click(newEmployee())
    expect(screen.getByLabelText('שם')).toHaveValue('')
  })
})

describe('the temporary password of a new employee', () => {
  async function create() {
    const app = await openAdmin({ dataRouter: true })
    await list()
    await app.user.click(newEmployee())
    const dialog = within(await screen.findByRole('dialog', { name: 'עובד חדש' }))
    await app.user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await app.user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await app.user.click(dialog.getByRole('button', { name: 'יצירה' }))
    await screen.findByRole('dialog', { name: 'העובד נוצר' })
    return { ...app, password: temporaryPassword() }
  }

  it('is gone from the page when the person goes to another page', async () => {
    const { router, password } = await create()
    await act(async () => {
      await router!.navigate('/admin/statuses')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(password)
  })

  it('is gone from the page when the person signs out', async () => {
    const { store, password } = await create()
    await act(async () => {
      await store.getState().signOut()
    })
    expect(await screen.findByRole('button', { name: 'כניסה' })).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(password)
  })

  it('is not shown to somebody else: if the person of the session changes while the page is open, the dialog goes', async () => {
    const { store, password } = await create()
    act(() => store.setState({ profile: { ...OWNER, id: 'u-somebody-else' } }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(password)
  })

  it('says that something went wrong when the function says yes to a new person and sends no password to hand over', async () => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'create').mockResolvedValue({ ok: true, user: { ...AVI, id: 'u-new' } })
    await user.click(newEmployee())
    const dialog = within(await screen.findByRole('dialog', { name: 'עובד חדש' }))
    await user.type(dialog.getByLabelText('שם'), 'רינה כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'rina@example.com')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.failed)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not come back when the person returns to the page', async () => {
    const { router, password } = await create()
    await act(async () => {
      await router!.navigate('/admin/statuses')
    })
    await act(async () => {
      await router!.navigate('/admin/employees')
    })
    await list()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(password)
  })

  it('is not the same twice: two new people have two passwords', async () => {
    const { user, password } = await create()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'סגירה' }))
    await user.click(newEmployee())
    const dialog = within(await screen.findByRole('dialog', { name: 'עובד חדש' }))
    await user.type(dialog.getByLabelText('שם'), 'רונן כהן')
    await user.type(dialog.getByLabelText('אימייל'), 'ronen@example.com')
    await user.click(dialog.getByRole('button', { name: 'יצירה' }))
    await screen.findByRole('dialog', { name: 'העובד נוצר' })
    expect(temporaryPassword()).not.toBe(password)
  })
})

describe('the other managers', () => {
  it('are listed as such, with a role button of their own', async () => {
    await openAdmin({ people: [OWNER, YAEL, DANA] })
    await list()
    expect(inRow('יעל גולן').getByText('מנהל')).toBeInTheDocument()
    expect(inRow('יעל גולן').getByRole('button', { name: 'הפיכה לעובד: יעל גולן' })).toBeEnabled()
  })
})
