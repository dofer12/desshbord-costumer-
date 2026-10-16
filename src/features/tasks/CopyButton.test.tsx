import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubClipboard } from '../../test/clipboard'
import { CopyButton } from './CopyButton'

afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const user = userEvent.setup()
  return { user }
}

describe('CopyButton', () => {
  it('shows the value, and says in its name what a click does with it', () => {
    render(<CopyButton value="050-1234567" label="טלפון" />)
    expect(screen.getByRole('button', { name: 'העתקת טלפון: 050-1234567' })).toHaveTextContent('050-1234567')
  })

  it('can show other text than the value, and says the same in its name', async () => {
    const { user } = setup()
    const writeText = stubClipboard()
    render(
      <CopyButton value="10442" label="מספר הזמנה">
        העתקה
      </CopyButton>,
    )
    const button = screen.getByRole('button', { name: 'העתקת מספר הזמנה: 10442' })
    expect(button).toHaveTextContent('העתקה')
    expect(button).not.toHaveTextContent('10442')
    await user.click(button)
    expect(writeText).toHaveBeenCalledWith('10442')
  })

  it('copies the value, and confirms for a moment', async () => {
    const { user } = setup()
    const writeText = stubClipboard()
    render(<CopyButton value="ORD-77" label="מספר הזמנה" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith('ORD-77')
    expect(await screen.findByRole('status')).toHaveTextContent('הועתק')
  })

  it('takes the confirmation away after about two seconds', async () => {
    const { user } = setup()
    stubClipboard()
    render(<CopyButton value="1" label="x" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('status')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('starts the time over when it is clicked again', async () => {
    const { user } = setup()
    stubClipboard()
    render(<CopyButton value="1" label="x" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(screen.getByRole('button'))
    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    await user.click(screen.getByRole('button'))
    await act(async () => vi.advanceTimersByTimeAsync(1_500))
    expect(screen.getByRole('status')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says so when the copy did not work', async () => {
    const { user } = setup()
    stubClipboard('refuses')
    render(<CopyButton value="1" label="x" />)
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('status')).toHaveTextContent('ההעתקה נכשלה')
  })

  it('leaves no timer behind when it goes away before the copy is done', async () => {
    const { user } = setup()
    const writeText = stubClipboard()
    let finish: () => void = () => undefined
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    const { unmount } = render(<CopyButton value="1" label="x" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(screen.getByRole('button'))
    unmount()
    await act(async () => finish())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind when it goes away while the confirmation is shown', async () => {
    const { user } = setup()
    stubClipboard()
    const { unmount } = render(<CopyButton value="1" label="x" />)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await user.click(screen.getByRole('button'))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
