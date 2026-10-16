import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

function Opener({ onClose = () => undefined, children }: { onClose?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button">other</button>
      {open && (
        <Modal
          labelledBy="t"
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        >
          <h2 id="t">Title</h2>
          {children ?? (
            <>
              <input aria-label="first" />
              <input aria-label="middle" />
              <button type="button">last</button>
            </>
          )}
        </Modal>
      )}
    </>
  )
}

async function open(onClose?: () => void, children?: React.ReactNode) {
  const user = userEvent.setup()
  render(<Opener onClose={onClose} children={children} />)
  await user.click(screen.getByRole('button', { name: 'open' }))
  return user
}

afterEach(() => {
  document.body.style.overflow = ''
})

describe('Modal', () => {
  it('is a modal dialog that is named by its heading', async () => {
    await open()
    const dialog = screen.getByRole('dialog', { name: 'Title' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('puts the focus on the first control when it opens', async () => {
    await open()
    expect(screen.getByLabelText('first')).toHaveFocus()
  })

  it('puts the focus on the one that asks for it', async () => {
    await open(undefined, (
      <>
        <input aria-label="first" />
        <input aria-label="wanted" data-autofocus />
      </>
    ))
    expect(screen.getByLabelText('wanted')).toHaveFocus()
  })

  it('puts the focus on the dialog itself when it holds nothing to focus', async () => {
    await open(undefined, <p>nothing here</p>)
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('gives the focus back to what had it when it closes', async () => {
    const user = await open()
    expect(screen.getByRole('button', { name: 'open' })).not.toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
  })

  it('closes on the Escape key', async () => {
    const onClose = vi.fn()
    const user = await open(onClose)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the Tab key inside: from the last control to the first, and back', async () => {
    const user = await open()
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('first')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
  })

  it('keeps the focus where it is when there is nothing inside to move it to', async () => {
    const user = await open(undefined, <p>nothing here</p>)
    await user.tab()
    expect(screen.getByRole('dialog')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('goes to the last control with Shift+Tab when the dialog itself has the focus', async () => {
    const user = await open()
    await user.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
  })

  it('passes over what cannot take the focus: a disabled control, and the inside of a closed section', async () => {
    const user = await open(
      undefined,
      <>
        <input aria-label="first" />
        <button type="button">last</button>
        <details>
          <summary>more</summary>
          <input aria-label="hidden" />
        </details>
        <button type="button" disabled>
          disabled
        </button>
      </>,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
    await user.tab()
    expect(screen.getByText('more')).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('first')).toHaveFocus()
  })

  it('does not let the Escape key go on to the page behind', async () => {
    const behind = vi.fn()
    const user = userEvent.setup()
    render(
      <div onKeyDown={behind}>
        <Opener />
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'open' }))
    await user.keyboard('{Escape}')
    expect(behind.mock.calls.filter(([event]) => event.key === 'Escape')).toHaveLength(0)
  })

  it('does not close for a click on a control when a press on the dark area was never finished', async () => {
    const onClose = vi.fn()
    const user = await open(onClose)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement)
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the dark area around it is clicked, and not when it is clicked inside', async () => {
    const onClose = vi.fn()
    const user = await open(onClose)
    await user.click(screen.getByLabelText('first'))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when a click that began inside ends on the dark area', async () => {
    const onClose = vi.fn()
    const user = await open(onClose)
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    await user.pointer([{ keys: '[MouseLeft>]', target: screen.getByLabelText('first') }, { target: backdrop }, { keys: '[/MouseLeft]' }])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stops the page behind from scrolling while it is open', async () => {
    const user = await open()
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('puts back the scrolling that the page had before, not just "auto"', async () => {
    document.body.style.overflow = 'scroll'
    const user = await open()
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('scroll')
  })

  describe('with a second window over it', () => {
    function Stacked({ inner }: { inner: boolean }) {
      return (
        <Modal labelledBy="outer" onClose={() => undefined}>
          <h2 id="outer">Outer</h2>
          {inner && (
            <Modal labelledBy="inner" onClose={() => undefined}>
              <h2 id="inner">Inner</h2>
            </Modal>
          )}
        </Modal>
      )
    }

    it('keeps the page still until the last window is gone, and then puts back what it had', () => {
      document.body.style.overflow = 'scroll'
      const view = render(<Stacked inner={false} />)
      view.rerender(<Stacked inner />)
      expect(document.body.style.overflow).toBe('hidden')
      view.rerender(<Stacked inner={false} />)
      expect(document.body.style.overflow).toBe('hidden')
      view.unmount()
      expect(document.body.style.overflow).toBe('scroll')
    })

    it('puts back what the page had when both windows go away together, as when the page behind changes', () => {
      document.body.style.overflow = 'scroll'
      const view = render(<Stacked inner />)
      view.unmount()
      expect(document.body.style.overflow).toBe('scroll')
    })

    it('does not mistake what the first window set for what the page had, when the windows come one after the other', () => {
      const first = render(<Stacked inner={false} />)
      first.unmount()
      expect(document.body.style.overflow).toBe('')
      const second = render(<Stacked inner />)
      second.unmount()
      expect(document.body.style.overflow).toBe('')
    })
  })
})
