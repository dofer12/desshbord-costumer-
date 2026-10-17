import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AVI } from '../../test/adminHarness'
import { adminMessage, type UserOutcome } from './gateways'
import { NewEmployeeDialog } from './NewEmployeeDialog'

// The form of a new employee on its own: what it sends, what it keeps, and what it says when the function
// says no. How the page makes use of the answer is tried with the page (EmployeesPage.test.tsx).

type Create = (input: { email: string; display_name: string; role: 'admin' | 'employee' }) => Promise<UserOutcome | null>

function setup(create: Create = vi.fn<Create>().mockResolvedValue(null)) {
  const onCreated = vi.fn()
  const onCancel = vi.fn()
  render(<NewEmployeeDialog create={create} onCreated={onCreated} onCancel={onCancel} />)
  return { create, onCreated, onCancel, user: userEvent.setup() }
}

async function fill(user: ReturnType<typeof userEvent.setup>, name = '  רינה כהן ', email = ' Rina@Example.COM ') {
  await user.type(screen.getByLabelText('שם'), name)
  await user.type(screen.getByLabelText('אימייל'), email)
}

describe('NewEmployeeDialog', () => {
  it('sends the name trimmed, the address as the sign-in reads it, and the role that was chosen', async () => {
    const create = vi.fn<Create>().mockResolvedValue(null)
    const { user } = setup(create)
    await fill(user)
    await user.selectOptions(screen.getByLabelText('תפקיד'), 'admin')
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(create).toHaveBeenCalledExactlyOnceWith({ email: 'rina@example.com', display_name: 'רינה כהן', role: 'admin' })
  })

  it('sends an employee unless the role was changed', async () => {
    const create = vi.fn<Create>().mockResolvedValue(null)
    const { user } = setup(create)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ role: 'employee' }))
  })

  it('hands the person who was made to the page, and nothing is said in the form', async () => {
    const made: UserOutcome = { ok: true, user: AVI, tempPassword: 'Kq7mWx3RnTb9HdYz' }
    const { user, onCreated } = setup(vi.fn<Create>().mockResolvedValue(made))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(made)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('waits, and stays as it is, when the page says that another request is still on its way', async () => {
    const { user, onCreated } = setup(vi.fn<Create>().mockResolvedValue(null))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(onCreated).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'יצירה' })).toBeEnabled()
    expect(screen.getByLabelText('שם')).toHaveValue('  רינה כהן ')
  })

  it.each([
    ['the e-mail', 'email', 'אימייל', 'שם'],
    ['the name', 'display_name', 'שם', 'אימייל'],
  ])('says what the function says about %s, and marks that field and no other', async (_what, field, marked, other) => {
    const failure: UserOutcome = { ok: false, code: 'invalid', field }
    const { user } = setup(vi.fn<Create>().mockResolvedValue(failure))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(adminMessage(failure))
    expect(screen.getByLabelText(marked)).toBeInvalid()
    expect(screen.getByLabelText(other)).toBeValid()
  })

  it('marks no field for a refusal that is about none of them', async () => {
    const failure: UserOutcome = { ok: false, code: 'forbidden' }
    const { user } = setup(vi.fn<Create>().mockResolvedValue(failure))
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(adminMessage(failure))
    expect(screen.getByLabelText('שם')).toBeValid()
    expect(screen.getByLabelText('אימייל')).toBeValid()
  })

  it('takes the old refusal away when the person tries again', async () => {
    const create = vi.fn<Create>().mockResolvedValueOnce({ ok: false, code: 'email_taken', field: 'email' }).mockResolvedValue(null)
    const { user } = setup(create)
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toBeValid()
  })

  it('does not send what is not right, and puts the cursor on the first field that is not', async () => {
    const { user, create } = setup()
    await user.type(screen.getByLabelText('שם'), 'רינה כהן')
    await user.type(screen.getByLabelText('אימייל'), 'not-an-address')
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(screen.getByText('כתובת האימייל אינה תקינה.')).toBeInTheDocument()
    expect(screen.getByLabelText('אימייל')).toHaveFocus()
    expect(screen.getByLabelText('אימייל')).toHaveAccessibleDescription('כתובת האימייל אינה תקינה.')
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    ['only spaces', '   ', 'הזינו שם.'],
    ['a tab in it', 'רינה\tכהן', 'השם מכיל תו שאי אפשר להציג.'],
    ['sixty-one characters', 'א'.repeat(61), 'השם ארוך מדי: עד 60 תווים.'],
  ])('does not send a name of %s, and says why', async (_what, typed, message) => {
    const { user, create } = setup()
    await user.type(screen.getByLabelText('שם'), typed)
    await user.type(screen.getByLabelText('אימייל'), 'rina@example.com')
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByLabelText('שם')).toBeInvalid()
    expect(create).not.toHaveBeenCalled()
  })

  it('is given up with the button and with Escape, and not while a request is on its way', async () => {
    let answer: (outcome: UserOutcome | null) => void = () => undefined
    const create = vi.fn<Create>().mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { user, onCancel } = setup(create)
    await user.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)

    await fill(user)
    await user.click(screen.getByRole('button', { name: 'יצירה' }))
    expect(await screen.findByRole('button', { name: 'מבצע…' })).toBeDisabled()
    await user.keyboard('{Escape}')
    // A click on the dark area is a no, too, and is turned away in the same way.
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(2)
    answer(null)
  })

  it('is a compact dialog, named for what it does', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'עובד חדש' })).toHaveClass('modal-compact')
  })
})
