import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubClipboard } from '../../test/clipboard'
import { TempPasswordDialog } from './TempPasswordDialog'

// The only place where a temporary password is shown, and shown once: it comes in as a prop, it is on the
// screen as long as the dialog is, and it is nowhere else (not in a name, a title, a storage or the address).

const PASSWORD = 'Kq7mWx3RnTb9HdYz'

function setup(kind: 'created' | 'reset' = 'created') {
  const onClose = vi.fn()
  const user = userEvent.setup()
  const clipboard = stubClipboard()
  const view = render(<TempPasswordDialog kind={kind} person="דנה כהן" password={PASSWORD} onClose={onClose} />)
  return { onClose, user, clipboard, ...view }
}

const shown = () => within(screen.getByRole('group', { name: 'הסיסמה הזמנית' }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the temporary password', () => {
  it('is shown in a place of its own, read from left to right, in the dialog of a new employee', () => {
    setup('created')
    const dialog = screen.getByRole('dialog', { name: 'העובד נוצר' })
    expect(dialog).toHaveTextContent('דנה כהן')
    const password = shown().getByText(PASSWORD)
    expect(password).toHaveAttribute('dir', 'ltr')
    expect(password).toHaveClass('num')
  })

  it('is shown in the dialog of a reset, which says that the person was signed out everywhere', () => {
    setup('reset')
    const dialog = screen.getByRole('dialog', { name: 'הסיסמה אופסה' })
    expect(dialog).toHaveTextContent('דנה כהן')
    expect(dialog).toHaveTextContent('נותק מכל המכשירים')
    expect(shown().getByText(PASSWORD)).toBeInTheDocument()
  })

  it.each(['created', 'reset'] as const)('says, in the dialog of "%s", that it is shown once and what to do with it', (kind) => {
    setup(kind)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('מוצגת פעם אחת בלבד')
    expect(dialog).toHaveTextContent('אי אפשר לראות אותה שוב')
    expect(dialog).toHaveTextContent('בכניסה הראשונה')
  })

  it('is copied by a button, which says so, and which does not carry the password in its name', async () => {
    const { user, clipboard } = setup()
    const copy = screen.getByRole('button', { name: 'העתקת הסיסמה' })
    expect(copy.getAttribute('aria-label') ?? '').not.toContain(PASSWORD)
    await user.click(copy)
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(PASSWORD)
    expect(await screen.findByText('הועתק')).toBeInTheDocument()
  })

  it('tells the person to copy it by hand when the browser does not let the page copy', async () => {
    const user = userEvent.setup()
    // The clipboard refuses, and the browser (as jsdom does) has no older way of copying either.
    stubClipboard('refuses')
    render(<TempPasswordDialog kind="created" person="דנה" password={PASSWORD} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'העתקת הסיסמה' }))
    expect(await screen.findByText('ההעתקה נכשלה: סמנו את הסיסמה והעתיקו אותה ידנית.')).toBeInTheDocument()
    expect(screen.queryByText('הועתק')).not.toBeInTheDocument()
  })

  it('is a compact dialog', () => {
    setup()
    expect(screen.getByRole('dialog')).toHaveClass('modal-compact')
  })

  it('has the cursor on the button that copies it, so that the keyboard goes straight there', () => {
    setup()
    expect(screen.getByRole('button', { name: 'העתקת הסיסמה' })).toHaveFocus()
  })

  it('is closed by the button, and by the Escape key', async () => {
    const { onClose, user } = setup()
    await user.click(screen.getByRole('button', { name: 'סגירה' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('is gone from the page once the dialog is', () => {
    const { unmount } = setup()
    expect(document.body.textContent).toContain(PASSWORD)
    unmount()
    expect(document.body.textContent).not.toContain(PASSWORD)
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('is written nowhere: not in a storage, not in the address, not in the title', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'העתקת הסיסמה' }))
    expect(local).not.toHaveBeenCalled()
    expect(JSON.stringify({ ...localStorage })).not.toContain(PASSWORD)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(PASSWORD)
    expect(location.href).not.toContain(PASSWORD)
    expect(document.title).not.toContain(PASSWORD)
  })

  it('is on the page only once, as text', () => {
    setup()
    const count = document.body.textContent?.split(PASSWORD).length ?? 0
    expect(count - 1).toBe(1)
    expect(document.body.innerHTML.split(PASSWORD).length - 1).toBe(1)
  })
})
