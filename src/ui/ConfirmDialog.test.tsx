import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

// A question with two answers, over the page: it names what is about to happen, and the safe answer is
// the one that has the cursor. While the answer is being carried out it cannot be changed.

function setup(props: { busy?: boolean; danger?: boolean } = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog title="איפוס סיסמה" confirmLabel="איפוס" busy={props.busy} danger={props.danger} onConfirm={onConfirm} onCancel={onCancel}>
      לאפס את הסיסמה של דנה?
    </ConfirmDialog>,
  )
  return { onConfirm, onCancel, user: userEvent.setup() }
}

describe('ConfirmDialog', () => {
  it('is a dialog that the title names, with the question and the two answers', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'איפוס סיסמה' })
    expect(dialog).toHaveTextContent('לאפס את הסיסמה של דנה?')
    expect(screen.getByRole('button', { name: 'איפוס' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeEnabled()
  })

  it('is a compact dialog: a question is not a screen of its own', () => {
    setup()
    expect(screen.getByRole('dialog')).toHaveClass('modal-compact')
  })

  it('starts with the cursor on the safe answer, so that Enter does no harm', () => {
    setup()
    expect(screen.getByRole('button', { name: 'ביטול' })).toHaveFocus()
  })

  it('does what is asked once, and says no without doing it', async () => {
    const { onConfirm, onCancel, user } = setup()
    await user.click(screen.getByRole('button', { name: 'איפוס' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('takes the Escape key and a click on the dark area for a no, and a click inside for nothing', async () => {
    const { onConfirm, onCancel, user } = setup()
    await user.click(screen.getByText('לאפס את הסיסמה של דנה?'))
    expect(onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('can be marked as dangerous: the button of what is asked looks like it', () => {
    setup({ danger: true })
    expect(screen.getByRole('button', { name: 'איפוס' })).toHaveClass('danger')
    expect(screen.getByRole('button', { name: 'ביטול' })).not.toHaveClass('danger')
  })

  it('is not dangerous unless it says so', () => {
    setup()
    expect(screen.getByRole('button', { name: 'איפוס' })).not.toHaveClass('danger')
    expect(screen.getByRole('button', { name: 'איפוס' })).toHaveClass('primary')
  })

  it('cannot be answered again while the answer is carried out, and cannot be left', async () => {
    const { onConfirm, onCancel, user } = setup({ busy: true })
    expect(screen.getByRole('button', { name: 'מבצע…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('gives the cursor back to what had it when it goes away', async () => {
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>פתיחה</button>
          {open && (
            <ConfirmDialog title="שאלה" confirmLabel="כן" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)}>
              בטוחים?
            </ConfirmDialog>
          )}
        </>
      )
    }
    render(<Opener />)
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: 'פתיחה' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
