import { vi } from 'vitest'
import { WIDE_SCREEN_QUERY } from '../lib/useMediaQuery'

export interface MatchMediaStub {
  /** Changes the answer for every query, and tells the ones that are listening. */
  set(matches: (query: string) => boolean): void
  /** How many listeners are attached right now, over all the queries. */
  readonly listeners: number
  /** How many times a listener was attached in all, to see a hook that listens again at every render. */
  readonly subscriptions: number
}

/** jsdom has no matchMedia. This puts one in place: `matches` decides, and `set` changes it later. */
export function stubMatchMedia(matches: (query: string) => boolean): MatchMediaStub {
  let current = matches
  const listeners = new Set<() => void>()
  let subscriptions = 0
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return current(query)
      },
      media: query,
      addEventListener(_type: string, listener: () => void) {
        subscriptions++
        listeners.add(listener)
      },
      removeEventListener(_type: string, listener: () => void) {
        listeners.delete(listener)
      },
    })),
  })
  return {
    set(next) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    get listeners() {
      return listeners.size
    },
    get subscriptions() {
      return subscriptions
    },
  }
}

/** A wide screen (a laptop), or a narrow one (a phone). */
export function stubViewport(kind: 'wide' | 'narrow'): MatchMediaStub {
  return stubMatchMedia((query) => kind === 'wide' && query === WIDE_SCREEN_QUERY)
}
