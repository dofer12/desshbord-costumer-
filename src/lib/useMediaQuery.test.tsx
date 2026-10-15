import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { stubMatchMedia } from '../test/matchMedia'
import { useMediaQuery } from './useMediaQuery'

function Probe({ query }: { query: string }) {
  return <p>{useMediaQuery(query) ? 'match' : 'no match'}</p>
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('useMediaQuery', () => {
  it('says whether the query matches now', () => {
    stubMatchMedia((query) => query === '(min-width: 500px)')
    const { rerender } = render(<Probe query="(min-width: 500px)" />)
    expect(screen.getByText('match')).toBeInTheDocument()
    rerender(<Probe query="(min-width: 900px)" />)
    expect(screen.getByText('no match')).toBeInTheDocument()
  })

  it('follows the screen when it changes, and lets go of the query when it goes away', () => {
    const media = stubMatchMedia(() => false)
    const { unmount } = render(<Probe query="(min-width: 500px)" />)
    expect(screen.getByText('no match')).toBeInTheDocument()
    expect(media.listeners).toBe(1)

    act(() => media.set(() => true))
    expect(screen.getByText('match')).toBeInTheDocument()

    unmount()
    expect(media.listeners).toBe(0)
  })

  it('does not listen again at every render', () => {
    const media = stubMatchMedia(() => false)
    const { rerender } = render(<Probe query="(min-width: 500px)" />)
    rerender(<Probe query="(min-width: 500px)" />)
    rerender(<Probe query="(min-width: 500px)" />)
    expect(media.subscriptions).toBe(1)
  })

  it('listens to the new query when the query changes', () => {
    const media = stubMatchMedia(() => false)
    const { rerender } = render(<Probe query="(min-width: 500px)" />)
    rerender(<Probe query="(min-width: 900px)" />)
    expect(media.subscriptions).toBe(2)
    expect(media.listeners).toBe(1)
  })

  it('says no where the browser cannot tell', () => {
    expect(window.matchMedia).toBeUndefined()
    render(<Probe query="(min-width: 500px)" />)
    expect(screen.getByText('no match')).toBeInTheDocument()
  })
})
