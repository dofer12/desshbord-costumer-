import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSaid } from './useSaid'

// A line for a status region: said now, and taken away after a few seconds.

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSaid', () => {
  it('says nothing at first', () => {
    const { result } = renderHook(() => useSaid())
    expect(result.current[0]).toBeNull()
  })

  it('says a line at once, and takes it away after six seconds', () => {
    const { result } = renderHook(() => useSaid())
    act(() => result.current[1]('נדחה למחר'))
    expect(result.current[0]).toBe('נדחה למחר')
    act(() => void vi.advanceTimersByTime(5_999))
    expect(result.current[0]).toBe('נדחה למחר')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current[0]).toBeNull()
  })

  it('takes the time that it is told to', () => {
    const { result } = renderHook(() => useSaid(1_000))
    act(() => result.current[1]('שלום'))
    act(() => void vi.advanceTimersByTime(1_000))
    expect(result.current[0]).toBeNull()
  })

  it('replaces a line that is still there with a new one, and counts the time again from the new one', () => {
    const { result } = renderHook(() => useSaid())
    act(() => result.current[1]('הראשונה'))
    act(() => void vi.advanceTimersByTime(4_000))
    act(() => result.current[1]('השנייה'))
    expect(result.current[0]).toBe('השנייה')
    act(() => void vi.advanceTimersByTime(4_000))
    expect(result.current[0]).toBe('השנייה')
    act(() => void vi.advanceTimersByTime(2_000))
    expect(result.current[0]).toBeNull()
  })

  it('gives the same function to say with every time, so that it can be a dependency', () => {
    const { result, rerender } = renderHook(() => useSaid())
    const first = result.current[1]
    rerender()
    act(() => first('x'))
    rerender()
    expect(result.current[1]).toBe(first)
  })

  it('leaves no timer behind when it goes away', () => {
    const { result, unmount } = renderHook(() => useSaid())
    act(() => result.current[1]('שלום'))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
