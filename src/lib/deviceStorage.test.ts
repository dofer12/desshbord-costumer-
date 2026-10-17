import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceStorage } from './deviceStorage'

// The storage of the device holds what one person chose on that device: a snooze, the scope of a screen.
// A browser that blocks site data throws at the mere mention of it, and the app must go on without it.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deviceStorage', () => {
  it('is the local storage of the browser', () => {
    expect(deviceStorage()).toBe(localStorage)
  })

  it('is nothing when the browser does not let the page near its storage', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(deviceStorage()).toBeNull()
  })

  it('is nothing when there is no local storage at all', () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockReturnValue(undefined as unknown as Storage)
    expect(deviceStorage()).toBeNull()
  })
})
