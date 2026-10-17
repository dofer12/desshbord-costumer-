import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AVI, inRow, MICHAL, namesShown, NOAM, openAdmin, rowOf, temporaryPassword, YAEL } from '../../test/adminHarness'
import { DANA, OWNER } from '../../test/fakeGateway'
import { ADMIN_MESSAGES, adminMessage, type UserFailureCode, type UserOutcome } from './gateways'

// What an administrator does to a person who is already on the list: reset the password, block, change the
// role, change the name. Each is a request to the function, which has the last word, and each says what
// happened in words, in the place where the person is looking.

const list = () => screen.findByRole('list', { name: 'רשימת העובדים' })
const pending = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}
const ok = (user = DANA): UserOutcome => ({ ok: true, user })

describe('resetting a password', () => {
  async function ask(name = 'דנה', options: Parameters<typeof openAdmin>[0] = {}) {
    const app = await openAdmin(options)
    await list()
    await app.user.click(inRow(name).getByRole('button', { name: `איפוס סיסמה: ${name}` }))
    return { ...app, dialog: within(await screen.findByRole('dialog', { name: 'איפוס סיסמה' })) }
  }

  it('asks first, naming the person and what it means, and the cursor is on the safe answer', async () => {
    const { dialog } = await ask()
    expect(dialog.getByText(/לאפס את הסיסמה של דנה\?/)).toBeInTheDocument()
    expect(dialog.getByText(/נותק מכל המכשירים/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'ביטול' })).toHaveFocus()
    // A reset is asked about, and can be done again: it does not look like a block.
    expect(dialog.getByRole('button', { name: 'איפוס' })).not.toHaveClass('danger')
  })

  it('does nothing when the person says no', async () => {
    const { dialog, user, backend } = await ask()
    const reset = vi.spyOn(backend.backend.admin.users, 'resetPassword')
    await user.click(dialog.getByRole('button', { name: 'ביטול' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reset).not.toHaveBeenCalled()
    expect(inRow('דנה').queryByText('ממתין להחלפת סיסמה')).not.toBeInTheDocument()
  })

  it('makes a new temporary password, shows it once, and the person is asked to choose again', async () => {
    const { dialog, user, backend } = await ask()
    const reset = vi.spyOn(backend.backend.admin.users, 'resetPassword')
    await user.click(dialog.getByRole('button', { name: 'איפוס' }))

    const done = await screen.findByRole('dialog', { name: 'הסיסמה אופסה' })
    expect(reset).toHaveBeenCalledExactlyOnceWith(DANA.id)
    expect(within(done).getByText(/דנה/)).toBeInTheDocument()
    const password = temporaryPassword()
    expect(password).toHaveLength(16)

    await user.click(within(done).getByRole('button', { name: 'סגירה' }))
    expect(document.body.innerHTML).not.toContain(password)
    expect(inRow('דנה').getByText('ממתין להחלפת סיסמה')).toBeInTheDocument()
    expect(backend.directory.profiles.find((p) => p.id === DANA.id)?.must_change_password).toBe(true)
  })

  it('sends one request for a double click, and nothing else can be done while it is on its way', async () => {
    const { dialog, user, backend } = await ask()
    const answer = pending<UserOutcome>()
    const reset = vi.spyOn(backend.backend.admin.users, 'resetPassword').mockReturnValue(answer.promise)
    await user.dblClick(dialog.getByRole('button', { name: 'איפוס' }))
    expect(await dialog.findByRole('button', { name: 'מבצע…' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'ביטול' })).toBeDisabled()
    // Neither can the buttons behind it be used.
    expect(inRow('הבעלים').getByRole('button', { name: 'שינוי שם: הבעלים' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'עובד חדש' })).toBeDisabled()
    answer.resolve({ ok: true, user: DANA, tempPassword: 'Kq7mWx3RnTb9HdYz' })
    await screen.findByRole('dialog', { name: 'הסיסמה אופסה' })
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('says what went wrong, in the page, and leaves the list as it was', async () => {
    const { dialog, user, backend } = await ask()
    vi.spyOn(backend.backend.admin.users, 'resetPassword').mockResolvedValue({ ok: false, code: 'failed' })
    await user.click(dialog.getByRole('button', { name: 'איפוס' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.failed)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(namesShown()).toEqual(['דנה', 'הבעלים'])
    expect(inRow('דנה').getByRole('button', { name: 'איפוס סיסמה: דנה' })).toBeEnabled()
  })

  it('does not reset the password of the person who is looking: the profile page is for that', async () => {
    await openAdmin()
    await list()
    expect(inRow('הבעלים').queryByRole('button', { name: /איפוס סיסמה/ })).not.toBeInTheDocument()
    expect(inRow('הבעלים').getByText(/לשינוי הסיסמה שלך השתמשו/)).toBeInTheDocument()
    expect(inRow('הבעלים').getByRole('link', { name: 'בפרופיל' })).toHaveAttribute('href', '/profile')
    expect(inRow('דנה').queryByText(/לשינוי הסיסמה שלך/)).not.toBeInTheDocument()
  })
})

describe('blocking and unblocking', () => {
  async function ask(name = 'דנה') {
    const app = await openAdmin({ people: [OWNER, DANA, MICHAL, AVI] })
    await list()
    await app.user.click(inRow(name).getByRole('button', { name: `חסימה: ${name}` }))
    return { ...app, dialog: within(await screen.findByRole('dialog', { name: 'חסימת עובד' })) }
  }

  it('asks first when it is a block, naming the person and what it means', async () => {
    const { dialog } = await ask()
    expect(dialog.getByText(/לחסום את דנה\?/)).toBeInTheDocument()
    expect(dialog.getByText(/ינותק מכל המכשירים/)).toBeInTheDocument()
    expect(dialog.getByText(/המשימות שלו נשארות/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'ביטול' })).toHaveFocus()
    // Blocking is the answer that looks like what it is.
    expect(dialog.getByRole('button', { name: 'חסימה' })).toHaveClass('danger')
  })

  it('does nothing when the person says no', async () => {
    const { dialog, user, backend } = await ask()
    const block = vi.spyOn(backend.backend.admin.users, 'setActive')
    await user.click(dialog.getByRole('button', { name: 'ביטול' }))
    expect(block).not.toHaveBeenCalled()
    expect(inRow('דנה').getByText('פעיל')).toBeInTheDocument()
  })

  it('blocks the person, who then shows as blocked, and is listed after the active ones', async () => {
    const { dialog, user, backend } = await ask()
    const block = vi.spyOn(backend.backend.admin.users, 'setActive')
    await user.click(dialog.getByRole('button', { name: 'חסימה' }))
    await waitFor(() => expect(inRow('דנה').getByText('מושבת')).toBeInTheDocument())
    expect(block).toHaveBeenCalledExactlyOnceWith(DANA.id, false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(namesShown()).toEqual(['אבי לוי', 'הבעלים', 'דנה', 'מיכל ברק'])
    expect(inRow('דנה').getByRole('button', { name: 'שחרור: דנה' })).toBeEnabled()
    expect(inRow('דנה').queryByRole('button', { name: 'חסימה: דנה' })).not.toBeInTheDocument()
  })

  it('unblocks without asking, since nothing is lost by it', async () => {
    const { user, backend } = await openAdmin({ people: [OWNER, DANA, MICHAL] })
    await list()
    const unblock = vi.spyOn(backend.backend.admin.users, 'setActive')
    await user.click(inRow('מיכל ברק').getByRole('button', { name: 'שחרור: מיכל ברק' }))
    await waitFor(() => expect(inRow('מיכל ברק').getByText('פעיל')).toBeInTheDocument())
    expect(unblock).toHaveBeenCalledExactlyOnceWith(MICHAL.id, true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(inRow('מיכל ברק').getByRole('button', { name: 'חסימה: מיכל ברק' })).toBeEnabled()
  })

  it('sends one request for a double click', async () => {
    const { dialog, user, backend } = await ask()
    const answer = pending<UserOutcome>()
    const block = vi.spyOn(backend.backend.admin.users, 'setActive').mockReturnValue(answer.promise)
    await user.dblClick(dialog.getByRole('button', { name: 'חסימה' }))
    answer.resolve(ok({ ...DANA, is_active: false }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(block).toHaveBeenCalledTimes(1)
  })

  it('says what went wrong, in the page, and the person is still active', async () => {
    const { dialog, user, backend } = await ask()
    vi.spyOn(backend.backend.admin.users, 'setActive').mockResolvedValue({ ok: false, code: 'network' })
    await user.click(dialog.getByRole('button', { name: 'חסימה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.network)
    expect(inRow('דנה').getByText('פעיל')).toBeInTheDocument()
    expect(inRow('דנה').getByRole('button', { name: 'חסימה: דנה' })).toBeEnabled()
  })

  it('does not block the person who is looking: they would shut themselves out', async () => {
    await openAdmin()
    await list()
    expect(inRow('הבעלים').queryByRole('button', { name: /חסימה|שחרור/ })).not.toBeInTheDocument()
  })
})

describe('the role', () => {
  it('makes an employee a manager, and says so on the row', async () => {
    const { user, backend } = await openAdmin()
    await list()
    const setRole = vi.spyOn(backend.backend.admin.users, 'setRole')
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    await waitFor(() => expect(inRow('דנה').getByText('מנהל')).toBeInTheDocument())
    expect(setRole).toHaveBeenCalledExactlyOnceWith(DANA.id, 'admin')
    expect(inRow('דנה').getByRole('button', { name: 'הפיכה לעובד: דנה' })).toBeEnabled()
    expect(inRow('דנה').queryByRole('button', { name: 'הפיכה למנהל: דנה' })).not.toBeInTheDocument()
  })

  it('makes a manager an employee when there is another active manager', async () => {
    const { user, backend } = await openAdmin({ people: [OWNER, YAEL, DANA] })
    await list()
    const setRole = vi.spyOn(backend.backend.admin.users, 'setRole')
    await user.click(inRow('יעל גולן').getByRole('button', { name: 'הפיכה לעובד: יעל גולן' }))
    await waitFor(() => expect(inRow('יעל גולן').getByText('עובד')).toBeInTheDocument())
    expect(setRole).toHaveBeenCalledExactlyOnceWith(YAEL.id, 'employee')
  })

  it('does not let the one active manager become an employee, and says why next to the button', async () => {
    await openAdmin()
    await list()
    const demote = inRow('הבעלים').getByRole('button', { name: 'הפיכה לעובד: הבעלים' })
    expect(demote).toBeDisabled()
    expect(demote).toHaveAccessibleDescription(/המנהל הפעיל היחיד/)
    expect(inRow('הבעלים').getByText(/הגדירו קודם מנהל נוסף/)).toBeInTheDocument()
  })

  it('counts only the managers who are active: a blocked one is no help', async () => {
    await openAdmin({ people: [OWNER, { ...YAEL, is_active: false }, DANA] })
    await list()
    expect(inRow('הבעלים').getByRole('button', { name: 'הפיכה לעובד: הבעלים' })).toBeDisabled()
  })

  it('lets a manager become an employee themselves when there is another, and the area is closed to them as soon as the profile says so', async () => {
    const { user, fake, store } = await openAdmin({ people: [OWNER, YAEL, DANA] })
    await list()
    expect(inRow('הבעלים').getByRole('button', { name: 'הפיכה לעובד: הבעלים' })).toBeEnabled()
    await user.click(inRow('הבעלים').getByRole('button', { name: 'הפיכה לעובד: הבעלים' }))
    await waitFor(() => expect(inRow('הבעלים').getByText('עובד')).toBeInTheDocument())

    fake.fetchProfile.mockResolvedValue({ ...OWNER, role: 'employee' })
    await act(() => store.getState().recheck())
    expect(await screen.findByRole('heading', { level: 2, name: 'היום' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'ניהול' })).not.toBeInTheDocument()
  })

  it('shows the answer of the function when the screen was out of date and the last manager was about to go', async () => {
    const { user, backend } = await openAdmin({ people: [OWNER, YAEL, DANA] })
    await list()
    vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValue({ ok: false, code: 'last_admin' })
    await user.click(inRow('יעל גולן').getByRole('button', { name: 'הפיכה לעובד: יעל גולן' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.last_admin)
    expect(inRow('יעל גולן').getByText('מנהל')).toBeInTheDocument()
  })
})

describe('the name', () => {
  async function edit(name = 'דנה') {
    const app = await openAdmin()
    await list()
    await app.user.click(inRow(name).getByRole('button', { name: `שינוי שם: ${name}` }))
    return { ...app, input: () => within(rowOf(name)).getByLabelText('שם חדש') }
  }

  it('is edited in the row, which starts with the name that is there, and the cursor in it', async () => {
    const { input } = await edit()
    expect(input()).toHaveValue('דנה')
    expect(input()).toHaveFocus()
    // Only that row is being edited.
    expect(inRow('הבעלים').queryByLabelText('שם חדש')).not.toBeInTheDocument()
  })

  it('is saved trimmed, and the row shows it; the button that opened the edit has the cursor again', async () => {
    const { input, user, backend } = await edit()
    const rename = vi.spyOn(backend.backend.admin.users, 'rename')
    await user.clear(input())
    await user.type(input(), '  דנה כהן ')
    await user.click(inRow('דנה').getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(namesShown()).toContain('דנה כהן'))
    expect(rename).toHaveBeenCalledExactlyOnceWith(DANA.id, 'דנה כהן')
    expect(screen.queryByLabelText('שם חדש')).not.toBeInTheDocument()
    expect(inRow('דנה כהן').getByRole('button', { name: 'שינוי שם: דנה כהן' })).toHaveFocus()
  })

  it('is saved with the Enter key too', async () => {
    const { input, user } = await edit()
    await user.clear(input())
    await user.type(input(), 'דנה לוי{Enter}')
    await waitFor(() => expect(namesShown()).toContain('דנה לוי'))
  })

  it('is given up with the button or the Escape key, and nothing is sent', async () => {
    const { input, user, backend } = await edit()
    const rename = vi.spyOn(backend.backend.admin.users, 'rename')
    await user.type(input(), 'x')
    await user.click(inRow('דנה').getByRole('button', { name: 'ביטול' }))
    expect(screen.queryByLabelText('שם חדש')).not.toBeInTheDocument()
    expect(namesShown()).toContain('דנה')

    await user.click(inRow('דנה').getByRole('button', { name: 'שינוי שם: דנה' }))
    expect(input()).toHaveValue('דנה')
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('שם חדש')).not.toBeInTheDocument()
    expect(rename).not.toHaveBeenCalled()
  })

  it('asks again, in the row, for a name that is empty or too long, and sends nothing', async () => {
    const { input, user, backend } = await edit()
    const rename = vi.spyOn(backend.backend.admin.users, 'rename')
    await user.clear(input())
    await user.click(inRow('דנה').getByRole('button', { name: 'שמירה' }))
    expect(inRow('דנה').getByText('הזינו שם.')).toBeInTheDocument()
    expect(input()).toBeInvalid()
    expect(input()).toHaveAccessibleDescription('הזינו שם.')
    expect(input()).toHaveFocus()

    await user.type(input(), 'א'.repeat(61))
    await user.click(inRow('דנה').getByRole('button', { name: 'שמירה' }))
    expect(inRow('דנה').getByText('השם ארוך מדי: עד 60 תווים.')).toBeInTheDocument()
    expect(rename).not.toHaveBeenCalled()
  })

  it('says that the name is taken, keeps the edit open with what was typed, and the person can go on', async () => {
    const { input, user } = await edit()
    await user.clear(input())
    await user.type(input(), 'הבעלים')
    await user.click(inRow('דנה').getByRole('button', { name: 'שמירה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(adminMessage({ ok: false, code: 'name_taken', field: 'display_name' }))
    expect(input()).toHaveValue('הבעלים')
    expect(inRow('דנה').getByRole('button', { name: 'שמירה' })).toBeEnabled()
    expect(namesShown()).toEqual(['דנה', 'הבעלים'])
  })

  it('may be the same name, which is saved as it is', async () => {
    const { user } = await edit()
    await user.click(inRow('דנה').getByRole('button', { name: 'שמירה' }))
    await waitFor(() => expect(screen.queryByLabelText('שם חדש')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('can be that of the person who is looking, too', async () => {
    const { user } = await openAdmin()
    await list()
    await user.click(inRow('הבעלים').getByRole('button', { name: 'שינוי שם: הבעלים' }))
    const input = within(rowOf('הבעלים')).getByLabelText('שם חדש')
    await user.clear(input)
    await user.type(input, 'בעל הבית{Enter}')
    await waitFor(() => expect(namesShown()).toContain('בעל הבית'))
  })

  it.each([
    ['a row that comes after it', 'דנה', 'הבעלים'],
    ['a row that comes before it', 'הבעלים', 'דנה'],
  ])('is edited in one row at a time: an edit in %s closes the first, and the cursor is where the person went', async (_where, first, second) => {
    const { user } = await edit(first)
    await user.click(inRow(second).getByRole('button', { name: `שינוי שם: ${second}` }))
    expect(screen.getAllByLabelText('שם חדש')).toHaveLength(1)
    expect(within(rowOf(second)).getByLabelText('שם חדש')).toHaveFocus()
  })
})

describe('whatever goes wrong', () => {
  const CODES: UserFailureCode[] = ['unauthenticated', 'forbidden', 'invalid', 'not_found', 'failed', 'network', 'not_deployed']

  it.each(CODES)('says it in words when the function answers "%s", and the list and the buttons stay as they were', async (code) => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValue({ ok: false, code })
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES[code])
    expect(namesShown()).toEqual(['דנה', 'הבעלים'])
    expect(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' })).toBeEnabled()
    expect(inRow('דנה').getByRole('button', { name: 'שינוי שם: דנה' })).toBeEnabled()
  })

  it('says that it failed, and goes on, when a call throws instead of answering', async () => {
    const { user, backend } = await openAdmin()
    await list()
    const setRole = vi.spyOn(backend.backend.admin.users, 'setRole').mockRejectedValueOnce(new Error('connection to 10.0.0.5 refused'))
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ADMIN_MESSAGES.failed)
    expect(alert.textContent).not.toContain('10.0.0.5')
    expect(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' })).toBeEnabled()
    // And the next request goes through.
    setRole.mockRestore()
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    await waitFor(() => expect(inRow('דנה').getByText('מנהל')).toBeInTheDocument())
  })

  it('does not show what the function wrote, only its own sentence', async () => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValue({ ok: false, code: 'failed', field: 'connection to 10.0.0.5 refused' })
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('10.0.0.5')
  })

  it('takes the message away when the next thing is done', async () => {
    const { user, backend } = await openAdmin()
    await list()
    const setRole = vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValueOnce({ ok: false, code: 'failed' })
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    setRole.mockRestore()
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(inRow('דנה').getByText('מנהל')).toBeInTheDocument()
  })

  it('does not ask for the list again when the server cannot be reached: it would only fail the same way', async () => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValue({ ok: false, code: 'network' })
    const loads = backend.directory.loads
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.network)
    expect(backend.directory.loads).toBe(loads)
  })

  it('asks for the list again after every answer that came from the function, so that a screen that was out of date is put right', async () => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'setRole').mockResolvedValue({ ok: false, code: 'forbidden' })
    const loads = backend.directory.loads
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    await screen.findByRole('alert')
    await waitFor(() => expect(backend.directory.loads).toBe(loads + 1))
  })

  it('says that something went wrong when the function says yes and sends no password to hand over', async () => {
    const { user, backend } = await openAdmin()
    await list()
    vi.spyOn(backend.backend.admin.users, 'resetPassword').mockResolvedValue({ ok: true, user: DANA })
    await user.click(inRow('דנה').getByRole('button', { name: 'איפוס סיסמה: דנה' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'איפוס סיסמה' })).getByRole('button', { name: 'איפוס' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.failed)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('brings the list up to date when the function says that the person is not there any more', async () => {
    const { user, backend } = await openAdmin({ people: [OWNER, DANA, AVI] })
    await list()
    // Another administrator removed the person; this screen has not heard of it.
    backend.directory.memory.profiles = backend.directory.memory.profiles.filter((p) => p.id !== AVI.id)
    await user.click(inRow('אבי לוי').getByRole('button', { name: 'הפיכה למנהל: אבי לוי' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.not_found)
    await waitFor(() => expect(namesShown()).toEqual(['דנה', 'הבעלים']))
  })

  it('shows the refusal of the function when the person was demoted behind the back of the screen: the function is the protection, not the screen', async () => {
    const { user, backend } = await openAdmin()
    await list()
    backend.actAs(DANA.id)
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ADMIN_MESSAGES.forbidden)
    expect(backend.directory.profiles.find((p) => p.id === DANA.id)?.role).toBe('employee')
  })

  it('cannot be done twice at once: a second action is not sent while the first is on its way', async () => {
    const { user, backend } = await openAdmin({ people: [OWNER, DANA, AVI] })
    await list()
    const answer = pending<UserOutcome>()
    const setRole = vi.spyOn(backend.backend.admin.users, 'setRole').mockReturnValue(answer.promise)
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    expect(inRow('אבי לוי').getByRole('button', { name: 'הפיכה למנהל: אבי לוי' })).toBeDisabled()
    await user.click(inRow('אבי לוי').getByRole('button', { name: 'הפיכה למנהל: אבי לוי' }))
    answer.resolve(ok({ ...DANA, role: 'admin' }))
    await waitFor(() => expect(inRow('אבי לוי').getByRole('button', { name: 'הפיכה למנהל: אבי לוי' })).toBeEnabled())
    expect(setRole).toHaveBeenCalledTimes(1)
  })

  it('shows a change even when the live connection says nothing of it, since the answer of the function brings the list up to date', async () => {
    const { user, backend } = await openAdmin()
    await list()
    // The live connection is silent: nothing tells the screen of the change but the answer of the function.
    backend.directory.memory.changed = () => undefined
    await user.click(inRow('דנה').getByRole('button', { name: 'הפיכה למנהל: דנה' }))
    await waitFor(() => expect(inRow('דנה').getByText('מנהל')).toBeInTheDocument())
  })

  it('lists people with no tasks and people with tasks alike: nobody is ever removed', async () => {
    const { backend } = await openAdmin({ people: [OWNER, DANA, NOAM] })
    await list()
    expect(namesShown()).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /מחיקה|הסרה/ })).not.toBeInTheDocument()
    expect(backend.directory.profiles).toHaveLength(3)
  })
})
