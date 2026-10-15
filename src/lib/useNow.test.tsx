import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNow } from './useNow'

function Clock({ every }: { every?: number }) {
  return <p>{useNow(every).toISOString()}</p>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('starts with the time of now, and moves it forward every minute', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z') })
    render(<Clock />)
    expect(screen.getByText('2026-10-15T12:00:00.000Z')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(59_000))
    expect(screen.getByText('2026-10-15T12:00:00.000Z')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByText('2026-10-15T12:01:00.000Z')).toBeInTheDocument()
  })

  it('takes another interval', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z') })
    render(<Clock every={5_000} />)
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.getByText('2026-10-15T12:00:05.000Z')).toBeInTheDocument()
  })

  it('stops when it goes away', () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z') })
    const { unmount } = render(<Clock />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
